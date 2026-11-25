import net from "node:net";
import type { Pool } from "pg";
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
  let waking: Promise<void> | null = null; // while suspended: settles once awake
  let asleep = false;
  const neon = net.createServer((client) => {
    client.on("error", () => {});
    const through = () => {
      if (client.destroyed) return; // the pool gave up on it while the database was waking
      const server = net.connect(Number(postgres.port), postgres.hostname);
      server.on("error", () => {});
      for (const socket of [client, server]) open.add(socket);
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
