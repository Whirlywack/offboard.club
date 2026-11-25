// A Member's record in the Club, as their Profile shows it (#14): how many Matchdays they have played, their Streak,
// their Games newest first, and the viewing Member's head-to-head record against them. Profiles are for Members only,
// so this is read only once requireSignedUp has let the viewer through and getProfile has found the Member.
//
// Nothing here depends on whether anyone's Lichess account is marked or closed. Such a Member's Profile, and their
// Games in other Members' histories, look like anyone else's, so the Profile says nothing about it beyond what their
// absence from the Leaderboards already does.

import { db } from "./db";
import { headToHead, streak, type MatchdayResult } from "./leaderboard";
import type { Colour, Game } from "./matchday";
import { MEMBER_SQL } from "./members";

// The Games a Profile lists: the latest GAMES_SHOWN, or on asking for them all, the latest GAMES_MOST, which is about
// sixty Matchdays of five Games, so that no Profile makes an unbounded page.
export const GAMES_SHOWN = 30;
export const GAMES_MOST = 300;

export type Result = "won" | "drew" | "lost";

// One of the Member's Games from their side of the board. The opponent is null once they are no longer a Member: their
// account was deleted (#15), which empties their side of the Game, or they no longer count as one.
export type HistoryGame = {
  lichessGameId: string;
  date: string; // the Matchday's, as "YYYY-MM-DD"
  colour: Colour;
  result: Result;
  opponent: { id: string; name: string } | null;
};

export type HeadToHead = { wins: number; draws: number; losses: number };

export type History = {
  played: number; // Matchdays played
  streak: number;
  games: HistoryGame[]; // newest first
  total: number; // all the Member's Games, listed or not
  headToHead: HeadToHead | null; // the viewer's against the Member; null on their own Profile or if they never played
};

export const resultFor = (winner: Colour | null, colour: Colour): Result =>
  winner === null ? "drew" : winner === colour ? "won" : "lost";

// `all` lists up to GAMES_MOST Games instead of GAMES_SHOWN.
export async function getHistory(memberId: string, viewerId: string, { all = false } = {}): Promise<History> {
  const [matchdays, listed, between] = await Promise.all([
    matchdaysOf(memberId),
    gamesOf(memberId, all ? GAMES_MOST : GAMES_SHOWN),
    viewerId === memberId ? null : gamesBetween(viewerId, memberId),
  ]);
  const record = between && headToHead(between, viewerId, memberId);
  return {
    played: matchdays.filter((md) => md.length > 0).length,
    streak: streak(matchdays, memberId),
    ...listed,
    headToHead: record && record.wins + record.draws + record.losses > 0 ? record : null,
  };
}

// Every ingested Matchday, oldest first, holding the Member's result if they played it and nothing if not. Skipped
// Sundays have no Matchday, so they are not in the list and cannot break a Streak; neither can a Matchday whose
// tournament is set up but not yet played and ingested.
async function matchdaysOf(memberId: string): Promise<MatchdayResult[]> {
  const { rows } = await db.query<{ points: number | null }>(
    `select r."points"
     from "matchday" m left join "matchdayResult" r on r."matchdayDate" = m."date" and r."userId" = $1
     where m."ingestedAt" is not null
     order by m."date"`,
    [memberId],
  );
  return rows.map(({ points }) => (points === null ? [] : [{ memberId, points }]));
}

async function gamesOf(memberId: string, limit: number) {
  type Row = {
    lichessGameId: string;
    date: string;
    whiteId: string | null;
    blackId: string | null;
    winner: Colour | null;
    opponentId: string | null;
    opponentName: string | null;
    total: number;
  };
  // MEMBER_SQL names columns of "user" alone, joined here once, as the opponent; "game" has none of those names. Ordered
  // by Matchday first, as the page groups them, so each Matchday's Games stay together whenever they finished.
  const { rows } = await db.query<Row>(
    `select g."lichessGameId", to_char(g."matchdayDate", 'YYYY-MM-DD') as "date", g."whiteId", g."blackId", g."winner",
       o.id as "opponentId", o.name as "opponentName", (count(*) over ())::int as "total"
     from "game" g
       left join "user" o on o.id = case when g."whiteId" = $1 then g."blackId" else g."whiteId" end and ${MEMBER_SQL}
     where g."whiteId" = $1 or g."blackId" = $1
     order by g."matchdayDate" desc, g."finishedAt" desc, g."lichessGameId" desc
     limit $2`,
    [memberId, limit],
  );
  const games = rows.map((row): HistoryGame => {
    const colour: Colour = row.whiteId === memberId ? "white" : "black";
    return {
      lichessGameId: row.lichessGameId,
      date: row.date,
      colour,
      result: resultFor(row.winner, colour),
      opponent: row.opponentId && row.opponentName !== null ? { id: row.opponentId, name: row.opponentName } : null,
    };
  });
  return { games, total: rows[0]?.total ?? 0 };
}

// Every Game the two have played against each other, either way round: who had which colour and who won, which is all
// a head-to-head record counts.
async function gamesBetween(one: string, other: string): Promise<Pick<Game, "white" | "black" | "winner">[]> {
  const { rows } = await db.query<{ whiteId: string; blackId: string; winner: Colour | null }>(
    `select "whiteId", "blackId", "winner"
     from "game"
     where ("whiteId" = $1 and "blackId" = $2) or ("whiteId" = $2 and "blackId" = $1)`,
    [one, other],
  );
  return rows.map((g) => ({ white: g.whiteId, black: g.blackId, winner: g.winner }));
}
