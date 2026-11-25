import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFakeLichess, type FakeSwiss } from "@/lib/fixtures/fake-lichess";
import { finishOrganiserConnection, startOrganiserConnection } from "./organiser-lichess";
import { changeSeasonStart, forgetTournamentCancellation, skipMatchday, tournamentCancellations } from "./reschedule";

// The Organiser's changes to the schedule with their real SQL against the database in DATABASE_URL, inside one
// transaction that is always rolled back, so nothing it does is kept: which tournaments a change leaves without a
// Matchday, how each is cleared from its Matchday and kept to cancel in the change's own transaction (a savepoint within
// the test's), and those kept to cancel by hand. Lichess is the fake. Inside the transaction it empties "season",
// "skippedSunday" and "tournamentCancellation", and adds its own person, Matchdays on dates it checks are free, and the
// Organiser's permission, which replaces any other there. Skipped unless ALLOW_DB_TESTS=1 as well as DATABASE_URL, so a
// plain `pnpm test` never runs it. Run it against a local database from `pnpm db:start`, never a shared or live one,
// before seeding (once that one is seeded, a second from `pnpm db:start --dir .local-db-tests`), with that database's
// address:
// ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/reschedule.postgres.test.ts
vi.mock("@/lib/db", async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const inner: Record<string, string> = { begin: "savepoint change", commit: "release savepoint change", rollback: "rollback to savepoint change" };
  // What a test does just before each statement the app sends.
  const hooks = { before: async (sql: string) => void sql };
  // Nothing the app sends may end the test's transaction.
  const query = async (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|start|commit|end|rollback|abort)\b/i.test(sql)) throw new Error(`refused inside the test's transaction: ${sql}`);
    await hooks.before(sql.replace(/\s+/g, " ").trim());
    return client.query(sql, params);
  };
  const connect = async () => ({
    query: (sql: string, params?: unknown[]) => (Object.hasOwn(inner, sql) ? client.query(inner[sql]) : query(sql, params)),
    release: () => {},
  });
  return { db: { client, hooks, query, connect } };
});

const ORGANISER = `test-organiser-${randomBytes(6).toString("hex")}`;
// Wednesday 25 November 2026. Season 1 starts on Sunday 13 December: Matchdays on 13, 20 and 27 December and 3, 10
// and 17 January, so 29 November and 6 December come before it.
const NOW = new Date("2026-11-25T12:00:00Z");
const DATES = ["2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27", "2027-01-03"];

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("changes to the schedule in Postgres", () => {
  const { client, hooks } = db as unknown as { client: pg.Client; hooks: { before: (sql: string) => Promise<void> } };
  const run = (sql: string, params: unknown[] = []) => client.query(sql, params);
  const select = async (sql: string, params: unknown[] = []) => (await run(sql, params)).rows;
  const lichess = createFakeLichess({ teamId: "offboard-team", teamPassword: "pw", accounts: [{ id: "boss", username: "Boss" }] });
  lichess.team.leaders.add("boss");
  const swiss = (id: string, date: string, createdBy = "boss"): FakeSwiss => ({
    id,
    teamId: "offboard-team",
    status: "created",
    startsAt: `${date}T18:00:00.000Z`,
    results: "",
    games: "",
    createdBy,
  });
  const matchdays = async () =>
    Object.fromEntries(
      (
        await select(
          `select to_char("date", 'YYYY-MM-DD') as "date", "lichessTournamentId", "ingestedAt" is not null as "ingested" from "matchday" where "date" = any($1::date[])`,
          [DATES],
        )
      ).map((m) => [m.date, m.ingested ? `${m.lichessTournamentId} (ingested)` : m.lichessTournamentId]),
    );
  const skipped = async () => (await select(`select to_char("date", 'YYYY-MM-DD') as "date" from "skippedSunday" order by "date"`)).map((r) => r.date);
  const cancels = () => lichess.calls.filter((c) => c.path.endsWith("/terminate")).map((c) => c.path.split("/")[3]);

  beforeAll(async () => {
    vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
    vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
    vi.stubEnv("BETTER_AUTH_SECRET", "test secret");
    vi.stubEnv("LICHESS_TEAM_ID", "offboard-team");
    vi.stubEnv("ORGANISER_USER_ID", ORGANISER);
    vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"));
    vi.stubGlobal("fetch", lichess.fetch);
    await client.connect();
    await client.query("begin");
    if ((await select(`select 1 from "matchday" where "date" = any($1::date[])`, [DATES])).length > 0)
      throw new Error("The Matchdays this test adds are taken; it needs a database without them, such as an empty one.");
    for (const table of ["season", "skippedSunday", "tournamentCancellation"]) await run(`delete from "${table}"`);
    // Season 1 before the Organiser's permission, in the order lib/create-matchdays.postgres.test.ts takes them, so that
    // the two, run at once, wait for each other rather than deadlock.
    await run(`insert into "season" ("number", "start") values (1, '2026-12-13')`);
    await run(
      `insert into "user" (id, name, email, "emailVerified", "updatedAt", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId", "lichessConnectedAt")
       values ($1, 'Test Organiser', $1 || '@example.invalid', false, now(), now(), now(), $1, now())`,
      [ORGANISER],
    );
    const { url, cookie } = startOrganiserConnection(ORGANISER);
    lichess.signedInAs = "boss";
    const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
    expect(await finishOrganiserConnection({ id: ORGANISER }, back.searchParams, cookie)).toBe("/organiser?lichess=connected");
    // A Sunday that has passed, its results never in; one before Season 1 whose tournament, made by hand, is in; one
    // with no tournament; and Season 1's first two, the second's tournament made by another account than the
    // Organiser's.
    await run(
      `insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values
         ('2026-11-22', 'PgPast01', null), ('2026-11-29', 'PgDone01', now()), ('2026-12-06', null, null),
         ('2026-12-13', 'PgFrst01', null), ('2026-12-20', 'PgScnd01', null)`,
    );
    lichess.tournaments.set("PgFrst01", swiss("PgFrst01", "2026-12-13"));
    lichess.tournaments.set("PgScnd01", swiss("PgScnd01", "2026-12-20", "someone-else"));
    lichess.calls.length = 0;
  }, 30_000);

  afterEach(() => {
    hooks.before = async () => {};
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }, 30_000);

  it("cancels and clears only the tournament of a Matchday still to come that is a Matchday no more", async () => {
    expect(await skipMatchday("2026-12-13", NOW)).toMatchObject({ problem: false });
    expect(cancels()).toEqual(["PgFrst01"]);
    expect(lichess.tournaments.has("PgFrst01")).toBe(false);
    // Season 1 now starts on 20 December. Only 13 December's tournament has gone; the others are as they were.
    expect(await matchdays()).toEqual({
      "2026-11-22": "PgPast01",
      "2026-11-29": "PgDone01 (ingested)",
      "2026-12-06": null,
      "2026-12-20": "PgScnd01",
    });
    expect(await tournamentCancellations()).toEqual([]);
  });

  it("keeps one Lichess will not cancel to cancel by hand, by its Sunday, and clears it all the same", async () => {
    await run(`insert into "tournamentCancellation" ("lichessTournamentId", "date", "problem") values ('PgKept01', '2026-11-29', 'Kept.')`);
    expect(await changeSeasonStart(1, "2026-12-27", NOW)).toMatchObject({ problem: true });
    expect(cancels()).toEqual(["PgFrst01", "PgScnd01"]);
    expect(await matchdays()).not.toHaveProperty("2026-12-20");
    // Why Lichess refused is written to its own row alone.
    expect(await tournamentCancellations()).toEqual([
      { lichessTournamentId: "PgKept01", date: "2026-11-29", problem: "Kept." },
      {
        lichessTournamentId: "PgScnd01",
        date: "2026-12-20",
        problem:
          "Lichess answered POST /api/swiss/{id}/terminate with 401: This user cannot edit this swiss. The likely cause: it was created with another Lichess account than boss, and only the account that created a tournament can cancel it.",
      },
    ]);
  });

  it("forgets one kept to cancel by hand whose Sunday is a Matchday again, and no other", async () => {
    expect(await changeSeasonStart(1, "2026-12-20", NOW)).toMatchObject({ problem: false });
    expect((await tournamentCancellations()).map((t) => t.lichessTournamentId)).toEqual(["PgKept01"]);
  });

  it("forgets the one the Organiser says is done, and no other", async () => {
    await run(`insert into "tournamentCancellation" ("lichessTournamentId", "date", "problem") values ('PgKept02', '2026-11-29', 'Kept.')`);
    await forgetTournamentCancellation("PgKept01");
    expect((await tournamentCancellations()).map((t) => t.lichessTournamentId)).toEqual(["PgKept02"]);
    await forgetTournamentCancellation("PgKept02");
    expect(await tournamentCancellations()).toEqual([]);
  });

  it("keeps neither the change nor the clearing of its tournament if the change's transaction fails", async () => {
    // Season 1 starts on 20 December; 27 December is its second Matchday.
    await run(`insert into "matchday" ("date", "lichessTournamentId") values ('2026-12-27', 'PgThrd01')`);
    hooks.before = async (sql) => {
      if (sql.startsWith('insert into "tournamentCancellation"')) throw new Error("Connection terminated unexpectedly");
    };
    await expect(skipMatchday("2026-12-27", NOW)).rejects.toThrow("Connection terminated unexpectedly");
    expect(await skipped()).toEqual(["2026-12-13"]);
    expect((await matchdays())["2026-12-27"]).toBe("PgThrd01");
    expect(await tournamentCancellations()).toEqual([]);
    expect(cancels()).not.toContain("PgThrd01");
  });

  it.each([
    ["given another tournament", `update "matchday" set "lichessTournamentId" = 'PgOther1' where "date" = '2026-12-27'`, "PgOther1"],
    ["ingested", `update "matchday" set "ingestedAt" = now() where "date" = '2026-12-27'`, "PgThrd01 (ingested)"],
  ])("leaves a Matchday %s between finding its tournament and clearing it as it now is", async (_, change, after) => {
    await run("savepoint racing");
    try {
      hooks.before = async (sql) => {
        if (sql.startsWith('delete from "matchday"')) await run(change);
      };
      expect(await skipMatchday("2026-12-27", NOW)).toMatchObject({ problem: false });
      expect((await matchdays())["2026-12-27"]).toBe(after);
      expect(await tournamentCancellations()).toEqual([]);
      expect(cancels()).not.toContain("PgThrd01");
    } finally {
      hooks.before = async () => {};
      await run("rollback to savepoint racing");
    }
  });
});
