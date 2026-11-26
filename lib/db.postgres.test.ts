import net from "node:net";
import pg, { type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The site's one pool (lib/db.ts), which pages, the sign-in library, the scheduled jobs and the scripts all use, against
// a database that scales to zero as Neon does, and on an instance that is suspended between requests as Vercel's are
// (#55). Between the pool and the Postgres in DATABASE_URL is a stand-in for Neon: it passes each connection through,
// and suspend() does what Neon does after 5 minutes without a query, closing every connection; the next connection
// wakes it, and every connection waits until it is awake. Sends nothing but "select 1". Runs only when ALLOW_DB_TESTS=1
// is set as well as DATABASE_URL, and a plain `pnpm test` skips it. Run it against a local database from
// `pnpm db:start`: ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/db.postgres.test.ts

// The longest wake in Neon's record of the live database, longer than one attempt's 10 s.
const WAKE_MS = 11_300;

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the database pool", () => {
  let postgres: URL; // the real database, behind the stand-in
  const open = new Set<net.Socket>();
  const pairs = new Set<[net.Socket, net.Socket]>(); // each connection, the pool's end and the database's
  let waking: Promise<void> | null = null; // while suspended: settles once awake
  let asleep = false;
  const neon = net.createServer((client) => {
    client.on("error", () => {});
    const through = () => {
      if (client.destroyed) return; // the pool gave up on it while the database was waking
      const server = net.connect(Number(postgres.port), postgres.hostname);
      server.on("error", () => {});
      for (const socket of [client, server]) open.add(socket);
      pairs.add([client, server]);
      client.on("close", () => server.destroy());
      server.on("close", () => client.destroy());
      client.pipe(server).pipe(client);
    };
    if (!asleep) return through();
    waking ??= new Promise<void>((awake) => setTimeout(awake, WAKE_MS)).then(() => void (asleep = false));
    void waking.then(through);
  });
  const suspend = () => {
    for (const socket of open) socket.destroy();
    open.clear();
    asleep = true;
    waking = null;
  };
  // The connections open now pass nothing more either way, and are not closed: a statement sent on one is never
  // answered, as on a connection frozen under the pool. New ones pass as before.
  const freeze = () => {
    for (const [client, server] of pairs) {
      client.unpipe(server);
      server.unpipe(client);
    }
    const frozen = [...pairs];
    pairs.clear();
    return () => frozen.flat().forEach((socket) => socket.destroy());
  };
  let db: Pool;
  let logged: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    postgres = new URL(process.env.DATABASE_URL!);
    await new Promise<void>((listening) => neon.listen(0, "127.0.0.1", listening));
    const address = new URL(postgres);
    address.port = String((neon.address() as net.AddressInfo).port);
    vi.stubEnv("DATABASE_URL", address.href);
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
    ({ db } = await import("./db"));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.end();
    for (const socket of open) socket.destroy();
    neon.close();
  });

  // A whole process stopped and started again, as an instance is suspended and resumed, while its clock runs on: here
  // its one thread is held for longer than an attempt's 10 s, so that when it runs again the attempt's timer is
  // already due, and fires before the answer that is waiting is read. What it does not model: an instance whose
  // clocks stop while it is suspended, or whose network changes under it. First, so that the pool has no connection.
  it("answers a query whose connection attempt was ended by its timer as the instance came back", async () => {
    expect(db.totalCount).toBe(0);
    const answer = db.query("select 1 as one");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_500); // suspended, with the attempt under way
    const resumed = Date.now();
    expect((await answer).rows).toEqual([{ one: 1 }]);
    expect(Date.now() - resumed).toBeLessThan(1_000);
    expect(logged).toHaveBeenCalledWith(
      expect.stringMatching(/^Connecting to the database failed after 1\d{4} ms, trying once more:$/),
      "Connection terminated due to connection timeout",
    );
  }, 30_000);

  // Vercel keeps an instance alive while a promise given to the request's waitUntil is pending, and suspends it after.
  it("keeps a Vercel instance up after a request until the pool has closed its idle connection", async () => {
    vi.stubEnv("VERCEL_URL", "offboard.test");
    vi.stubEnv("VERCEL_REGION", "iad1");
    const kept: Promise<unknown>[] = [];
    vi.stubGlobal(Symbol.for("@vercel/request-context"), { get: () => ({ waitUntil: (work: Promise<unknown>) => kept.push(work) }) });
    await db.query("select 1");
    expect(db.idleCount).toBe(1);
    expect(kept).not.toEqual([]);
    await Promise.all(kept);
    expect(db.totalCount).toBe(0);
  }, 20_000);

  // What a statement fails with is the database's, to the failed requests (lib/request-failures.ts, #60 review), sent
  // through the pool, which calls a client back, or on a client it handed out, as the sign-in library sends it; and an
  // error not from the pool is not. A client is watched once, however often it is handed out.
  it("marks what a statement fails with as the database's, through the pool and on a client it hands out, and nothing else", async () => {
    const { reasonOf } = await import("./request-failures");
    const refused = "the database refused it (error 42P01)";
    expect(reasonOf(await db.query(`select from "noSuchTable"`).catch((error: unknown) => error))).toBe(refused);
    const client = await db.connect();
    const watching = client.query;
    expect(reasonOf(await client.query(`select from "noSuchTable"`).catch((error: unknown) => error))).toBe(refused);
    client.release();
    const again = await db.connect();
    expect(again === client && again.query === watching).toBe(true);
    again.release();
    const bare = new pg.Client({ connectionString: postgres.href });
    await bare.connect();
    expect(reasonOf(await bare.query(`select from "noSuchTable"`).catch((error: unknown) => error))).toBe("the code threw an error");
    await bare.end();
  }, 20_000);

  // A failed request is recorded once at a time a kind (lib/request-failures.ts): a recording left unanswered must end at
  // its own limit, 10 s, or the kind would go unrecorded for as long, the database working again or not. The limit's
  // timer is pg's, run here on a fake clock.
  it("records a kind again once a recording of it got no answer within its limit, on a connection frozen under the pool", async () => {
    const { noticeFailedRequest } = await import("./request-failures");
    const route = "/frozen-connection";
    const page = () => noticeFailedRequest(new TypeError("Oops"), { routePath: route, routeType: "render" });
    await db.query("select 1"); // the connection the recording will be sent on, idle in the pool
    const cut = freeze();
    logged.mockClear();
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const first = page();
      await page(); // the same kind while the first waits for its answer: not recorded twice
      await vi.advanceTimersByTimeAsync(10_000);
      vi.useRealTimers();
      expect(await Promise.race([first.then(() => "ended"), new Promise((wait) => setTimeout(wait, 2_000, "still waiting"))])).toBe("ended");
      expect(logged.mock.calls).toEqual([
        ["A page failed at /frozen-connection: the code threw TypeError. It couldn't be recorded: the database couldn't be reached."],
      ]);
      await page(); // on a new connection, as the pool let the frozen one go
      expect((await db.query(`select "route", "kind" from "requestFailure" where "route" = $1`, [route])).rows).toEqual([{ route, kind: "page" }]);
    } finally {
      vi.useRealTimers();
      cut();
      await db.query(`delete from "requestFailure" where "route" = $1`, [route]);
    }
  }, 30_000);

  it("answers the first query after the database has scaled to zero, though waking it takes 11.3 s", async () => {
    expect((await db.query("select 1 as one")).rows).toEqual([{ one: 1 }]);
    logged.mockClear();
    suspend();
    // The quiet spell: the pool lets go of the connection the database closed, and says so, without failing.
    await vi.waitFor(() => expect(db.totalCount).toBe(0));
    expect(logged).toHaveBeenCalledWith("Idle database connection closed:", "Connection terminated unexpectedly");
    expect((await db.query("select 1 as one")).rows).toEqual([{ one: 1 }]);
  }, 30_000);
});
