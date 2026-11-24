// The Season and all-time Leaderboards as read from ingested Matchdays, against the schedule. Faked: the database
// (lib/fake-db.ts), filled in as ingestion and the schedule leave it. Everything else is the app's own code.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCompany, addPerson, db, matchdays, people, resetDb, results, seasons, skippedSundays } from "@/lib/fake-db";
import { getAllTime, getSeason, newChampions, seasonOfMatchday, seasonsSoFar } from "./leaderboards";

vi.mock("@/lib/db", () => import("@/lib/fake-db"));

// Season 1 starts on Sunday 6 December 2026 and 20 December is skipped, so its six Matchdays run to 17 January. After
// a week off, Season 2 starts on 31 January.
const SEASON_1 = ["2026-12-06", "2026-12-13", "2026-12-27", "2027-01-03", "2027-01-10", "2027-01-17"];
const SEASON_2 = ["2027-01-31", "2027-02-07", "2027-02-14", "2027-02-21", "2027-02-28", "2027-03-07"];
const BEFORE_SEASON_1 = "2026-11-29";
const WEEK_OFF = "2027-01-24";
const NOW = new Date("2027-03-10T12:00:00Z");

// A Matchday as ingestion leaves it: the Members' results in Lichess's order, each with the Company of that night.
function ingested(date: string, rows: [userId: string, points: number, companyDomain?: string][]) {
  matchdays.set(date, { date, lichessTournamentId: `T${date.replaceAll("-", "").slice(1)}`, ingestedAt: new Date() });
  rows.forEach(([userId, points, companyDomain = null], i) =>
    results.set(`${date} ${userId}`, { matchdayDate: date, userId, rank: i + 1, points, rating: 1500, companyDomain }),
  );
}

// The Leaderboard as [Member, rank, Season score, Matchdays played].
const season = async (n = 1, now = NOW) => (await getSeason(n, now))!;
const board = async (n = 1, now = NOW) => (await season(n, now)).leaderboard.map((r) => [r.memberId, r.rank, r.score, r.played]);
const allTime = async () => (await getAllTime()).map((r) => [r.memberId, r.rank, r.played]);
const champions = async (n = 1, now = NOW) => (await season(n, now)).champions.map((c) => c.name);

beforeEach(() => {
  resetDb();
  seasons.set(1, { number: 1, start: "2026-12-06" });
  skippedSundays.set("2026-12-20", { date: "2026-12-20" });
  addCompany("vinted.com", "Vinted");
  addCompany("bolt.eu", "Bolt");
  addCompany("nord.lt", "nord.lt"); // a Company whose website gave no name
  for (const [id, name] of [
    ["ana", "Ana Petraitė"],
    ["ben", "Benas Kazlauskas"],
    ["cid", "Cidas Jonaitis"],
    ["dan", "Danutė Žemaitė"],
  ])
    addPerson(id, { name });
});

describe("which Season a Matchday belongs to", () => {
  it("is the Season whose six Sundays include its date, a skipped Sunday not among them", async () => {
    for (const date of SEASON_1) ingested(date, [["ana", 1]]);
    expect((await season()).matchdays).toEqual(SEASON_1.map((date) => ({ date, ingested: true })));
    expect(await seasonOfMatchday("2026-12-27", NOW)).toEqual({ season: 1, number: 3 });
    expect(await seasonOfMatchday("2027-01-31", NOW)).toEqual({ season: 2, number: 1 });
    expect(await seasonOfMatchday("2027-03-07", NOW)).toEqual({ season: 2, number: 6 });
  });

  it("is none for a Matchday before Season 1 or in the week off, which counts on the all-time Leaderboard only", async () => {
    ingested(BEFORE_SEASON_1, [["ben", 5]]);
    ingested(SEASON_1[0], [["ana", 3]]);
    ingested(WEEK_OFF, [["cid", 5]]);
    expect(await seasonOfMatchday(BEFORE_SEASON_1, NOW)).toBeNull();
    expect(await seasonOfMatchday(WEEK_OFF, NOW)).toBeNull();
    expect(await board(1)).toEqual([["ana", 1, 3, 1]]);
    expect(await board(2)).toEqual([]);
    expect(await allTime()).toEqual([
      ["ana", 1, 1],
      ["ben", 1, 1],
      ["cid", 1, 1],
    ]);
  });

  it("is none for a date that cannot be a Matchday's, without reading the database", async () => {
    db.query.mockClear();
    for (const date of ["2027-01-05", "abc", "2025-12-28"]) expect(await seasonOfMatchday(date, NOW)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("a Season Leaderboard", () => {
  it("scores each Member on their best four of six Matchdays", async () => {
    [5, 1, 4, 3, 2, 4.5].forEach((points, i) => ingested(SEASON_1[i], [["ana", points]]));
    // 5 + 4.5 + 4 + 3: the 2 and the 1 are dropped.
    expect(await board()).toEqual([["ana", 1, 16.5, 6]]);
  });

  it("shows a Member who joins mid-Season from their first Matchday", async () => {
    ingested(SEASON_1[0], [["ana", 3]]);
    ingested(SEASON_1[1], [["ana", 3]]);
    expect(await board()).toEqual([["ana", 1, 6, 2]]);
    ingested(SEASON_1[2], [["ben", 4], ["ana", 3]]);
    expect(await board()).toEqual([
      ["ana", 1, 9, 3],
      ["ben", 2, 4, 1],
    ]);
  });

  it("breaks a tie on Season score by more Matchdays played, and Members still level share the rank", async () => {
    ingested(SEASON_1[0], [["ana", 4], ["ben", 4], ["dan", 4], ["cid", 2]]);
    ingested(SEASON_1[1], [["ana", 4], ["ben", 4], ["dan", 4], ["cid", 2]]);
    ingested(SEASON_1[2], [["cid", 4]]);
    ingested(SEASON_1[3], [["cid", 4]]);
    // Ana, Ben and Dan 8 from two Matchdays; Cid 12 from four.
    expect(await board()).toEqual([
      ["cid", 1, 12, 4],
      ["ana", 2, 8, 2],
      ["ben", 2, 8, 2],
      ["dan", 2, 8, 2],
    ]);
    ingested(SEASON_1[4], [["ben", 0], ["dan", 0]]);
    // Still 8 each, but Ben and Dan have played three: they go above Ana and stay level with each other.
    expect(await board()).toEqual([
      ["cid", 1, 12, 4],
      ["ben", 2, 8, 3],
      ["dan", 2, 8, 3],
      ["ana", 4, 8, 2],
    ]);
  });

  it("leaves out a Member whose Lichess account is marked or closed while it lasts, and the rest move up", async () => {
    ingested(SEASON_1[0], [["ben", 5], ["cid", 4], ["ana", 3]]);
    people.get("ben")!.lichessMarked = true;
    people.get("cid")!.lichessClosed = true;
    expect(await board()).toEqual([["ana", 1, 3, 1]]);
    expect(await allTime()).toEqual([["ana", 1, 1]]);
    people.get("ben")!.lichessMarked = false;
    expect(await board()).toEqual([
      ["ben", 1, 5, 1],
      ["ana", 2, 3, 1],
    ]);
  });

  it("never lists a person part-way through signing up, or anyone else who is not a Member", async () => {
    addPerson("half", { name: "Not Yet", lichessId: null });
    addPerson("new", { name: "Also Not Yet", publicDisplayConsentAt: null, houseRulesAcceptedAt: null });
    ingested(SEASON_1[0], [["half", 5], ["new", 4], ["ana", 3]]);
    expect(await board()).toEqual([["ana", 1, 3, 1]]);
    expect(await allTime()).toEqual([["ana", 1, 1]]);
  });

  it("names each Member with the Company of the latest Matchday they played in the Season", async () => {
    ingested(SEASON_1[0], [["ana", 2, "vinted.com"], ["ben", 1, "nord.lt"]]);
    ingested(SEASON_1[1], [["ana", 2, "bolt.eu"]]);
    ingested(SEASON_2[0], [["ana", 2, "nord.lt"], ["ben", 1]]);
    people.get("ana")!.companyDomain = "vinted.com";
    const one = (await season(1)).leaderboard.map((r) => [r.name, r.company]);
    expect(one).toEqual([
      ["Ana Petraitė", { domain: "bolt.eu", name: "Bolt" }],
      ["Benas Kazlauskas", { domain: "nord.lt", name: "nord.lt" }],
    ]);
    // In Season 2 Ben gave no Company; the all-time Leaderboard shows where each Member is now.
    expect((await season(2)).leaderboard.map((r) => r.company)).toEqual([{ domain: "nord.lt", name: "nord.lt" }, null]);
    expect((await getAllTime()).map((r) => r.company)).toEqual([{ domain: "vinted.com", name: "Vinted" }, null]);
  });

  it("is empty for a Season with no ingested Matchday yet", async () => {
    ingested(SEASON_1[0], [["ana", 1]]);
    matchdays.set(SEASON_2[0], { date: SEASON_2[0], lichessTournamentId: "NOTYET01", ingestedAt: null });
    expect(await season(2)).toEqual({
      number: 2,
      matchdays: SEASON_2.map((date) => ({ date, ingested: false })),
      leaderboard: [],
      over: false,
      champions: [],
    });
  });
});

describe("the Season champion", () => {
  const fiveMatchdays = () => {
    ingested(SEASON_1[0], [["ana", 4], ["ben", 3]]);
    for (const date of SEASON_1.slice(1, 5)) ingested(date, [["ana", 4]]);
  };

  it("is named only once the sixth Matchday has been ingested", async () => {
    fiveMatchdays();
    expect(await season()).toMatchObject({ over: false, champions: [] });
    ingested(SEASON_1[5], [["ben", 5]]);
    expect(await season()).toMatchObject({ over: true });
    expect(await champions()).toEqual(["Ana Petraitė"]);
  });

  it("is named even if a Matchday before the sixth was never ingested", async () => {
    ingested(SEASON_1[0], [["ben", 3]]);
    ingested(SEASON_1[5], [["ana", 2]]);
    expect(await champions()).toEqual(["Benas Kazlauskas"]);
  });

  it("is shared by every Member still level at the top", async () => {
    for (const date of SEASON_1.slice(0, 4)) ingested(date, [["dan", 4], ["ana", 4]]);
    ingested(SEASON_1[4], [["cid", 1]]);
    ingested(SEASON_1[5], [["cid", 1]]);
    expect(await champions()).toEqual(["Ana Petraitė", "Danutė Žemaitė"]);
  });

  it("is worked out from the Leaderboard as it is now, so it moves if the champion's account is marked", async () => {
    fiveMatchdays();
    ingested(SEASON_1[5], [["ben", 5]]);
    people.get("ana")!.lichessMarked = true;
    expect(await champions()).toEqual(["Benas Kazlauskas"]);
    people.get("ben")!.lichessClosed = true;
    expect(await season()).toMatchObject({ over: true, champions: [], leaderboard: [] });
  });

  it("is on the home page from the sixth Matchday until the next Season's first is ingested", async () => {
    fiveMatchdays();
    expect(await newChampions(NOW)).toBeNull();
    ingested(SEASON_1[5], [["ben", 5]]);
    expect(await newChampions(NOW)).toEqual({ season: 1, champions: [{ memberId: "ana", name: "Ana Petraitė", company: null }] });
    // A Matchday in the week off belongs to no Season and changes nothing.
    ingested(WEEK_OFF, [["cid", 3]]);
    expect((await newChampions(NOW))?.season).toBe(1);
    // Season 2's first Matchday has been played but not ingested yet.
    matchdays.set(SEASON_2[0], { date: SEASON_2[0], lichessTournamentId: "NOTYET01", ingestedAt: null });
    expect((await newChampions(NOW))?.season).toBe(1);
    ingested(SEASON_2[0], [["cid", 3]]);
    expect(await newChampions(NOW)).toBeNull();
  });
});

describe("the current Season", () => {
  it("is the latest Season with an ingested Matchday, through the week off after it", async () => {
    ingested(SEASON_1[0], [["ana", 1]]);
    expect(await seasonsSoFar(NOW)).toEqual({ played: [1], current: 1 });
    for (const date of SEASON_1.slice(1)) ingested(date, [["ana", 1]]);
    ingested(WEEK_OFF, [["ana", 1]]);
    expect(await seasonsSoFar(NOW)).toEqual({ played: [1], current: 1 });
    ingested(SEASON_2[0], [["ana", 1]]);
    expect(await seasonsSoFar(NOW)).toEqual({ played: [1, 2], current: 2 });
  });

  it("is the Season of the next Matchday before any Matchday of a Season is ingested", async () => {
    ingested(BEFORE_SEASON_1, [["ana", 1]]);
    expect(await seasonsSoFar(new Date("2026-12-01T12:00:00Z"))).toEqual({ played: [], current: 1 });
  });

  it("is Season 1 while nothing is scheduled, which has a page of its own but no Matchdays yet", async () => {
    seasons.clear();
    const now = new Date("2026-11-25T12:00:00Z");
    expect(await seasonsSoFar(now)).toEqual({ played: [], current: 1 });
    expect(await getSeason(1, now)).toEqual({ number: 1, matchdays: null, leaderboard: [], over: false, champions: [] });
    expect(await getSeason(2, now)).toBeNull();
  });
});

describe("Season numbers", () => {
  it("are 1 to 200; anything else is no Season, found without reading the database", async () => {
    db.query.mockClear();
    for (const n of [0, -1, 1.5, 201, 1e9, Number.NaN]) expect(await getSeason(n, NOW)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("go as far as Season 200, reading the database the same few times as for Season 1", async () => {
    await getSeason(1, NOW);
    const forOne = db.query.mock.calls.length;
    db.query.mockClear();
    const last = await getSeason(200, NOW);
    expect(last?.matchdays).toHaveLength(6);
    expect(last!.matchdays![0].date > "2050").toBe(true);
    expect(db.query.mock.calls.length).toBe(forOne);
  });
});

describe("the all-time Leaderboard", () => {
  it("ranks Members by Matchdays played, level ones sharing a rank and listed by name", async () => {
    ingested(BEFORE_SEASON_1, [["dan", 0.5]]);
    ingested(SEASON_1[0], [["ana", 5], ["dan", 0], ["cid", 1]]);
    ingested(SEASON_1[1], [["dan", 1], ["ben", 4]]);
    ingested(WEEK_OFF, [["cid", 0], ["ana", 2]]);
    ingested(SEASON_2[0], [["dan", 1]]);
    // Points do not count here, only turning up.
    expect(await allTime()).toEqual([
      ["dan", 1, 4],
      ["ana", 2, 2],
      ["cid", 2, 2],
      ["ben", 4, 1],
    ]);
  });

  it("is empty before any Matchday is ingested", async () => {
    expect(await getAllTime()).toEqual([]);
  });
});
