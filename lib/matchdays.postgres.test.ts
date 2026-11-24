import { readFileSync } from "node:fs";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { ingestTournament, registerTournament } from "./matchdays";
import { getRecap, recapDates } from "./recaps";

// Ingestion's and the Recap's real SQL against the database in DATABASE_URL, inside one transaction that is always
// rolled back, so nothing it does is kept; Lichess is the fake. The app's database is one connection holding that
// transaction, and the ingestion's own transaction a savepoint within it. Skipped when DATABASE_URL is not set, as in a
// plain `pnpm test`. To run it:
// node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/matchdays.postgres.test.ts
vi.mock("@/lib/db", async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const inner: Record<string, string> = {
    begin: "savepoint ingestion",
    commit: "release savepoint ingestion",
    rollback: "rollback to savepoint ingestion",
  };
  // Nothing the app sends may end the test's transaction.
  const query = (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|start|commit|end|rollback|abort)\b/i.test(sql)) throw new Error(`refused inside the test's transaction: ${sql}`);
    return client.query(sql, params);
  };
  const connect = async () => ({
    query: (sql: string, params?: unknown[]) => (Object.hasOwn(inner, sql) ? client.query(inner[sql]) : query(sql, params)),
    release: () => {},
  });
  return { db: { client, query, connect } };
});

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const TOURNAMENT = "PF2C2AUC";
// The recorded exports, standing for the Matchday of Sunday 22 November.
const DATE = "2026-11-22";

describe.skipIf(!process.env.DATABASE_URL)("ingestion and the Recap in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;
  const lichess = createFakeLichess({
    teamId: "offboard-team",
    teamPassword: "pw",
    accounts: [
      { id: "gevorgsargsyan", username: "GEVorgSaRgSyAn", perfs: { blitz: { games: 900, rating: 1930, rd: 60, prog: 12 } } },
      { id: "iksannur", username: "iksannur", tosViolation: true },
      { id: "olwerre", username: "Olwerre", perfs: { blitz: { games: 9, rating: 1590, rd: 60, prog: 1 } } },
    ],
    tournaments: [
      {
        id: TOURNAMENT,
        teamId: "offboard-team",
        status: "finished",
        startsAt: "2026-11-22T18:00:00Z",
        results: fixture("results.ndjson"),
        games: fixture("games.ndjson"),
      },
    ],
  });
  const select = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;

  beforeAll(async () => {
    vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
    vi.stubEnv("LICHESS_TEAM_ID", "offboard-team");
    vi.stubGlobal("fetch", lichess.fetch);
    if (!("client" in db)) throw new Error("the database must be the test's own transaction");
    await client.connect();
    await client.query("begin");
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

  it("stores a Matchday once, keeps the Company of that night, and keeps a departed Member's Games", async () => {
    // Seen from inside the transaction only.
    await client.query(`delete from "game"`);
    await client.query(`delete from "matchdayResult"`);
    await client.query(`delete from "matchday"`);
    await client.query(`delete from "skippedSunday"`);
    await client.query(`insert into "company" ("domain", "name") values ('ingest-test.example', 'Ingest Test')`);
    // Three Members who played the recorded tournament, and someone part-way through signing up who did too.
    const addPerson = (id: string, lichessId: string, welcomed = true, companyDomain: string | null = null) =>
      client.query(
        `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId", "lichessUsername", "lichessBlitzRating", "lichessConnectedAt", "companyDomain")
         values ($1, $1, $2, false, $3, $3, $4, $4, 1500, '2026-01-01T00:00:00Z', $5)`,
        [id, `${id}@example.invalid`, welcomed ? "2026-01-01T00:00:00Z" : null, lichessId, companyDomain],
      );
    await addPerson("ingest-test-ana", "gevorgsargsyan", true, "ingest-test.example");
    await addPerson("ingest-test-ben", "iksannur");
    await addPerson("ingest-test-cora", "olwerre");
    await addPerson("ingest-test-gil", "enotik67", false);

    expect(await registerTournament(DATE, TOURNAMENT)).toBe(true);
    expect(await registerTournament(DATE, "OTHER123")).toBe(false);
    expect(await ingestTournament(TOURNAMENT)).toEqual({
      outcome: "ingested",
      date: DATE,
      participants: 65,
      members: 3,
      games: 2,
      redone: false,
    });
    expect(await ingestTournament(TOURNAMENT)).toEqual({ outcome: "unchanged", date: DATE });

    expect(await select(`select to_char("date", 'YYYY-MM-DD') as "date", "lichessTournamentId", "ingestedAt" is not null as "ingested" from "matchday"`)).toEqual([
      { date: DATE, lichessTournamentId: TOURNAMENT, ingested: true },
    ]);
    expect(await select(`select "userId", "rank", "points", "rating", "companyDomain" from "matchdayResult" order by "rank"`)).toEqual([
      { userId: "ingest-test-ana", rank: 1, points: 9.5, rating: 1917, companyDomain: "ingest-test.example" },
      { userId: "ingest-test-ben", rank: 2, points: 8, rating: 1803, companyDomain: null },
      { userId: "ingest-test-cora", rank: 3, points: 5, rating: 1584, companyDomain: null },
    ]);
    expect(await select(`select "lichessGameId", "whiteId", "blackId", "winner", "status", "plies", "winnerClockCentis" is not null as "clock" from "game" order by "finishedAt"`)).toEqual([
      { lichessGameId: "T5PhEOXy", whiteId: "ingest-test-ben", blackId: "ingest-test-ana", winner: "black", status: "mate", plies: 148, clock: true },
      { lichessGameId: "wmKSbb6v", whiteId: "ingest-test-ben", blackId: "ingest-test-cora", winner: "white", status: "mate", plies: 79, clock: true },
    ]);
    expect(await select(`select id, "lichessBlitzRating", "lichessMarked", "lichessClosed" from "user" where id like 'ingest-test-%' order by id`)).toEqual([
      { id: "ingest-test-ana", lichessBlitzRating: 1930, lichessMarked: false, lichessClosed: false },
      { id: "ingest-test-ben", lichessBlitzRating: 1500, lichessMarked: true, lichessClosed: false },
      { id: "ingest-test-cora", lichessBlitzRating: 1590, lichessMarked: false, lichessClosed: false },
      { id: "ingest-test-gil", lichessBlitzRating: 1500, lichessMarked: false, lichessClosed: false },
    ]);

    // ana changes Company; the Recap keeps the one she had that night. ben's account is marked, so he is left out.
    await client.query(`update "user" set "companyDomain" = null where id = 'ingest-test-ana'`);
    expect(await recapDates()).toEqual([DATE]);
    expect(await getRecap(DATE)).toEqual({
      date: DATE,
      lichessTournamentId: TOURNAMENT,
      leaderboard: [
        { memberId: "ingest-test-ana", rank: 1, points: 9.5, rating: 1917, name: "ingest-test-ana", company: { domain: "ingest-test.example", name: "Ingest Test" } },
        { memberId: "ingest-test-cora", rank: 2, points: 5, rating: 1584, name: "ingest-test-cora", company: null },
      ],
      // Both Games were ben's, and his account is marked.
      awards: [],
    });
    expect(await getRecap("2026-11-23")).toBeNull();

    // gil finishes signing up after playing; a redo takes him in, and ana keeps the Company recorded the first time.
    await client.query(`update "user" set "publicDisplayConsentAt" = now(), "houseRulesAcceptedAt" = now() where id = 'ingest-test-gil'`);
    expect(await ingestTournament(TOURNAMENT, { redo: true })).toMatchObject({ outcome: "ingested", members: 4, games: 3, redone: true });
    expect(await select(`select "userId", "rank", "companyDomain" from "matchdayResult" order by "rank"`)).toEqual([
      { userId: "ingest-test-ana", rank: 1, companyDomain: "ingest-test.example" },
      { userId: "ingest-test-ben", rank: 2, companyDomain: null },
      { userId: "ingest-test-cora", rank: 3, companyDomain: null },
      { userId: "ingest-test-gil", rank: 4, companyDomain: null },
    ]);
    expect(await select(`select count(*)::int as n from "game"`)).toEqual([{ n: 3 }]);

    // cora deletes her account (#15): her result goes, and her Game stays in ben's history with her side empty.
    await client.query(`delete from "user" where id = 'ingest-test-cora'`);
    expect(await select(`select "userId" from "matchdayResult" order by "rank"`)).toEqual([
      { userId: "ingest-test-ana" },
      { userId: "ingest-test-ben" },
      { userId: "ingest-test-gil" },
    ]);
    expect(await select(`select "whiteId", "blackId" from "game" where "lichessGameId" = 'wmKSbb6v'`)).toEqual([
      { whiteId: "ingest-test-ben", blackId: null },
    ]);
  }, 60_000);

  it("rolls back everything an ingestion wrote when a later write fails", async () => {
    await client.query(`delete from "game"`);
    await client.query(`delete from "matchdayResult"`);
    await client.query(`delete from "matchday"`);
    // ben deletes his account while Lichess is answering, so his result cannot be stored.
    lichess.override = (call) => {
      if (call.path === "/api/users") void client.query(`delete from "user" where id = 'ingest-test-ben'`);
      return undefined;
    };
    await expect(ingestTournament(TOURNAMENT)).rejects.toMatchObject({ code: "23503" });
    lichess.override = undefined;
    expect(await select(`select count(*)::int as n from "matchday"`)).toEqual([{ n: 0 }]);
    expect(await select(`select count(*)::int as n from "matchdayResult"`)).toEqual([{ n: 0 }]);
    expect(await select(`select count(*)::int as n from "game"`)).toEqual([{ n: 0 }]);
  }, 60_000);

  it("refuses plainly when the tournament is registered for another day while it is being fetched", async () => {
    lichess.override = (call) => {
      if (call.path === "/api/users") void registerTournament("2026-11-15", TOURNAMENT);
      return undefined;
    };
    expect(await ingestTournament(TOURNAMENT)).toEqual({
      outcome: "refused",
      problem: "Tournament PF2C2AUC became the Matchday of 2026-11-15 while it was being ingested.",
    });
    lichess.override = undefined;
    expect(await select(`select to_char("date", 'YYYY-MM-DD') as "date", "ingestedAt" from "matchday"`)).toEqual([
      { date: "2026-11-15", ingestedAt: null },
    ]);
  }, 60_000);
});
