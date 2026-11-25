import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { awards, ingestMatchday, type Game, type MemberRef } from "./matchday";

// A finished Lichess Swiss export, 12 rounds, 65 participants and 120 Games, recorded from a public tournament on
// Lichess with its people invented: each username is a made-up "Pretend--" name, which Lichess refuses to register (two
// hyphens in a row), and each Game id has ten characters where Lichess's have eight. The tournament id keeps Lichess's
// eight-character shape, which ingestion checks. Ratings, scores, clocks, moves and results are the tournament's own.
const resultsNdjson = readFileSync(new URL("./fixtures/results.ndjson", import.meta.url), "utf8");
const gamesNdjson = readFileSync(new URL("./fixtures/games.ndjson", import.meta.url), "utf8");

const member = (lichessName: string): MemberRef => ({ memberId: `m:${lichessName}`, lichessId: lichessName });
const everyone: MemberRef[] = resultsNdjson
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => member(JSON.parse(line).username));

// The expected values below were worked out from the ndjson by a separate script, not from lib code.
describe("ingestMatchday: scores", () => {
  it("scores every Member in Lichess's final order", () => {
    const { scores } = ingestMatchday(resultsNdjson, gamesNdjson, everyone);
    expect(scores).toHaveLength(65);
    expect(scores.slice(0, 3)).toEqual([
      { memberId: "m:Pretend--Ada", rank: 1, points: 9.5, rating: 1917 },
      { memberId: "m:pretend--bruno", rank: 2, points: 8, rating: 1803 },
      { memberId: "m:Pretend--Cleo", rank: 3, points: 8, rating: 1843 },
    ]);
    expect(scores.map((s) => s.rank)).toEqual(Array.from({ length: 65 }, (_, i) => i + 1));
  });

  it("carries bye and late-join points through from the Lichess results", () => {
    const { scores } = ingestMatchday(resultsNdjson, gamesNdjson, everyone);
    const points = (name: string) => scores.find((s) => s.memberId === `m:${name}`)?.points;
    // 9 points from Games plus a half-point late-join bye.
    expect(points("Pretend--Ada")).toBe(9.5);
    // 1 point from Games plus a one-point bye.
    expect(points("Pretend--Wim")).toBe(2);
    // No Games at all: only the late-join half point. Still counts as having played.
    expect(points("Pretend--Petra")).toBe(0.5);
  });

  it("matches Lichess names to Members whatever their letter case", () => {
    const members = [
      { memberId: "a", lichessId: "pretend--ada" },
      { memberId: "b", lichessId: "PRETEND--BRUNO" },
    ];
    const { scores, games } = ingestMatchday(resultsNdjson, gamesNdjson, members);
    expect(scores.map((s) => s.memberId)).toEqual(["a", "b"]);
    expect(games.map((g) => g.lichessGameId)).toEqual(["pretend100"]);
  });
});

describe("ingestMatchday: participants who are not Members", () => {
  const members = ["Pretend--Ada", "pretend--bruno", "Pretend--Ines", "Pretend--Boris"].map(member);
  const { scores, games, awards } = ingestMatchday(resultsNdjson, gamesNdjson, members);

  it("leaves them out of the scores and renumbers the Members in Lichess order", () => {
    // Lichess ranks 1, 2, 9 and 28.
    expect(scores.map((s) => [s.memberId, s.rank])).toEqual([
      ["m:Pretend--Ada", 1],
      ["m:pretend--bruno", 2],
      ["m:Pretend--Ines", 3],
      ["m:Pretend--Boris", 4],
    ]);
  });

  it("keeps only Games between two Members", () => {
    expect(games.map((g) => g.lichessGameId).sort()).toEqual(["pretend066", "pretend100", "pretend119"]);
  });

  it("computes Awards from those Games only", () => {
    expect(awards).toEqual([
      // Pretend--Ines (1579) beat Pretend--Boris (1694) on time.
      { kind: "biggestUpset", memberId: "m:Pretend--Ines", lichessGameId: "pretend066", value: 115 },
      { kind: "leastTimeLeft", memberId: "m:Pretend--Ines", lichessGameId: "pretend066", value: 278 },
      // 79 half-moves: mate on White's 40th move.
      { kind: "fastestCheckmate", memberId: "m:pretend--bruno", lichessGameId: "pretend119", value: 40 },
    ]);
  });
});

describe("ingestMatchday: Awards from the recorded Games", () => {
  const { awards: given } = ingestMatchday(resultsNdjson, gamesNdjson, everyone);
  const award = (kind: string) => given.find((a) => a.kind === kind);

  it("gives the biggest upset to the win furthest below the loser's rating", () => {
    // pretend--sven (1043) beat Pretend--Carla (1605), who made one move and then lost on time.
    expect(award("biggestUpset")).toEqual({ kind: "biggestUpset", memberId: "m:pretend--sven", lichessGameId: "pretend088", value: 562 });
  });

  it("does not count a win against an opponent who never moved", () => {
    // Pretend--Wim (761) "beat" Pretend--Milo (1808), who never moved: a 1047 gap that must not win.
    expect(given.map((a) => a.lichessGameId)).not.toContain("pretend019");
    const { awards: pair } = ingestMatchday(resultsNdjson, gamesNdjson, [member("Pretend--Wim"), member("Pretend--Milo")]);
    expect(pair).toEqual([]);
  });

  it("gives least time left to the winner with the least on their own clock at the end", () => {
    // Pretend--Ines won on time with 2.78 seconds left.
    expect(award("leastTimeLeft")).toEqual({ kind: "leastTimeLeft", memberId: "m:Pretend--Ines", lichessGameId: "pretend066", value: 278 });
  });

  it("gives the fastest checkmate to the mate in fewest moves, the first to finish on a tie", () => {
    // pretend001 and pretend007 both end in mate on White's 18th move, in the same round;
    // pretend007 finished first. (pretend057 is mate on Black's 18th move, half a move later.)
    expect(award("fastestCheckmate")).toEqual({ kind: "fastestCheckmate", memberId: "m:Pretend--Yara", lichessGameId: "pretend007", value: 18 });
  });

  it("omits every Award when no Game qualifies", () => {
    // Pretend--Olaf and Pretend--Otto played each other once, a draw.
    const { games, awards: none } = ingestMatchday(resultsNdjson, gamesNdjson, [member("Pretend--Olaf"), member("Pretend--Otto")]);
    expect(games.map((g) => g.lichessGameId)).toEqual(["pretend014"]);
    expect(none).toEqual([]);
  });
});

describe("awards", () => {
  const game = (over: Partial<Game>): Game => ({
    lichessGameId: "g",
    white: "w",
    black: "b",
    winner: "white",
    status: "resign",
    plies: 40,
    ratings: { white: 1500, black: 1500 },
    winnerClockCentis: 6000,
    finishedAt: 0,
    ...over,
  });

  it("omits the biggest upset when no winner was rated below the loser", () => {
    const games = [
      game({ lichessGameId: "level", ratings: { white: 1500, black: 1500 } }),
      game({ lichessGameId: "favourite", ratings: { white: 1800, black: 1400 } }),
    ];
    expect(awards(games).map((a) => a.kind)).toEqual(["leastTimeLeft"]);
  });

  it("omits the fastest checkmate when no Game ends in mate", () => {
    expect(awards([game({ status: "outoftime" })]).map((a) => a.kind)).not.toContain("fastestCheckmate");
  });

  it("gives nothing for draws or for wins against an opponent who never moved", () => {
    const games = [
      game({ lichessGameId: "draw", winner: null, status: "draw", winnerClockCentis: null }),
      // Black never moved: White made the only half-move.
      game({ lichessGameId: "blackAbsent", winner: "white", status: "noStart", plies: 1, ratings: { white: 900, black: 2000 } }),
      // White never moved.
      game({ lichessGameId: "whiteAbsent", winner: "black", status: "outoftime", plies: 0, ratings: { white: 2000, black: 900 }, winnerClockCentis: null }),
    ];
    expect(awards(games)).toEqual([]);
  });

  it("counts a win when the opponent moved once and then resigned", () => {
    const games = [game({ lichessGameId: "oneMove", winner: "black", plies: 1, ratings: { white: 1600, black: 1500 } })];
    expect(awards(games).map((a) => a.kind)).toEqual(["biggestUpset", "leastTimeLeft"]);
  });

  it("names the winner and measures the gap from their side", () => {
    const games = [game({ white: "anna", black: "ben", winner: "black", ratings: { white: 1700, black: 1450 } })];
    expect(awards(games)[0]).toMatchObject({ kind: "biggestUpset", memberId: "ben", value: 250 });
  });

  it("breaks a tie in favour of the Game that finished first, whatever the input order", () => {
    const later = game({ lichessGameId: "later", finishedAt: 2000, ratings: { white: 1400, black: 1600 }, winnerClockCentis: 500 });
    const earlier = game({ lichessGameId: "earlier", finishedAt: 1000, ratings: { white: 1400, black: 1600 }, winnerClockCentis: 500 });
    for (const games of [[later, earlier], [earlier, later]]) {
      expect(awards(games).map((a) => [a.kind, a.lichessGameId])).toEqual([
        ["biggestUpset", "earlier"],
        ["leastTimeLeft", "earlier"],
      ]);
    }
  });

  it("ranks checkmates by half-moves, so White's mate on move 18 beats Black's", () => {
    const games = [
      game({ lichessGameId: "blackMates", winner: "black", status: "mate", plies: 36, finishedAt: 1 }),
      game({ lichessGameId: "whiteMates", winner: "white", status: "mate", plies: 35, finishedAt: 2 }),
    ];
    expect(awards(games).find((a) => a.kind === "fastestCheckmate")).toMatchObject({ lichessGameId: "whiteMates", value: 18 });
  });
});
