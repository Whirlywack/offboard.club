import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getAllTime, getSeason, readLeaderboards, seasonOfMatchday } from "./leaderboards";

// The Leaderboards' real SQL against the database in DATABASE_URL, inside one transaction that is always rolled back,
// so nothing it does is kept. Every row it adds is its own, and it changes no existing row. Runs only when
// ALLOW_DB_TESTS=1 is set as well, never in a plain `pnpm test`. Run it against a local database from `pnpm db:start`,
// never a shared or live one, before seeding (once that one is seeded, a second from
// `pnpm db:start --dir .local-db-tests`), with that database's address:
// ALLOW_DB_TESTS=1 DATABASE_URL=<that address> node node_modules/vitest/vitest.mjs run lib/leaderboards.postgres.test.ts
vi.mock("@/lib/db", async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // Nothing the app sends may end the test's transaction.
  const query = (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|start|commit|end|rollback|abort)\b/i.test(sql)) throw new Error(`refused inside the test's transaction: ${sql}`);
    return client.query(sql, params);
  };
  return { db: { client, query, connect: async () => ({ query, release: () => {} }) } };
});

describe.skipIf(process.env.ALLOW_DB_TESTS !== "1" || !process.env.DATABASE_URL)("the Leaderboards in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;
  const run = (sql: string, params: unknown[] = []) => client.query(sql, params);

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");
  }, 30_000);

  afterAll(async () => {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }, 30_000);

  it("reads the Season and all-time Leaderboards from stored results", async () => {
    // January 2026, before any real Matchday. Season 1's start is set only if the database has none, so the schedule
    // the app reads is whichever is stored; the dates below are worked out from it.
    await run(`insert into "season" ("number", "start") values (1, '2026-01-04') on conflict ("number") do nothing`);
    const now = new Date("2026-03-04T12:00:00Z");
    const one = (await getSeason(1, await readLeaderboards(now)))!.matchdays!.map((m) => m.date);
    const [first, second] = one;

    await run(`insert into "company" ("domain", "name") values ('leaderboards-test.example', 'Leaderboards Test')`);
    const addPerson = (id: string, { member = true, marked = false, company = null as string | null } = {}) =>
      run(
        `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId", "lichessMarked", "companyDomain")
         values ($1, $1, $2, false, now(), now(), $3, $4, $5)`,
        [id, `${id}@example.invalid`, member ? id : null, marked, company],
      );
    await addPerson("leaderboards-test-ana", { company: "leaderboards-test.example" });
    await addPerson("leaderboards-test-ben");
    await addPerson("leaderboards-test-marked", { marked: true });
    await addPerson("leaderboards-test-half", { member: false });

    // Matchdays on Season 1's first two Sundays, unless real ones are already stored there, and one outside it.
    const outside = "2025-12-28";
    for (const date of [first, second, outside]) {
      const { rowCount } = await run(
        `insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values ($1, $2, now()) on conflict do nothing`,
        [date, `LB${date.replaceAll("-", "").slice(2)}`],
      );
      expect(rowCount, `a Matchday is already stored on ${date}`).toBe(1);
    }
    const result = (date: string, userId: string, rank: number, points: number) =>
      run(
        `insert into "matchdayResult" ("matchdayDate", "userId", "rank", "points", "rating", "companyDomain")
         select $1::date, $2, $3, $4, 1500, "companyDomain" from "user" where id = $2`,
        [date, userId, rank, points],
      );
    await result(first, "leaderboards-test-marked", 1, 5);
    await result(first, "leaderboards-test-ana", 2, 3.5);
    await result(first, "leaderboards-test-half", 3, 3);
    await result(second, "leaderboards-test-ben", 1, 4);
    await result(second, "leaderboards-test-ana", 2, 0.5);
    await result(outside, "leaderboards-test-ben", 1, 2);

    const mine = <R extends { memberId: string }>(rows: R[]) => rows.filter((r) => r.memberId.startsWith("leaderboards-test-"));
    const season = (await getSeason(1, await readLeaderboards(now)))!;
    expect(season.matchdays!.slice(0, 2)).toEqual([
      { date: first, ingested: true, missed: false },
      { date: second, ingested: true, missed: false },
    ]);
    expect(mine(season.leaderboard)).toEqual([
      { memberId: "leaderboards-test-ana", name: "leaderboards-test-ana", company: { domain: "leaderboards-test.example", name: "Leaderboards Test" }, rank: 1, score: 4, played: 2 },
      { memberId: "leaderboards-test-ben", name: "leaderboards-test-ben", company: null, rank: 2, score: 4, played: 1 },
    ]);
    expect(await seasonOfMatchday(second, now)).toEqual({ season: 1, number: 2 });
    expect(await seasonOfMatchday(outside, now)).toBeNull();
    // Ben's Matchday outside every Season counts here.
    expect(mine(await getAllTime()).map((r) => [r.memberId, r.played])).toEqual([
      ["leaderboards-test-ana", 2],
      ["leaderboards-test-ben", 2],
    ]);
  }, 60_000);
});
