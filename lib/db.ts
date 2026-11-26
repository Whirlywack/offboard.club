import { attachDatabasePool } from "@vercel/functions/db-connections";
import pg, { type ClientBase, type PoolClient } from "pg";

// The pool, or a single connection such as one holding a transaction.
export type Queryable = Pick<ClientBase, "query">;

type Connected = (error: Error | undefined, client: PoolClient | undefined, release: (error?: Error | boolean) => void) => void;

// What the pool throws carries this mark, saying whether it could not connect ("connect") or a statement failed
// ("statement"), so that a failed request is said to be the database's only when its error came from here
// (lib/request-failures.ts, #60 review): a code such as ECONNRESET is any socket's, a visitor's who drops an upload
// included. Symbol.for, as Next.js gives the hook a copy of this module of its own, and a key no request can set, as
// nothing parsed from one makes a symbol.
const FROM_DATABASE = Symbol.for("offboard.from-database");
const marked = (error: Error, stage: "connect" | "statement") => Object.defineProperty(error, FROM_DATABASE, { value: stage });

// Marks what each statement on `client` fails with, promised or called back, as pg-pool's own query calls back. Once a
// client: the pool hands the same ones out again.
const watched = new WeakSet<PoolClient>();
function watch(client: PoolClient) {
  if (watched.has(client)) return client;
  watched.add(client);
  const query = client.query.bind(client) as (...args: unknown[]) => unknown;
  client.query = ((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function")
      args[args.length - 1] = (error: Error | null, ...rest: unknown[]) => callback(error && marked(error, "statement"), ...rest);
    const answer = query(...args);
    return answer instanceof Promise ? answer.catch((error: Error) => Promise.reject(marked(error, "statement"))) : answer;
  }) as PoolClient["query"];
  return client;
}

// A connection that could not be opened is tried once more, at once: nothing has been sent on it, so nothing can run
// twice, and a statement that fails is never sent again. On 25 November 2026 (#55) two attempts were ended by their own
// 5 s timer without reaching the database, which was running, or woke in 300 ms for the next attempt; one of the timers
// fired 55 ms into the request that its suspended instance came back for, so it had been set before. Neon has taken
// 11 s to wake once. With 10 s an attempt, a database that is down is given up on in 20 s.
class Pool extends pg.Pool {
  connect(): Promise<PoolClient>;
  connect(callback: Connected): void;
  connect(callback?: Connected) {
    const started = Date.now();
    const connected = super
      .connect()
      .catch((error: Error) => {
        console.error(`Connecting to the database failed after ${Date.now() - started} ms, trying once more:`, error.message);
        return super.connect();
      })
      .then(watch, (error: Error) => Promise.reject(marked(error, "connect")));
    if (!callback) return connected;
    connected.then(
      (client) => callback(undefined, client, client.release),
      (error: Error) => callback(error, undefined, () => {}),
    );
  }
}

// pg 8 takes sslmode=prefer, require and verify-ca to mean verify-full, and says so in a warning on stderr, once in each
// process that reads one, which Vercel logs at error level (#60). The address is given to pg asking for verify-full,
// which is what it does now: pg-connection-string turns each of the four into the same `ssl: {}` and nothing else
// (node_modules/pg-connection-string/index.js, parse), and pg copies `ssl` from it, never `sslmode`
// (pg/lib/connection-parameters.js), so the server's certificate is checked as before, against the system's CAs and
// the host's name. Only the query's own sslmode pairs are changed, split at "&" as URLSearchParams splits them, so not
// one inside another's value; and an address with uselibpqcompat, under which the modes mean libpq's and differ, is
// left as it is.
function verifyFull(address?: string) {
  const query = address?.indexOf("?") ?? -1;
  if (!address || query < 0) return address; // none, as on a preview, or one with no query to read a mode from
  const pairs = address.slice(query + 1).split("&");
  if (pairs.some((pair) => pair.startsWith("uselibpqcompat="))) return address;
  const verified = pairs.map((pair) => (/^sslmode=(prefer|require|verify-ca)$/.test(pair) ? "sslmode=verify-full" : pair));
  return `${address.slice(0, query + 1)}${verified.join("&")}`;
}

// One pool per server instance; Neon's pooled connection string handles the rest.
export const db = new Pool({ connectionString: verifyFull(process.env.DATABASE_URL), max: 5, connectionTimeoutMillis: 10_000 });

// Vercel suspends an instance between requests, and the pool's idle timer does not run while it is suspended, so a
// connection left idle could be closed by the database under it and handed to the next request dead. This keeps the
// instance up after each request until the pool has closed its idle connections. Off Vercel it does nothing. It does not
// keep the instance up for an attempt still connecting when a request ends.
attachDatabasePool(db);

// Neon closes idle connections when it suspends; the pool replaces them, so this is not fatal.
db.on("error", (error) => console.error("Idle database connection closed:", error.message));
