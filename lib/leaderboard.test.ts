import { describe, expect, it } from "vitest";
import {
  allTimeLeaderboard,
  headToHead,
  matchdayLeaderboard,
  rankByPlayed,
  seasonChampions,
  seasonLeaderboard,
  streak,
  type MatchdayResult,
} from "./leaderboard";
import type { Game } from "./matchday";

// Matchdays as lists of [Member, points]; a Member missing from a Matchday did not play it.
const md = (...rows: [string, number][]): MatchdayResult => rows.map(([memberId, points]) => ({ memberId, points }));
type Board = { memberId: string; rank: number; score: number; played: number }[];
const rows = (board: Board) => board.map((r) => [r.memberId, r.rank, r.score, r.played]);
// Rank by Member, for boards where the order among level Members does not matter.
const ranks = (board: Board) => Object.fromEntries(board.map((r) => [r.memberId, r.rank]));

describe("seasonLeaderboard", () => {
  it("scores a Member on their best four of six Matchdays", () => {
    const season = [md(["ana", 5]), md(["ana", 1]), md(["ana", 4]), md(["ana", 3]), md(["ana", 2]), md(["ana", 4.5])];
    // 5 + 4.5 + 4 + 3; the 2 and the 1 are dropped.
    expect(rows(seasonLeaderboard(season))).toEqual([["ana", 1, 16.5, 6]]);
  });

  it("shows a mid-Season joiner from their first Matchday", () => {
    const season = [md(["ana", 3]), md(["ana", 3]), md(["ana", 3]), md(["ana", 3], ["ben", 5])];
    expect(rows(seasonLeaderboard(season))).toEqual([
      ["ana", 1, 12, 4],
      ["ben", 2, 5, 1],
    ]);
  });

  it("breaks a tie on Season score by more Matchdays played", () => {
    const season = [
      md(["ana", 4], ["ben", 2]),
      md(["ana", 4], ["ben", 4]),
      md(["ana", 4], ["ben", 4]),
      md(["ana", 4], ["ben", 4]),
      md(["ben", 4]),
    ];
    // Both score 16; Ben played five Matchdays, Ana four.
    expect(rows(seasonLeaderboard(season))).toEqual([
      ["ben", 1, 16, 5],
      ["ana", 2, 16, 4],
    ]);
  });

  it("gives Members still level on score and Matchdays played the same rank", () => {
    const season = [md(["ana", 3], ["ben", 2], ["cid", 3], ["dan", 1]), md(["ana", 3], ["ben", 3], ["cid", 2], ["dan", 1])];
    // Ana 6, Ben 5, Cid 5, Dan 2, all with two Matchdays played.
    expect(ranks(seasonLeaderboard(season))).toEqual({ ana: 1, ben: 2, cid: 2, dan: 4 });
  });

  it("leaves out a Member whose Lichess account is marked", () => {
    const season = [md(["cheat", 5], ["ana", 3], ["ben", 2])];
    expect(rows(seasonLeaderboard(season, new Set(["cheat"])))).toEqual([
      ["ana", 1, 3, 1],
      ["ben", 2, 2, 1],
    ]);
  });
});

describe("seasonChampions", () => {
  const five = [md(["ana", 4], ["ben", 3]), md(["ana", 4]), md(["ana", 4]), md(["ana", 4]), md(["ana", 4])];

  it("names nobody when nobody is on the Leaderboard", () => {
    expect(seasonChampions([md(), md()])).toEqual([]);
    expect(seasonChampions(five, new Set(["ana", "ben"]))).toEqual([]);
  });

  it("names the top Member of the Matchdays played, however many there were", () => {
    expect(seasonChampions([...five, md(["ben", 5])])).toEqual(["ana"]);
    expect(seasonChampions(five)).toEqual(["ana"]);
  });

  it("names every Member still level at the top", () => {
    const season = [md(["ana", 4], ["ben", 4]), md(["ana", 4], ["ben", 4]), md(["ana", 4], ["ben", 4]), md(["ana", 4], ["ben", 4]), md(["cid", 1]), md(["cid", 1])];
    expect(seasonChampions(season).sort()).toEqual(["ana", "ben"]);
  });

  it("passes over a marked Member", () => {
    expect(seasonChampions([...five, md(["ben", 5])], new Set(["ana"]))).toEqual(["ben"]);
  });
});

describe("allTimeLeaderboard", () => {
  it("ranks Members by Matchdays played, whatever they scored", () => {
    const history = [md(["ana", 0], ["ben", 5]), md(["ana", 0.5], ["cid", 5]), md(["ana", 0], ["ben", 5], ["dan", 5]), md(["cid", 5])];
    const board = allTimeLeaderboard(history);
    expect(board.map((r) => r.memberId)[0]).toBe("ana");
    expect(Object.fromEntries(board.map((r) => [r.memberId, [r.rank, r.played]]))).toEqual({
      ana: [1, 3],
      ben: [2, 2],
      cid: [2, 2],
      dan: [4, 1],
    });
  });

  it("leaves out a marked Member", () => {
    const history = [md(["ana", 1], ["cheat", 1]), md(["cheat", 1])];
    expect(allTimeLeaderboard(history, new Set(["cheat"])).map((r) => r.memberId)).toEqual(["ana"]);
  });
});

describe("rankByPlayed", () => {
  it("ranks counts of Matchdays played as allTimeLeaderboard ranks the Matchdays themselves", () => {
    const history = [md(["ana", 0], ["ben", 5]), md(["ana", 0.5], ["cid", 5]), md(["ana", 0], ["ben", 5], ["dan", 5]), md(["cid", 5], ["cheat", 5])];
    const counts = [
      { memberId: "ana", played: 3 },
      { memberId: "ben", played: 2 },
      { memberId: "cid", played: 2 },
      { memberId: "dan", played: 1 },
      { memberId: "cheat", played: 1 },
    ];
    expect(rankByPlayed(counts, new Set(["cheat"]))).toEqual(allTimeLeaderboard(history, new Set(["cheat"])));
  });
});

describe("matchdayLeaderboard", () => {
  const scores = [
    { memberId: "cheat", rank: 1, points: 5, rating: 2400 },
    { memberId: "ana", rank: 2, points: 4, rating: 1500 },
    { memberId: "ben", rank: 3, points: 4, rating: 1600 },
  ];

  it("keeps Lichess's order", () => {
    expect(matchdayLeaderboard(scores).map((s) => [s.memberId, s.rank])).toEqual([
      ["cheat", 1],
      ["ana", 2],
      ["ben", 3],
    ]);
  });

  it("leaves out a marked Member and closes the gap", () => {
    expect(matchdayLeaderboard(scores, new Set(["cheat"])).map((s) => [s.memberId, s.rank])).toEqual([
      ["ana", 1],
      ["ben", 2],
    ]);
  });
});

describe("streak", () => {
  // Skipped Sundays are not Matchdays, so they never appear in the list.
  const history = [md(["ana", 1], ["ben", 1]), md(["ana", 1]), md(["ana", 1], ["ben", 1]), md(["ana", 1], ["ben", 1])];

  it("counts consecutive Matchdays played up to the latest one", () => {
    expect(streak(history, "ana")).toBe(4);
  });

  it("is not broken by a skipped Sunday", () => {
    // The Sunday between the second and third Matchday was skipped: nothing to miss.
    const withSkippedSunday = [md(["ana", 1]), md(["ana", 1]), /* skipped */ md(["ana", 1])];
    expect(streak(withSkippedSunday, "ana")).toBe(3);
  });

  it("is broken by a missed Matchday", () => {
    expect(streak(history, "ben")).toBe(2);
  });

  it("is zero for a Member who missed the latest Matchday or never played", () => {
    expect(streak([...history, md(["ben", 1])], "ana")).toBe(0);
    expect(streak(history, "nobody")).toBe(0);
    expect(streak([], "ana")).toBe(0);
  });
});

describe("headToHead", () => {
  const game = (white: string, black: string, winner: Game["winner"]): Game => ({
    lichessGameId: `${white}-${black}-${winner}`,
    white,
    black,
    winner,
    status: winner ? "resign" : "draw",
    plies: 40,
    ratings: { white: 1500, black: 1500 },
    winnerClockCentis: null,
    finishedAt: 0,
  });

  const games = [
    game("ana", "ben", "white"), // Ana wins as White
    game("ben", "ana", "black"), // Ana wins as Black
    game("ben", "ana", "white"), // Ben wins
    game("ana", "ben", null), // draw
    game("ana", "cid", "white"), // against someone else
    game("cid", "ben", "black"),
  ];

  it("counts wins, draws and losses from the viewer's side", () => {
    expect(headToHead(games, "ana", "ben")).toEqual({ wins: 2, draws: 1, losses: 1 });
    expect(headToHead(games, "ben", "ana")).toEqual({ wins: 1, draws: 1, losses: 2 });
  });

  it("is empty for two Members who never played each other", () => {
    expect(headToHead(games, "ana", "dan")).toEqual({ wins: 0, draws: 0, losses: 0 });
  });
});
