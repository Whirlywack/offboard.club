// Ingesting a Matchday from a real Lichess Swiss export (lib/fixtures: 65 participants, 120 Games), through the one
// entry point the Organiser's command uses. Faked: Lichess itself (lib/fixtures/fake-lichess.ts, standing in for fetch)
// and the database (lib/fake-db.ts). Everything else, the Lichess client and the transaction included, is the app's.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCompany, addPerson, companies, db, games, matchdays, people, resetDb, results } from "@/lib/fake-db";
import { createFakeLichess, type FakeAccount, type FakeSwiss } from "@/lib/fixtures/fake-lichess";
import { LichessError } from "./lichess";
import { ingestTournament, registerTournament } from "./matchdays";
import { getRecap } from "./recaps";

vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// The recorded tournament, finished, on the Club's team. It started at 15:30 Vilnius time on Tuesday 24 November.
const TOURNAMENT = "PF2C2AUC";
const DATE = "2026-11-24";
const recorded = (more: Partial<FakeSwiss> = {}): FakeSwiss => ({
  id: TOURNAMENT,
  teamId: "offboard-team",
  status: "finished",
  startsAt: "2026-11-24T13:30:00Z",
  results: fixture("results.ndjson"),
  games: fixture("games.ndjson"),
  ...more,
});

// Six of the 65 participants are Members. The expected values below were read from the ndjson by a separate script.
// Lichess's final ranks: ana 1 (9.5 points, a late-join half point included), ben 2 (8), cora 9 (5), eve 23 (2, a
// one-point bye included), dan 28 (2), fay 42 (0.5, the late-join half point and no Game at all).
// Their Games with each other: dan-cora 7eeBoh4D (cora won on time), ben-ana T5PhEOXy (ana mated), ben-cora wmKSbb6v
// (ben mated).
const MEMBERS = {
  ana: "gevorgsargsyan",
  ben: "iksannur",
  cora: "olwerre",
  dan: "imparare_official",
  eve: "milosz0202",
  fay: "calvinlidasan",
};

// How Lichess shows those accounts now: some ratings moved, ben's account is marked, cora's is closed, eve has no blitz
// rating and fay's account no longer exists.
const accounts: FakeAccount[] = [
  { id: "gevorgsargsyan", username: "GEVorgSaRgSyAn", perfs: { blitz: { games: 900, rating: 1930, rd: 60, prog: 12 } } },
  { id: "iksannur", username: "iksannur", tosViolation: true, perfs: { blitz: { games: 500, rating: 1810, rd: 60, prog: 0 } } },
  { id: "olwerre", username: "Olwerre", disabled: true },
  { id: "imparare_official", username: "Imparare_official", perfs: { blitz: { games: 50, rating: 1700, rd: 80, prog: 3 } } },
  { id: "milosz0202", username: "Milosz0202" },
  { id: "hal-account", username: "Hal-Account", perfs: { blitz: { games: 5, rating: 1111, rd: 300, prog: 0 } } },
];

let lichess: ReturnType<typeof createFakeLichess>;

const requests = () => lichess.calls.map((c) => `${c.method} ${c.path}`);
const tables = () => structuredClone({ people, companies, matchdays, results, games });
const stored = (id: string) => results.get(`${DATE} ${id}`);

beforeEach(() => {
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.stubEnv("LICHESS_TEAM_ID", "offboard-team");
  lichess = createFakeLichess({ teamId: "offboard-team", teamPassword: "pw", accounts, tournaments: [recorded()] });
  vi.stubGlobal("fetch", lichess.fetch);
  resetDb();
  addCompany("vinted.com", "Vinted");
  addCompany("bolt.eu", "Bolt");
  for (const [id, lichessId] of Object.entries(MEMBERS)) addPerson(id, { lichessId, name: `Member ${id}` });
  people.get("ana")!.companyDomain = "vinted.com";
  people.get("ben")!.companyDomain = "bolt.eu";
  // A Member who did not play, and someone part-way through signing up whose Lichess account did play.
  addPerson("hal", { lichessId: "hal-account" });
  addPerson("gil", { lichessId: "enotik67", publicDisplayConsentAt: null, houseRulesAcceptedAt: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ingesting a finished tournament", () => {
  it("stores the Matchday of the Vilnius day it started on, with each Member's result and every Game between Members", async () => {
    expect(await ingestTournament(TOURNAMENT)).toEqual({ outcome: "ingested", date: DATE, members: 6, games: 3 });
    expect([...matchdays.values()]).toEqual([{ date: DATE, lichessTournamentId: TOURNAMENT, ingestedAt: expect.any(Date) }]);
    expect([...results.values()].sort((a, b) => a.rank - b.rank)).toEqual([
      { matchdayDate: DATE, userId: "ana", rank: 1, points: 9.5, rating: 1917, companyDomain: "vinted.com" },
      { matchdayDate: DATE, userId: "ben", rank: 2, points: 8, rating: 1803, companyDomain: "bolt.eu" },
      { matchdayDate: DATE, userId: "cora", rank: 3, points: 5, rating: 1584, companyDomain: null },
      { matchdayDate: DATE, userId: "eve", rank: 4, points: 2, rating: 761, companyDomain: null },
      { matchdayDate: DATE, userId: "dan", rank: 5, points: 2, rating: 1687, companyDomain: null },
      { matchdayDate: DATE, userId: "fay", rank: 6, points: 0.5, rating: 2286, companyDomain: null },
    ]);
    expect(games.get("7eeBoh4D")).toEqual({
      lichessGameId: "7eeBoh4D",
      matchdayDate: DATE,
      whiteId: "dan",
      blackId: "cora",
      winner: "black",
      status: "outoftime",
      plies: 110,
      whiteRating: 1694,
      blackRating: 1579,
      winnerClockCentis: 278, // fetched with clock times
      finishedAt: new Date(1795529563281),
    });
    expect([...games.values()].map((g) => [g.lichessGameId, g.whiteId, g.blackId, g.winner, g.status, g.plies])).toEqual([
      ["7eeBoh4D", "dan", "cora", "black", "outoftime", 110],
      ["T5PhEOXy", "ben", "ana", "black", "mate", 148],
      ["wmKSbb6v", "ben", "cora", "white", "mate", 79],
    ]);
  });

  it("carries bye and late-join points through, and counts a Member with no Game as having played", async () => {
    await ingestTournament(TOURNAMENT);
    expect(stored("ana")?.points).toBe(9.5); // a late-join half point included
    expect(stored("eve")?.points).toBe(2); // a one-point bye included
    expect(stored("fay")?.points).toBe(0.5); // only the late-join half point
    expect(results.size).toBe(6);
  });

  it("ignores participants who are not Members, including someone part-way through signing up", async () => {
    await ingestTournament(TOURNAMENT);
    expect([...results.values()].map((r) => r.userId).sort()).toEqual(["ana", "ben", "cora", "dan", "eve", "fay"]);
    // ben's win over gil's account (dbYkFn6j) is not a Game between two Members.
    expect(games.has("dbYkFn6j")).toBe(false);
    for (const game of games.values()) expect([game.whiteId, game.blackId].every((id) => id && id in MEMBERS)).toBe(true);
  });

  it("refreshes each participating Member's blitz rating and Lichess marks, and nobody else's", async () => {
    await ingestTournament(TOURNAMENT);
    const account = (id: string) => {
      const { lichessBlitzRating, lichessMarked, lichessClosed } = people.get(id)!;
      return { lichessBlitzRating, lichessMarked, lichessClosed };
    };
    expect(account("ana")).toEqual({ lichessBlitzRating: 1930, lichessMarked: false, lichessClosed: false });
    expect(account("ben")).toEqual({ lichessBlitzRating: 1810, lichessMarked: true, lichessClosed: false });
    // A closed account shows no rating, so the last one is kept.
    expect(account("cora")).toEqual({ lichessBlitzRating: 1500, lichessMarked: false, lichessClosed: true });
    expect(account("eve")).toEqual({ lichessBlitzRating: 1500, lichessMarked: false, lichessClosed: false });
    // An account Lichess no longer has at all is as good as closed.
    expect(account("fay")).toEqual({ lichessBlitzRating: 1500, lichessMarked: false, lichessClosed: true });
    expect(account("hal")).toEqual({ lichessBlitzRating: 1500, lichessMarked: false, lichessClosed: false });
  });

  it("asks Lichess without a token, as the site, for the Games in ndjson with their clock times, and the accounts in one go", async () => {
    await ingestTournament(TOURNAMENT);
    expect(requests()).toEqual([
      `GET /api/swiss/${TOURNAMENT}`,
      "GET /api/team/offboard-team/swiss",
      `GET /api/swiss/${TOURNAMENT}/results`,
      `GET /api/swiss/${TOURNAMENT}/games`,
      "POST /api/users",
    ]);
    for (const call of lichess.calls) {
      expect(call.authorization).toBeNull();
      expect(call.userAgent).toMatch(/offboard\.club/);
    }
    const [, , , gamesCall, usersCall] = lichess.calls;
    expect(gamesCall.accept).toBe("application/x-ndjson");
    expect(gamesCall.query.get("clocks")).toBe("true");
    expect(usersCall.text.split(",").sort()).toEqual(Object.values(MEMBERS).sort());
  });

  it("dates the Matchday by the Vilnius day its tournament started on", async () => {
    // 00:30 on Monday 30 November in Vilnius is still Sunday 29 November in UTC.
    lichess.tournaments.set(TOURNAMENT, recorded({ startsAt: "2026-11-29T22:30:00Z" }));
    expect(await ingestTournament(TOURNAMENT)).toMatchObject({ outcome: "ingested", date: "2026-11-30" });
  });

  it("stores a Matchday however few Members took part, even none", async () => {
    for (const id of Object.keys(MEMBERS)) people.delete(id);
    expect(await ingestTournament(TOURNAMENT)).toEqual({ outcome: "ingested", date: DATE, members: 0, games: 0 });
    expect(matchdays.get(DATE)?.ingestedAt).not.toBeNull();
    expect(requests()).not.toContain("POST /api/users");
  });
});

describe("running it again", () => {
  it("changes nothing, makes no duplicate rows and asks Lichess nothing", async () => {
    await ingestTournament(TOURNAMENT);
    const before = tables();
    lichess.calls.length = 0;
    expect(await ingestTournament(TOURNAMENT)).toEqual({ outcome: "unchanged", date: DATE });
    expect(tables()).toEqual(before);
    expect(lichess.calls).toEqual([]);
  });

  it("keeps each result under the Company the Member was at that night when they later change Company", async () => {
    await ingestTournament(TOURNAMENT);
    people.get("ana")!.companyDomain = "bolt.eu";
    people.get("ben")!.companyDomain = null;
    await ingestTournament(TOURNAMENT);
    expect(stored("ana")?.companyDomain).toBe("vinted.com");
    expect(stored("ben")?.companyDomain).toBe("bolt.eu");
    const recap = await getRecap(DATE);
    const company = (id: string) => recap?.leaderboard.find((r) => r.memberId === id)?.company;
    expect(company("ana")).toEqual({ domain: "vinted.com", name: "Vinted" });
    // ben's account is marked, so he is not on the Leaderboard at all.
    expect(company("ben")).toBeUndefined();
  });

  it("stores the Matchday once when two runs happen at the same moment", async () => {
    const outcomes = await Promise.all([ingestTournament(TOURNAMENT), ingestTournament(TOURNAMENT)]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(["ingested", "unchanged"]);
    expect(matchdays.size).toBe(1);
    expect(results.size).toBe(6);
    expect(games.size).toBe(3);
  });
});

describe("refusing a tournament, storing nothing", () => {
  async function refused(id: string) {
    const before = tables();
    const ingestion = await ingestTournament(id);
    expect(tables()).toEqual(before);
    expect(ingestion.outcome).toBe("refused");
    return ingestion.outcome === "refused" ? ingestion.problem : "";
  }

  it("refuses a tournament that has not finished, without fetching its results or Games", async () => {
    lichess.tournaments.set(TOURNAMENT, recorded({ status: "started" }));
    expect(await refused(TOURNAMENT)).toBe("Tournament PF2C2AUC has not finished yet, so it cannot be ingested.");
    lichess.tournaments.set(TOURNAMENT, recorded({ status: "created" }));
    expect(await refused(TOURNAMENT)).toMatch(/has not finished yet/);
    expect(requests().filter((r) => /results|games|users/.test(r))).toEqual([]);
  });

  it("refuses a tournament on another team", async () => {
    lichess.tournaments.set(TOURNAMENT, recorded({ teamId: "someone-else" }));
    // A later tournament on the Club's team, to read past.
    lichess.tournaments.set("LATER123", recorded({ id: "LATER123", startsAt: "2026-11-29T18:00:00Z" }));
    expect(await refused(TOURNAMENT)).toBe("Tournament PF2C2AUC is not on the Club's Lichess team.");
  });

  it("refuses a tournament Lichess does not know", async () => {
    expect(await refused("NoSuchId")).toBe("Lichess has no Swiss tournament NoSuchId.");
  });

  it("refuses something that is not a tournament id without asking Lichess", async () => {
    expect(await refused("../../api/account")).toMatch(/is not a Lichess Swiss tournament id/);
    expect(await refused("")).toMatch(/is not a Lichess Swiss tournament id/);
    expect(lichess.calls).toEqual([]);
  });

  it("refuses when the Club's team is not configured", async () => {
    vi.stubEnv("LICHESS_TEAM_ID", "");
    expect(await refused(TOURNAMENT)).toMatch(/LICHESS_TEAM_ID is not set/);
    expect(lichess.calls).toEqual([]);
  });

  it("refuses a tournament on a day whose Matchday is another tournament, ingested or not", async () => {
    expect(await registerTournament(DATE, "OTHER123")).toBe(true);
    expect(await refused(TOURNAMENT)).toBe("The Matchday of 2026-11-24 is tournament OTHER123, not PF2C2AUC.");
    matchdays.get(DATE)!.ingestedAt = new Date();
    expect(await refused(TOURNAMENT)).toBe("The Matchday of 2026-11-24 is tournament OTHER123, not PF2C2AUC.");
  });

  it("refuses a tournament registered for one day that Lichess says started on another", async () => {
    expect(await registerTournament("2026-11-22", TOURNAMENT)).toBe(true);
    expect(await refused(TOURNAMENT)).toBe("Tournament PF2C2AUC is the Matchday of 2026-11-22, but Lichess says it started on 2026-11-24.");
  });
});

describe("a failure part-way", () => {
  it("stores nothing when Lichess fails while sending the Games", async () => {
    lichess.override = (call) => (call.path.endsWith("/games") ? Response.json({ error: "oops" }, { status: 500 }) : undefined);
    const before = tables();
    await expect(ingestTournament(TOURNAMENT)).rejects.toThrow(LichessError);
    expect(tables()).toEqual(before);
  });

  it("stores nothing when Lichess fails while sending the accounts, ratings and marks included", async () => {
    lichess.override = (call) => (call.path === "/api/users" ? new Response("not json", { status: 502 }) : undefined);
    const before = tables();
    await expect(ingestTournament(TOURNAMENT)).rejects.toThrow(LichessError);
    expect(tables()).toEqual(before);
  });

  it("undoes everything already written in the transaction when a later write fails", async () => {
    // fay deletes her account while Lichess is answering, so her result cannot be stored: the Matchday, the results
    // before hers and the Games are all rolled back with it.
    lichess.override = (call) => {
      if (call.path === "/api/users") people.delete("fay");
      return undefined;
    };
    const before = tables();
    before.people.delete("fay");
    await expect(ingestTournament(TOURNAMENT)).rejects.toMatchObject({ code: "23503" });
    expect(db.connect).toHaveBeenCalledTimes(1);
    expect(tables()).toEqual(before);
    // The next run, without fay, goes through.
    lichess.override = undefined;
    expect(await ingestTournament(TOURNAMENT)).toMatchObject({ outcome: "ingested", members: 5 });
  });
});

describe("a Matchday registered ahead (#11)", () => {
  it("is filled in by ingestion rather than stored again", async () => {
    expect(await registerTournament(DATE, TOURNAMENT)).toBe(true);
    expect(matchdays.get(DATE)).toEqual({ date: DATE, lichessTournamentId: TOURNAMENT, ingestedAt: null });
    expect(await ingestTournament(TOURNAMENT)).toMatchObject({ outcome: "ingested", date: DATE });
    expect([...matchdays.values()]).toEqual([{ date: DATE, lichessTournamentId: TOURNAMENT, ingestedAt: expect.any(Date) }]);
  });

  it("can be registered again with the same tournament, but not with another, nor the tournament on another day", async () => {
    expect(await registerTournament(DATE, TOURNAMENT)).toBe(true);
    expect(await registerTournament(DATE, TOURNAMENT)).toBe(true);
    expect(await registerTournament(DATE, "OTHER123")).toBe(false);
    expect(await registerTournament("2026-11-29", TOURNAMENT)).toBe(false);
    expect([...matchdays.values()]).toEqual([{ date: DATE, lichessTournamentId: TOURNAMENT, ingestedAt: null }]);
  });
});
