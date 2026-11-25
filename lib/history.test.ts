// A Profile's history: Matchdays played, the Streak, the Games from the Member's side and the viewer's head-to-head
// record. Faked: the database (lib/fake-db.ts), filled in as ingestion leaves it, and for the redo, Lichess
// (lib/fixtures/fake-lichess.ts). Everything else is the app's own code.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, db, games, matchdays, people, resetDb, results, skippedSundays } from "@/lib/fake-db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { GAMES_MOST, GAMES_SHOWN, getHistory } from "./history";
import { ingestTournament } from "./matchdays";

vi.mock("@/lib/db", () => import("@/lib/fake-db"));

// An ingested Matchday and the Members who played it; anyone not listed missed it.
function ingested(date: string, played: string[]) {
  matchdays.set(date, { date, lichessTournamentId: `MD${date.replaceAll("-", "").slice(2)}`, ingestedAt: new Date() });
  played.forEach((userId, i) =>
    results.set(`${date} ${userId}`, { matchdayDate: date, userId, rank: i + 1, points: 2, rating: 1500, companyDomain: null }),
  );
}

let clock = Date.parse("2026-11-01T18:00:00Z");
// A Game as ingestion stores it, each finishing a minute after the last one added. A null side is a player who left.
function game(id: string, date: string, whiteId: string | null, blackId: string | null, winner: "white" | "black" | null) {
  clock += 60_000;
  games.set(id, {
    lichessGameId: id,
    matchdayDate: date,
    whiteId,
    blackId,
    winner,
    status: winner ? "resign" : "draw",
    plies: 60,
    whiteRating: 1500,
    blackRating: 1500,
    winnerClockCentis: winner ? 1200 : null,
    finishedAt: new Date(clock),
  });
}

beforeEach(() => {
  resetDb();
  for (const id of ["ana", "ben", "cid", "dan"]) addPerson(id, { name: `Member ${id}` });
});

describe("Matchdays played and the Streak", () => {
  it("counts consecutive Matchdays played up to the latest one", async () => {
    ingested("2026-11-01", ["ana", "ben"]);
    ingested("2026-11-08", ["ana"]);
    ingested("2026-11-15", ["ana", "ben"]);
    ingested("2026-11-22", ["ana", "ben"]);
    expect(await getHistory("ana", "ana")).toMatchObject({ played: 4, streak: 4 });
    // ben missed the second Matchday: his Streak starts again after it.
    expect(await getHistory("ben", "ana")).toMatchObject({ played: 3, streak: 2 });
  });

  it("is not broken by a skipped Sunday, which has no Matchday", async () => {
    ingested("2026-11-08", ["ana"]);
    ingested("2026-11-15", ["ana"]);
    skippedSundays.set("2026-11-22", { date: "2026-11-22" });
    ingested("2026-11-29", ["ana"]);
    expect(await getHistory("ana", "ana")).toMatchObject({ played: 3, streak: 3 });
  });

  it("is broken by a missed Matchday, and is zero after missing the latest one", async () => {
    ingested("2026-11-08", ["ana", "ben"]);
    ingested("2026-11-15", ["ben"]);
    ingested("2026-11-22", ["ana", "ben"]);
    expect(await getHistory("ana", "ben")).toMatchObject({ played: 2, streak: 1 });
    ingested("2026-11-29", ["ben"]);
    expect(await getHistory("ana", "ben")).toMatchObject({ played: 2, streak: 0 });
  });

  it("is not broken by the next Matchday, set up on Lichess but not yet played", async () => {
    ingested("2026-11-22", ["ana"]);
    ingested("2026-11-29", ["ana"]);
    matchdays.set("2026-12-06", { date: "2026-12-06", lichessTournamentId: "NEXTWEEK", ingestedAt: null });
    expect(await getHistory("ana", "ana")).toMatchObject({ played: 2, streak: 2 });
  });

  it("counts a Member who joined late from their first Matchday", async () => {
    ingested("2026-11-01", ["ana"]);
    ingested("2026-11-08", ["ana"]);
    ingested("2026-11-15", ["ana", "cid"]);
    ingested("2026-11-22", ["ana", "cid"]);
    expect(await getHistory("cid", "ana")).toMatchObject({ played: 2, streak: 2 });
  });

  it("is zero, with nothing played, for a Member who has not played yet", async () => {
    expect(await getHistory("dan", "ana")).toEqual({ played: 0, streak: 0, games: [], total: 0, headToHead: null });
    ingested("2026-11-22", ["ana"]);
    expect(await getHistory("dan", "ana")).toMatchObject({ played: 0, streak: 0 });
  });

  it("counts the same for a Member whose Lichess account is marked or closed as for anyone else", async () => {
    ingested("2026-11-15", ["ana", "ben"]);
    ingested("2026-11-22", ["ana", "ben"]);
    people.get("ana")!.lichessMarked = true;
    people.get("ben")!.lichessClosed = true;
    expect(await getHistory("ana", "cid")).toMatchObject({ played: 2, streak: 2 });
    expect(await getHistory("ben", "cid")).toMatchObject({ played: 2, streak: 2 });
  });

  describe("after a Matchday is redone", () => {
    // The recorded tournament of lib/fixtures, ingested for real through lib/matchdays.ts with Lichess faked. Of its
    // Members, gevorgsargsyan played two Games and calvinlidasan none, joining late for half a point.
    const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    const lichess = createFakeLichess({
      teamId: "offboard-team",
      teamPassword: "pw",
      accounts: [
        { id: "gevorgsargsyan", username: "GEVorgSaRgSyAn" },
        { id: "calvinlidasan", username: "Calvinlidasan" },
      ],
      tournaments: [
        {
          id: "PF2C2AUC",
          teamId: "offboard-team",
          status: "finished",
          startsAt: "2026-11-22T18:00:00Z",
          results: fixture("results.ndjson"),
          games: fixture("games.ndjson"),
        },
      ],
    });

    beforeEach(() => {
      vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
      vi.stubEnv("LICHESS_TEAM_ID", "offboard-team");
      vi.stubGlobal("fetch", lichess.fetch);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it("counts the Matchday once for those already in it, and takes in a Member who was missed", async () => {
      addPerson("eva", { lichessId: "gevorgsargsyan" });
      // fay played on 22 November on another Lichess account, and swapped to it only afterwards, so the first ingestion
      // missed her.
      addPerson("fay", { lichessId: "fays-old-account" });
      ingested("2026-11-08", ["eva", "fay"]);
      ingested("2026-11-15", ["eva", "fay"]);
      expect(await ingestTournament("PF2C2AUC")).toMatchObject({ outcome: "ingested", date: "2026-11-22" });
      expect(await getHistory("eva", "eva")).toMatchObject({ played: 3, streak: 3 });
      people.get("fay")!.lichessId = "calvinlidasan";
      expect(await getHistory("fay", "eva")).toMatchObject({ played: 2, streak: 0 });

      expect(await ingestTournament("PF2C2AUC", { redo: true })).toMatchObject({ outcome: "ingested", redone: true });
      expect(await getHistory("eva", "eva")).toMatchObject({ played: 3, streak: 3 });
      expect(await getHistory("fay", "eva")).toMatchObject({ played: 3, streak: 3 });
    });
  });
});

describe("the Games", () => {
  beforeEach(() => {
    ingested("2026-11-15", ["ana", "ben", "cid"]);
    ingested("2026-11-22", ["ana", "ben", "cid"]);
    game("g1", "2026-11-15", "ana", "ben", "white"); // ana wins as White
    game("g2", "2026-11-15", "cid", "ana", "white"); // ana loses as Black
    game("g3", "2026-11-22", "ben", "ana", null); // a draw, ana as Black
    game("g4", "2026-11-22", "ana", "cid", null); // a draw, ana as White
    game("g5", "2026-11-22", "ben", "ana", "black"); // ana wins as Black
    game("g6", "2026-11-22", "ben", "cid", "white"); // not ana's
  });

  it("lists the Member's Games newest first, from their side, as White and as Black", async () => {
    const { games: listed, total } = await getHistory("ana", "ana");
    expect(total).toBe(5);
    expect(listed.map((g) => [g.lichessGameId, g.date, g.colour, g.result, g.opponent?.id])).toEqual([
      ["g5", "2026-11-22", "black", "won", "ben"],
      ["g4", "2026-11-22", "white", "drew", "cid"],
      ["g3", "2026-11-22", "black", "drew", "ben"],
      ["g2", "2026-11-15", "black", "lost", "cid"],
      ["g1", "2026-11-15", "white", "won", "ben"],
    ]);
    expect(listed[0].opponent).toEqual({ id: "ben", name: "Member ben" });
  });

  it("shows the same Game from the other side on the opponent's Profile", async () => {
    const ben = (await getHistory("ben", "ana")).games;
    expect(ben.find((g) => g.lichessGameId === "g1")).toMatchObject({ colour: "black", result: "lost", opponent: { id: "ana" } });
    expect(ben.find((g) => g.lichessGameId === "g5")).toMatchObject({ colour: "white", result: "lost", opponent: { id: "ana" } });
    expect(ben.find((g) => g.lichessGameId === "g3")).toMatchObject({ colour: "white", result: "drew", opponent: { id: "ana" } });
  });

  it("keeps a Game against someone who has left, with no opponent", async () => {
    // As Postgres leaves it when cid's account is deleted: his side of each Game is emptied and his results are gone.
    people.delete("cid");
    for (const key of [...results.keys()]) if (key.endsWith(" cid")) results.delete(key);
    for (const g of games.values()) {
      if (g.whiteId === "cid") g.whiteId = null;
      if (g.blackId === "cid") g.blackId = null;
    }
    const listed = (await getHistory("ana", "ana")).games;
    expect(listed.find((g) => g.lichessGameId === "g2")).toEqual({ lichessGameId: "g2", date: "2026-11-15", colour: "black", result: "lost", opponent: null });
    expect(listed.find((g) => g.lichessGameId === "g4")).toMatchObject({ colour: "white", result: "drew", opponent: null });
    expect(listed).toHaveLength(5);
  });

  it("names no opponent who no longer counts as a Member", async () => {
    people.get("cid")!.lichessId = null;
    const listed = (await getHistory("ana", "ana")).games;
    expect(listed.filter((g) => g.opponent === null).map((g) => g.lichessGameId)).toEqual(["g4", "g2"]);
  });

  it("names an opponent whose Lichess account is marked or closed like any other Member", async () => {
    people.get("ben")!.lichessMarked = true;
    people.get("cid")!.lichessClosed = true;
    const listed = (await getHistory("ana", "dan")).games;
    expect(listed.map((g) => g.opponent?.id)).toEqual(["ben", "cid", "ben", "cid", "ben"]);
  });

  it(`lists the latest ${GAMES_SHOWN}, or up to ${GAMES_MOST} when asked for all, and counts them all`, async () => {
    resetDb();
    addPerson("ana");
    addPerson("ben");
    ingested("2026-11-22", ["ana", "ben"]);
    for (let n = 1; n <= GAMES_MOST + 1; n++) game(`n${String(n).padStart(3, "0")}`, "2026-11-22", "ana", "ben", "white");
    const latest = await getHistory("ana", "ben");
    expect(latest.total).toBe(GAMES_MOST + 1);
    expect(latest.games).toHaveLength(GAMES_SHOWN);
    expect(latest.games[0].lichessGameId).toBe(`n${GAMES_MOST + 1}`);
    const all = await getHistory("ana", "ben", { all: true });
    expect(all.total).toBe(GAMES_MOST + 1);
    expect(all.games).toHaveLength(GAMES_MOST);
    expect(all.games.at(-1)?.lichessGameId).toBe("n002");
    // The database is asked for no more than it lists.
    const limits = db.query.mock.calls.filter(([sql]) => /\blimit \$2$/.test(sql)).map(([, params]) => (params as unknown[])[1]);
    expect(limits).toEqual([GAMES_SHOWN, GAMES_MOST]);
  });
});

describe("the head-to-head record", () => {
  beforeEach(() => {
    ingested("2026-11-15", ["ana", "ben", "cid"]);
    game("h1", "2026-11-15", "ana", "ben", "white"); // ana wins as White
    game("h2", "2026-11-15", "ben", "ana", "black"); // ana wins as Black
    game("h3", "2026-11-15", "ben", "ana", "white"); // ben wins as White
    game("h4", "2026-11-15", "ana", "ben", null); // a draw
    game("h5", "2026-11-15", "ana", "cid", "black"); // against someone else
  });

  it("counts the viewer's wins, draws and losses against the Member, either way round", async () => {
    expect((await getHistory("ben", "ana")).headToHead).toEqual({ wins: 2, draws: 1, losses: 1 });
    expect((await getHistory("ana", "ben")).headToHead).toEqual({ wins: 1, draws: 1, losses: 2 });
    expect((await getHistory("cid", "ana")).headToHead).toEqual({ wins: 0, draws: 0, losses: 1 });
  });

  it("is absent between two Members who have never played each other", async () => {
    expect((await getHistory("dan", "ana")).headToHead).toBeNull();
    expect((await getHistory("cid", "ben")).headToHead).toBeNull();
  });

  it("is absent on the viewer's own Profile, and not looked up", async () => {
    expect((await getHistory("ana", "ana")).headToHead).toBeNull();
    expect(db.query.mock.calls.some(([sql]) => sql.includes(`("whiteId" = $2 and "blackId" = $1)`))).toBe(false);
  });
});
