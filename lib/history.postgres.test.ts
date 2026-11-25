import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getHistory } from "./history";

// A Profile's history read by its real SQL from the database in DATABASE_URL, inside one transaction that is always
// rolled back, so nothing it does is kept. Every row it adds is its own, and it changes no existing row. Runs only when
// ALLOW_DB_TESTS=1 is set as well, never in a plain `pnpm test`, and only ever against a development database:
// ALLOW_DB_TESTS=1 DATABASE_URL=<a development database> node node_modules/vitest/vitest.mjs run lib/history.postgres.test.ts
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

describe.skipIf(process.env.ALLOW_DB_TESTS !== "1" || !process.env.DATABASE_URL)("a Profile's history in Postgres", () => {
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

  it("reads Matchdays played, the Streak, the Games from the Member's side and the head-to-head record", async () => {
    const addPerson = (id: string, member = true) =>
      run(
        `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId")
         values ($1, $1, $2, false, now(), now(), $3)`,
        [id, `${id}@example.invalid`, member ? id : null],
      );
    for (const id of ["history-test-ana", "history-test-ben", "history-test-gone"]) await addPerson(id);
    await addPerson("history-test-half", false);

    // Three Matchdays in December 2099, after any real one, so they are the latest; ana misses none of them. The one
    // after them is set up but not played yet.
    const dates = ["2099-12-06", "2099-12-13", "2099-12-20"];
    for (const date of dates)
      await run(`insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values ($1, $2, now())`, [date, `HT${date.slice(5).replace("-", "")}`]);
    await run(`insert into "matchday" ("date", "lichessTournamentId") values ('2099-12-27', 'HT1227')`);
    const result = (date: string, userId: string, rank: number) =>
      run(`insert into "matchdayResult" ("matchdayDate", "userId", "rank", "points", "rating") values ($1, $2, $3, 2, 1500)`, [date, userId, rank]);
    for (const date of dates) await result(date, "history-test-ana", 1);
    await result(dates[0], "history-test-ben", 2);
    await result(dates[2], "history-test-ben", 2);

    const game = (id: string, date: string, white: string, black: string, winner: string | null, minute: number) =>
      run(
        `insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt")
         values ($1, $2, $3, $4, $5, $6, 40, 1500, 1500, $7, $2::date + make_interval(mins => $8))`,
        [id, date, white, black, winner, winner ? "resign" : "draw", winner ? 600 : null, minute],
      );
    await game("histtst1", dates[0], "history-test-ana", "history-test-ben", "white", 1);
    await game("histtst2", dates[0], "history-test-gone", "history-test-ana", "white", 2);
    await game("histtst3", dates[2], "history-test-ben", "history-test-ana", null, 3);
    await game("histtst4", dates[2], "history-test-half", "history-test-ana", "black", 4);
    // The departed person's account is deleted: their side of the Game empties.
    await run(`delete from "user" where id = 'history-test-gone'`);

    const history = await getHistory("history-test-ana", "history-test-ben");
    expect(history.played).toBe(3);
    expect(history.streak).toBe(3);
    expect(history.total).toBe(4);
    expect(history.games).toEqual([
      { lichessGameId: "histtst4", date: dates[2], colour: "black", result: "won", opponent: null },
      { lichessGameId: "histtst3", date: dates[2], colour: "black", result: "drew", opponent: { id: "history-test-ben", name: "history-test-ben" } },
      { lichessGameId: "histtst2", date: dates[0], colour: "black", result: "lost", opponent: null },
      { lichessGameId: "histtst1", date: dates[0], colour: "white", result: "won", opponent: { id: "history-test-ben", name: "history-test-ben" } },
    ]);
    expect(history.headToHead).toEqual({ wins: 0, draws: 1, losses: 1 });

    // ben missed the middle Matchday, so his Streak is the last one alone.
    expect(await getHistory("history-test-ben", "history-test-ben")).toMatchObject({ played: 2, streak: 1, headToHead: null });
    expect((await getHistory("history-test-ana", "history-test-ana", { all: true })).games).toHaveLength(4);
  }, 60_000);
});
