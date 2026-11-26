import { attachDatabasePool } from "@vercel/functions/db-connections";
import pg, { type ClientBase, type PoolClient } from "pg";

// The pool, or a single connection such as one holding a transaction.
export type Queryable = Pick<ClientBase, "query">;

type Connected = (error: Error | undefined, client: PoolClient | undefined, release: (error?: Error | boolean) => void) => void;

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
    const connected = super.connect().catch((error: Error) => {
      console.error(`Connecting to the database failed after ${Date.now() - started} ms, trying once more:`, error.message);
      return super.connect();
    });
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
// the host's name. (With uselibpqcompat=true, which no address here has, the modes would mean libpq's instead.)
const verifyFull = (address?: string) => address?.replace(/([?&]sslmode=)(?:prefer|require|verify-ca)(?=&|$)/g, "$1verify-full");

// One pool per server instance; Neon's pooled connection string handles the rest.
export const db = new Pool({ connectionString: verifyFull(process.env.DATABASE_URL), max: 5, connectionTimeoutMillis: 10_000 });

// Vercel suspends an instance between requests, and the pool's idle timer does not run while it is suspended, so a
// connection left idle could be closed by the database under it and handed to the next request dead. This keeps the
// instance up after each request until the pool has closed its idle connections. Off Vercel it does nothing. It does not
// keep the instance up for an attempt still connecting when a request ends.
attachDatabasePool(db);

// Neon closes idle connections when it suspends; the pool replaces them, so this is not fatal.
db.on("error", (error) => console.error("Idle database connection closed:", error.message));
