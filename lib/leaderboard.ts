// The three Leaderboards (per Matchday, per Season, all-time), Streaks and head-to-head records.
// Pure functions over already-ingested Matchdays.

import type { Game, Score } from "./matchday";

export const SEASON_LENGTH = 6;
export const BEST_OF = 4;

// One played Matchday: who played and what they scored. Skipped Sundays never appear.
export type MatchdayResult = { memberId: string; points: number }[];

export type Row = { memberId: string; rank: number; score: number; played: number };

// Members who are level on both keys share a rank (1, 2, 2, 4).
function rank(rows: Omit<Row, "rank">[]): Row[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || b.played - a.played);
  return sorted.reduce<Row[]>((out, r, i) => {
    const prev = out[i - 1];
    const tied = prev && prev.score === r.score && prev.played === r.played;
    return [...out, { ...r, rank: tied ? prev.rank : i + 1 }];
  }, []);
}

function tally(matchdays: MatchdayResult[], excluded: Set<string>) {
  const points = new Map<string, number[]>();
  for (const md of matchdays)
    for (const { memberId, points: p } of md)
      if (!excluded.has(memberId)) points.set(memberId, [...(points.get(memberId) ?? []), p]);
  return points;
}

// `excluded` holds Members whose Lichess account is marked or closed; they are left out of all three Leaderboards.

// Per Matchday: Lichess's own final order (the ingested rank), renumbered without excluded Members. Whatever else each
// score carries, such as the Member's name, is kept.
export function matchdayLeaderboard<S extends Score>(scores: S[], excluded = new Set<string>()): S[] {
  return [...scores]
    .sort((a, b) => a.rank - b.rank)
    .filter((s) => !excluded.has(s.memberId))
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

// Season score: sum of a Member's best four Matchday scores. Ties: more Matchdays played.
export function seasonLeaderboard(matchdays: MatchdayResult[], excluded = new Set<string>()): Row[] {
  return rank([...tally(matchdays, excluded)].map(([memberId, ps]) => ({
    memberId,
    played: ps.length,
    score: [...ps].sort((a, b) => b - a).slice(0, BEST_OF).reduce((a, b) => a + b, 0),
  })));
}

// Named once the sixth Matchday is in. More than one Member if they finish level.
export function seasonChampions(matchdays: MatchdayResult[], excluded = new Set<string>()): string[] {
  if (matchdays.length < SEASON_LENGTH) return [];
  return seasonLeaderboard(matchdays, excluded).filter((r) => r.rank === 1).map((r) => r.memberId);
}

// All-time: ranked by Matchdays played, so showing up is what counts.
export function allTimeLeaderboard(matchdays: MatchdayResult[], excluded = new Set<string>()): Row[] {
  return rank([...tally(matchdays, excluded)].map(([memberId, ps]) => ({ memberId, played: ps.length, score: ps.length })));
}

// Consecutive Matchdays played up to the most recent one. `matchdays` is oldest first.
export function streak(matchdays: MatchdayResult[], memberId: string): number {
  let n = 0;
  for (let i = matchdays.length - 1; i >= 0 && matchdays[i].some((r) => r.memberId === memberId); i--) n++;
  return n;
}

// Record of `me` against `them` across all Games.
export function headToHead(games: Pick<Game, "white" | "black" | "winner">[], me: string, them: string) {
  const record = { wins: 0, draws: 0, losses: 0 };
  for (const g of games) {
    const mine = g.white === me && g.black === them ? "white" : g.black === me && g.white === them ? "black" : null;
    if (!mine) continue;
    if (g.winner === null) record.draws++;
    else if (g.winner === mine) record.wins++;
    else record.losses++;
  }
  return record;
}
