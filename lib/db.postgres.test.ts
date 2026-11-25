import net from "node:net";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The site's one pool (lib/db.ts), which pages, the sign-in library, the scheduled jobs and the scripts all use, against
// a database that scales to zero as Neon does (#55). Between the pool and the Postgres in DATABASE_URL is a stand-in for
// Neon: it passes each connection through, and suspend() does what Neon does after 5 minutes without a query, closing
// every connection and holding the next one while the database wakes. Sends nothing but "select 1". Runs only when
// ALLOW_DB_TESTS=1 is set as well as DATABASE_URL, and a plain `pnpm test` skips it. Run it against a local database
// from `pnpm db:start`: ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/db.postgres.test.ts

// Longer than the 5 s the pool allowed before #55, and within the few seconds Neon says waking can take.
const WAKE_MS = 6_000;

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the database pool, when the database scales to zero", () => {
  let postgres: URL; // the real database, behind the stand-in
  const open = new Set<net.Socket>();
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
    setTimeout(() => {
      asleep = false;
      through();
    }, WAKE_MS);
  });
  const suspend = () => {
    for (const socket of open) socket.destroy();
    open.clear();
    asleep = true;
  };
  let db: Pool;

  beforeAll(async () => {
    postgres = new URL(process.env.DATABASE_URL!);
    await new Promise<void>((listening) => neon.listen(0, "127.0.0.1", listening));
    const address = new URL(postgres);
    address.port = String((neon.address() as net.AddressInfo).port);
    vi.stubEnv("DATABASE_URL", address.href);
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

  it("answers the first query after the database has scaled to zero, though waking it takes 6 s", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await db.query("select 1 as one")).rows).toEqual([{ one: 1 }]);
    suspend();
    // The quiet spell: the pool lets go of the connection the database closed, and says so, without failing.
    await vi.waitFor(() => expect(db.totalCount).toBe(0));
    expect(logged).toHaveBeenCalledWith("Idle database connection closed:", "Connection terminated unexpectedly");
    expect((await db.query("select 1 as one")).rows).toEqual([{ one: 1 }]);
  }, 20_000);
});
