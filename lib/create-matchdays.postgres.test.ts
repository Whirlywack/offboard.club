import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { createUpcomingMatchday, JOB } from "./create-matchdays";
import { lastFailure } from "./jobs";
import { finishOrganiserConnection, organiserPermission, organiserToken, startOrganiserConnection } from "./organiser-lichess";
import { addDays, matchdayStart } from "./schedule";

// Point this at a local database only, never a shared or live one. It holds the "create-matchdays" job's row, and
// any Season 1 and Organiser permission it adds, locked until its transaction ends, so against the live database the
// real scheduled job would wait on it.
//
// The Organiser's permission, the scheduled job's bookkeeping and the creation of a Matchday, with their real SQL against
// the database in DATABASE_URL, inside one transaction that is always rolled back, so nothing it does is kept; Lichess is
// the fake. migrations/007_organiser.sql is applied inside that transaction if the database does not have it yet. The
// rows it adds are its own (a test person, Season 1 if none is stored, the permission, the job's rows) and it changes no
// row it did not add. Skipped unless ALLOW_DB_TESTS=1 as well as DATABASE_URL, so a plain `pnpm test`, or one with
// .env.local loaded, never runs it. Run it against a local database from `pnpm db:start`, before seeding (once that one
// is seeded, a second from `pnpm db:start --dir .local-db-tests`), with that database's address:
// ALLOW_DB_TESTS=1 DATABASE_URL=<that address> node node_modules/vitest/vitest.mjs run lib/create-matchdays.postgres.test.ts
vi.mock("@/lib/db", async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // Nothing the app sends may end the test's transaction.
  const query = (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|start|commit|end|rollback|abort)\b/i.test(sql)) throw new Error(`refused inside the test's transaction: ${sql}`);
    return client.query(sql, params);
  };
  return { db: { client, query } };
});

const TEAM = "offboard-team";
const ORGANISER = `test-organiser-${randomBytes(6).toString("hex")}`;
const FIVE_DAYS = 5 * 86_400_000;

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the Organiser's permission and the job in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;
  const lichess = createFakeLichess({
    teamId: TEAM,
    teamPassword: "pw",
    accounts: [
      { id: "boss", username: "Boss" },
      { id: "deputy", username: "Deputy" },
    ],
  });
  lichess.team.leaders.add("boss").add("deputy");
  const select = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  let first: string; // the date of Season 1's first Matchday
  const runFiveDaysBefore = (date: string) => {
    const now = new Date(matchdayStart(date).getTime() - FIVE_DAYS);
    lichess.now = () => now.getTime();
    return createUpcomingMatchday(now);
  };

  async function connectAs(account: string) {
    const { url, cookie } = startOrganiserConnection(ORGANISER);
    lichess.signedInAs = account;
    const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
    return finishOrganiserConnection({ id: ORGANISER }, back.searchParams, cookie);
  }

  beforeAll(async () => {
    vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
    vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
    vi.stubEnv("BETTER_AUTH_SECRET", "test secret");
    vi.stubEnv("LICHESS_TEAM_ID", TEAM);
    vi.stubEnv("ORGANISER_USER_ID", ORGANISER);
    vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"));
    vi.stubGlobal("fetch", lichess.fetch);
    if (!("client" in db)) throw new Error("the database must be the test's own transaction");
    await client.connect();
    await client.query("begin");
    const [{ applied }] = await select(`select to_regclass('"organiserLichess"') is not null as applied`);
    if (!applied) await client.query(readFileSync(new URL("../migrations/007_organiser.sql", import.meta.url), "utf8"));
    await client.query(
      `insert into "user" (id, name, email, "emailVerified", "updatedAt", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId", "lichessConnectedAt")
       values ($1, 'Test Organiser', $1 || '@example.invalid', false, now(), now(), now(), $1, now())`,
      [ORGANISER],
    );
    // Season 1 as stored, or, if none is, starting on a Sunday about three weeks from now.
    const [season] = await select(`select to_char("start", 'YYYY-MM-DD') as "start" from "season" where "number" = 1`);
    if (season) first = season.start;
    else {
      const day = new Date(Date.now() + 21 * 86_400_000);
      first = addDays(day.toISOString().slice(0, 10), (7 - day.getUTCDay()) % 7);
      await client.query(`insert into "season" ("number", "start") values (1, $1)`, [first]);
    }
    const [taken] = await select(`select 1 from "matchday" where "date" in ($1, $2)`, [first, addDays(first, 7)]);
    if (taken) throw new Error("Season 1's first Matchdays already have tournaments; this test needs them free");
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }, 30_000);

  it("keeps the Organiser's permission in one row, sealed, and replaces it on connecting again", async () => {
    expect(await connectAs("boss")).toBe("/organiser?lichess=connected");
    expect(await organiserPermission()).toMatchObject({ lichessId: "boss", scopes: "tournament:write team:lead", expiresAt: expect.any(Date) });
    const kept = await organiserToken(new Date());
    if (!("token" in kept)) throw new Error(kept.problem);
    const [row] = await select(`select "token" from "organiserLichess" where "userId" = $1`, [ORGANISER]);
    expect(row.token).toMatch(/^v1\./);
    expect(row.token).not.toContain(kept.token);

    expect(await connectAs("deputy")).toBe("/organiser?lichess=connected");
    expect(await select(`select "lichessId" from "organiserLichess"`)).toEqual([{ lichessId: "deputy" }]);
    expect(lichess.tokens.get(kept.token)?.revoked).toBe(true);
    await client.query("savepoint second");
    await expect(
      client.query(`insert into "organiserLichess" ("singleton", "userId", "lichessId", "scopes", "token", "expiresAt") values (false, $1, 'x', 'x', 'x', now())`, [ORGANISER]),
    ).rejects.toMatchObject({ code: "23514" });
    await client.query("rollback to savepoint second");
  });

  it("creates the upcoming Matchday's tournament once, and records the run", async () => {
    const run = await runFiveDaysBefore(first);
    expect(run).toMatchObject({ outcome: "done", matchdayDate: first });
    const [matchday] = await select(`select "lichessTournamentId", "ingestedAt" from "matchday" where "date" = $1`, [first]);
    expect(lichess.tournaments.get(matchday.lichessTournamentId)).toMatchObject({ startsAt: matchdayStart(first).toISOString(), createdBy: "deputy" });
    expect(matchday.ingestedAt).toBeNull();
    expect(await select(`select "lockedBy", "lockedUntil", "lastOutcome", "lastDetail" from "scheduledJob" where "job" = $1`, [JOB])).toEqual([
      { lockedBy: null, lockedUntil: null, lastOutcome: "done", lastDetail: run.detail },
    ]);
    expect(await runFiveDaysBefore(first)).toMatchObject({ outcome: "skipped", detail: expect.stringContaining("already has its tournament") });
    expect([...lichess.tournaments.values()].filter((t) => t.form)).toHaveLength(1);
  });

  it("does nothing while another run holds the job, until its hold lapses", async () => {
    await client.query(`update "scheduledJob" set "lockedBy" = 'another run', "lockedUntil" = now() + interval '1 minute' where "job" = $1`, [JOB]);
    expect(await runFiveDaysBefore(first)).toMatchObject({ outcome: "skipped", detail: expect.stringContaining("Another run") });
    expect(await select(`select "lockedBy" from "scheduledJob" where "job" = $1`, [JOB])).toEqual([{ lockedBy: "another run" }]);
    await client.query(`update "scheduledJob" set "lockedUntil" = now() - interval '1 second' where "job" = $1`, [JOB]);
    expect(await runFiveDaysBefore(first)).toMatchObject({ outcome: "skipped", detail: expect.stringContaining("already has its tournament") });
    expect(await select(`select "lockedBy", "lockedUntil" from "scheduledJob" where "job" = $1`, [JOB])).toEqual([{ lockedBy: null, lockedUntil: null }]);
  });

  it("records each failure with its Matchday, and gives the latest", async () => {
    const second = addDays(first, 7);
    vi.stubEnv("ORGANISER_USER_ID", "someone-else");
    await runFiveDaysBefore(second);
    vi.stubEnv("LICHESS_TEAM_ID", "");
    await runFiveDaysBefore(second);
    await runFiveDaysBefore(second); // the same problem again: no new failure
    vi.stubEnv("ORGANISER_USER_ID", ORGANISER);
    vi.stubEnv("LICHESS_TEAM_ID", TEAM);
    const failures = await select(`select "job", to_char("matchdayDate", 'YYYY-MM-DD') as "matchdayDate", "problem" from "jobFailure" where "matchdayDate" = $1 order by "id"`, [second]);
    expect(failures).toEqual([
      { job: JOB, matchdayDate: second, problem: expect.stringContaining("has not connected their Lichess account") },
      { job: JOB, matchdayDate: second, problem: expect.stringContaining("LICHESS_TEAM_ID is not set") },
    ]);
    expect(await lastFailure()).toEqual({ job: JOB, at: expect.any(Date), matchdayDate: second, problem: failures[1].problem });
    expect(await select(`select "lastOutcome" from "scheduledJob" where "job" = $1`, [JOB])).toEqual([{ lastOutcome: "failed" }]);
    expect(await runFiveDaysBefore(second)).toMatchObject({ outcome: "done", matchdayDate: second });
  });
});
