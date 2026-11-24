// The Season and all-time Leaderboards as their pages show them, read from ingested Matchdays: lib/leaderboard.ts
// ranks, and this file reads the results and puts names and Companies to them. Leaderboards are public, so nothing else
// about a Member is read: no email, photo, LinkedIn, Lichess name or rating. A Member whose Lichess account is marked
// or closed is left out while it lasts, and anyone who is not a Member is not read at all.
//
// Which Season a Matchday belongs to is not stored. It is the Season whose six Matchdays, as the schedule
// (lib/seasons.ts) has them, include its date, and the schedule never moves a Matchday that has started, so a Matchday
// keeps its Season. Ingestion (#7) takes a Matchday on any Sunday that is not skipped, so one can fall on a Sunday that
// is none of a Season's six, before Season 1 or in the week off between two Seasons: it belongs to no Season, and
// counts in its Recap and on the all-time Leaderboard only.
//
// The Season champion is not stored either. It is whoever is first on the Season Leaderboard once the Season's sixth
// Matchday has been ingested, worked out on every read like the Leaderboard itself, so the two always agree. The
// consequence: if a champion later leaves the Club or has their Lichess account marked or closed, or the Organiser
// redoes one of the Season's Matchdays, the title moves with the Leaderboard.

import type { Company } from "./companies";
import { db } from "./db";
import { allTimeLeaderboard, seasonChampions, seasonLeaderboard, type MatchdayResult, type Row } from "./leaderboard";
import { MEMBER_SQL } from "./members";
import { recapDates } from "./recaps";
import { isRecapDate } from "./schedule";
import { matchdaysOfSeason, seasonsOf, upcomingMatchday, type Place } from "./seasons";

export type Member = { memberId: string; name: string; company: Pick<Company, "domain" | "name"> | null };
export type AllTimeRow = Member & { rank: number; played: number };
export type SeasonRow = AllTimeRow & { score: number };

export type Season = {
  number: number;
  // Its six Matchdays in order, each with whether it has been ingested, which is when it has a Recap. Null while
  // Season 1 is not scheduled yet.
  matchdays: { date: string; ingested: boolean }[] | null;
  leaderboard: SeasonRow[];
  // Whether its sixth Matchday has been ingested, which ends it.
  over: boolean;
  // Named once it is over: more than one Member if they finish level, and nobody if nobody is left on the Leaderboard.
  champions: Member[];
};

type Result = { date: string; memberId: string; name: string; companyDomain: string | null; companyName: string | null; excluded: boolean };

// Members level on rank are listed by name, so the order never depends on how the rows came back.
const byName = new Intl.Collator("en");

// Groups results, oldest Matchday first, into what lib/leaderboard.ts ranks: each Matchday's results, each Member as
// their last row has them, and the Members to leave out.
function tally<R extends Result & { points?: number }>(rows: R[]) {
  const matchdays = new Map<string, MatchdayResult>();
  const members = new Map<string, Member>();
  const excluded = new Set<string>();
  for (const { date, memberId, name, companyDomain, companyName, excluded: marked, points = 0 } of rows) {
    matchdays.set(date, [...(matchdays.get(date) ?? []), { memberId, points }]);
    members.set(memberId, { memberId, name, company: companyDomain && companyName ? { domain: companyDomain, name: companyName } : null });
    if (marked) excluded.add(memberId);
  }
  const named = (board: Row[]) =>
    board
      .map(({ memberId, rank, score, played }) => ({ ...members.get(memberId)!, rank, score, played }))
      .sort((a, b) => a.rank - b.rank || byName.compare(a.name, b.name));
  return { matchdays, members, excluded, named };
}

// A Season's Leaderboard, or null if there is no such Season: its number must be from 1 to MAX_SEASONS, and the
// schedule must have it, which it has for every Season once Season 1 is scheduled. Season 1 is always there.
export async function getSeason(number: number, now: Date): Promise<Season | null> {
  const dates = await matchdaysOfSeason(number, now);
  if (!dates) return number === 1 ? { number, matchdays: null, leaderboard: [], over: false, champions: [] } : null;
  const ingested = new Set(await recapDates());
  // Oldest first, so that each Member ends with the Company of the latest Matchday they played in the Season. MEMBER_SQL
  // names columns of "user" alone; neither "matchdayResult" nor "company" has any of those names.
  const { rows } = await db.query<Result & { points: number }>(
    `select to_char(r."matchdayDate", 'YYYY-MM-DD') as "date", r."userId" as "memberId", r."points", u.name,
       c."domain" as "companyDomain", c."name" as "companyName", u."lichessMarked" or u."lichessClosed" as "excluded"
     from "matchdayResult" r join "user" u on u.id = r."userId" left join "company" c on c."domain" = r."companyDomain"
     where r."matchdayDate" = any($1::date[]) and ${MEMBER_SQL}
     order by r."matchdayDate"`,
    [dates],
  );
  const { matchdays, members, excluded, named } = tally(rows);
  // All six, one not ingested yet as a Matchday nobody played.
  const six = dates.map((date) => matchdays.get(date) ?? []);
  const over = ingested.has(dates.at(-1)!);
  return {
    number,
    matchdays: dates.map((date) => ({ date, ingested: ingested.has(date) })),
    leaderboard: named(seasonLeaderboard(six, excluded)),
    over,
    champions: over
      ? seasonChampions(six, excluded)
          .map((memberId) => members.get(memberId)!)
          .sort((a, b) => byName.compare(a.name, b.name))
      : [],
  };
}

// The Seasons so far: those with at least one ingested Matchday, in order, and the current one, which a visitor means
// by "this Season". That is the latest Season with an ingested Matchday, and stays so through the week off after it
// ends, until the next Season's first Matchday is ingested. Before any, it is the Season of the next Matchday, and
// Season 1 while nothing is scheduled.
export async function seasonsSoFar(now: Date): Promise<{ played: number[]; current: number }> {
  const placed = await seasonsOf(await recapDates(), now);
  const played = [...new Set([...placed.values()].map((p) => p.season))].sort((a, b) => a - b);
  return { played, current: played.at(-1) ?? (await upcomingMatchday(now))?.season ?? 1 };
}

// The Season that has just ended and its champions, from its sixth Matchday until the next Season's first is
// ingested; null at any other time.
export async function newChampions(now: Date): Promise<{ season: number; champions: Member[] } | null> {
  const season = await getSeason((await seasonsSoFar(now)).current, now);
  return season?.over && season.champions.length > 0 ? { season: season.number, champions: season.champions } : null;
}

// Which Season the Matchday of a date belongs to, and which of its six it is; null for a Matchday outside every Season.
export async function seasonOfMatchday(date: string, now: Date): Promise<Place | null> {
  if (!isRecapDate(date)) return null;
  return (await seasonsOf([date], now)).get(date) ?? null;
}

// The all-time Leaderboard: every Member who has played a Matchday, ranked by how many, Matchdays outside any Season
// included, with the Company they are at now.
export async function getAllTime(): Promise<AllTimeRow[]> {
  // MEMBER_SQL names columns of "user" alone; neither "matchdayResult" nor "company" has any of those names.
  const { rows } = await db.query<Result>(
    `select to_char(r."matchdayDate", 'YYYY-MM-DD') as "date", r."userId" as "memberId", u.name,
       c."domain" as "companyDomain", c."name" as "companyName", u."lichessMarked" or u."lichessClosed" as "excluded"
     from "matchdayResult" r join "user" u on u.id = r."userId" left join "company" c on c."domain" = u."companyDomain"
     where ${MEMBER_SQL}`,
  );
  const { matchdays, excluded, named } = tally(rows);
  // Its score is the number of Matchdays played, which each row has already.
  return named(allTimeLeaderboard([...matchdays.values()], excluded)).map(({ memberId, name, company, rank, played }) => ({
    memberId,
    name,
    company,
    rank,
    played,
  }));
}
