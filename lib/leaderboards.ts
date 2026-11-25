// The Season and all-time Leaderboards as their pages show them, read from ingested Matchdays: lib/leaderboard.ts
// ranks, and this file reads the results and puts names and Companies to them. Leaderboards are public, so nothing else
// about a Member is read: no email, photo, LinkedIn, Lichess name or rating. A Member whose Lichess account is marked
// or closed is left out while it lasts, and anyone who is not a Member is not read at all.
//
// Which Season a Matchday belongs to is not stored. It is the Season whose six Matchdays, as the schedule
// (lib/seasons.ts) has them, include its date, and the schedule refuses any change that would give an ingested
// Matchday another Season, so a Matchday keeps its Season. Ingestion (#7) takes a Matchday on any Sunday that is not
// skipped, so one can fall on a Sunday that is none of a Season's six, before Season 1 or in the week off between two
// Seasons: it belongs to no Season, and counts in its Recap and on the all-time Leaderboard only.
//
// The Season champion is not stored either. It is whoever is first on the Season Leaderboard once the Season is over,
// worked out on every read like the Leaderboard itself, so the two always agree. The consequence: if a champion later
// leaves the Club or has their Lichess account marked or closed, or the Organiser redoes one of the Season's
// Matchdays, the title moves with the Leaderboard.

import type { Company } from "./companies";
import { db } from "./db";
import { rankByPlayed, seasonChampions, seasonLeaderboard, type MatchdayResult, type Row } from "./leaderboard";
import { MEMBER_SQL } from "./members";
import { recapDates } from "./recaps";
import { isRecapDate, matchdayStart } from "./schedule";
import { nextMatchdayIn, placesIn, readSchedule, seasonDates, type Place, type Schedule } from "./seasons";

export type Member = { memberId: string; name: string; company: Pick<Company, "domain" | "name"> | null };
export type AllTimeRow = Member & { rank: number; played: number };
export type SeasonRow = AllTimeRow & { score: number };

// What the Season pages ask of the database besides results, read once for a request and handed to the functions
// below: the schedule, and the dates of the Matchdays ingested so far.
export type Reading = { now: Date; schedule: Schedule; ingested: Set<string> };

export async function readLeaderboards(now: Date): Promise<Reading> {
  const [schedule, ingested] = await Promise.all([readSchedule(now), recapDates()]);
  return { now, schedule, ingested: new Set(ingested) };
}

// One of a Season's six Matchdays. It is missed if it was never ingested though the Season has gone past it: its
// tournament was never made, or ingestion refused it, as it does one no Member played.
export type SeasonMatchday = { date: string; ingested: boolean; missed: boolean };

export type Season = {
  number: number;
  // Null while Season 1 is not scheduled yet.
  matchdays: SeasonMatchday[] | null;
  leaderboard: SeasonRow[];
  over: boolean;
  // Named once it is over: more than one Member if they finish level, and nobody if nobody is left on the Leaderboard.
  champions: Member[];
};

// The Seasons so far: those with at least one ingested Matchday, in order; the current one, which a visitor means by
// "this Season"; and the last one with a page. The current Season is the latest with an ingested Matchday, and stays
// so through the week off after it ends, until the next Season's first Matchday is ingested; before any, it is the
// Season of the next Matchday, and Season 1 while nothing is scheduled. The last with a page is the one after it, or
// the next Matchday's if that is later: the dates of Seasons further off would still move.
export function seasonsSoFar({ now, schedule, ingested }: Reading): { played: number[]; current: number; last: number } {
  const played = [...new Set([...placesIn(schedule, ingested).values()].map((p) => p.season))].sort((a, b) => a - b);
  const next = nextMatchdayIn(schedule, now)?.season;
  const current = played.at(-1) ?? next ?? 1;
  return { played, current, last: Math.max(current + 1, next ?? 0) };
}

// Where a Season stands, without its results, or null if it has no page. It is over once its last Matchday is
// ingested; or, if that one never is, once any later Matchday is, or the next Season's first has started.
function standing(number: number, reading: Reading) {
  const { now, schedule, ingested } = reading;
  const dates = number <= seasonsSoFar(reading).last ? seasonDates(schedule, number) : null;
  if (!dates) return null;
  const last = dates.at(-1)!;
  const nextFirst = seasonDates(schedule, number + 1)?.[0];
  const over =
    ingested.has(last) || [...ingested].some((date) => date > last) || (!!nextFirst && matchdayStart(nextFirst) <= now);
  const done = dates.findLastIndex((date) => ingested.has(date)) + 1;
  const matchdays = dates.map((date, i) => ({ date, ingested: ingested.has(date), missed: !ingested.has(date) && (over || i < done) }));
  return { dates, over, matchdays };
}

type Result = { memberId: string; name: string; companyDomain: string | null; companyName: string | null; excluded: boolean };

const memberOf = ({ memberId, name, companyDomain, companyName }: Result): Member => ({
  memberId,
  name,
  company: companyDomain && companyName ? { domain: companyDomain, name: companyName } : null,
});

// Members level on rank are listed by name, so the order never depends on how the rows came back.
const byName = new Intl.Collator("en");

const named = (board: Row[], members: Map<string, Member>) =>
  board
    .map(({ memberId, rank, score, played }) => ({ ...members.get(memberId)!, rank, score, played }))
    .sort((a, b) => a.rank - b.rank || byName.compare(a.name, b.name));

// A Season's Leaderboard, or null if there is no such Season or it is too far off to have a page. Season 1 is always
// there, scheduled or not.
export async function getSeason(number: number, reading: Reading): Promise<Season | null> {
  const found = standing(number, reading);
  if (!found)
    return number === 1 && !seasonDates(reading.schedule, 1)
      ? { number, matchdays: null, leaderboard: [], over: false, champions: [] }
      : null;
  // Oldest first, so that each Member ends with the Company of the latest Matchday they played in the Season. MEMBER_SQL
  // names columns of "user" alone; neither "matchdayResult" nor "company" has any of those names.
  const { rows } = await db.query<Result & { date: string; points: number }>(
    `select to_char(r."matchdayDate", 'YYYY-MM-DD') as "date", r."userId" as "memberId", r."points", u.name,
       c."domain" as "companyDomain", c."name" as "companyName", u."lichessMarked" or u."lichessClosed" as "excluded"
     from "matchdayResult" r join "user" u on u.id = r."userId" left join "company" c on c."domain" = r."companyDomain"
     where r."matchdayDate" = any($1::date[]) and ${MEMBER_SQL}
     order by r."matchdayDate"`,
    [found.dates],
  );
  const matchdays = new Map<string, MatchdayResult>();
  const members = new Map<string, Member>();
  const excluded = new Set<string>();
  for (const row of rows) {
    matchdays.set(row.date, [...(matchdays.get(row.date) ?? []), { memberId: row.memberId, points: row.points }]);
    members.set(row.memberId, memberOf(row));
    if (row.excluded) excluded.add(row.memberId);
  }
  const played = [...matchdays.values()];
  return {
    number,
    matchdays: found.matchdays,
    leaderboard: named(seasonLeaderboard(played, excluded), members),
    over: found.over,
    champions: found.over
      ? seasonChampions(played, excluded)
          .map((memberId) => members.get(memberId)!)
          .sort((a, b) => byName.compare(a.name, b.name))
      : [],
  };
}

// The current Season and its champions once it is over, until the next Season's first Matchday is ingested; null at
// any other time. Results are read only while there is a champion to name.
export async function newChampions(now: Date): Promise<{ season: number; champions: Member[] } | null> {
  const reading = await readLeaderboards(now);
  const { current } = seasonsSoFar(reading);
  if (!standing(current, reading)?.over) return null;
  const season = await getSeason(current, reading);
  return season && season.champions.length > 0 ? { season: current, champions: season.champions } : null;
}

// Which Season the Matchday of a date belongs to, and which of its six it is; null for a Matchday outside every Season.
export async function seasonOfMatchday(date: string, now: Date): Promise<Place | null> {
  if (!isRecapDate(date)) return null;
  return placesIn(await readSchedule(now), [date]).get(date) ?? null;
}

// The all-time Leaderboard: every Member who has played a Matchday, ranked by how many, Matchdays outside any Season
// included, with the Company they are at now. The database counts them.
export async function getAllTime(): Promise<AllTimeRow[]> {
  // MEMBER_SQL names columns of "user" alone; neither "matchdayResult" nor "company" has any of those names. Grouping by
  // each table's key lets the other columns of its row be selected.
  const { rows } = await db.query<Result & { played: number }>(
    `select u.id as "memberId", u.name, c."domain" as "companyDomain", c."name" as "companyName",
       u."lichessMarked" or u."lichessClosed" as "excluded", count(*)::int as "played"
     from "matchdayResult" r join "user" u on u.id = r."userId" left join "company" c on c."domain" = u."companyDomain"
     where ${MEMBER_SQL}
     group by u.id, c."domain"`,
  );
  const members = new Map(rows.map((row) => [row.memberId, memberOf(row)]));
  const excluded = new Set(rows.filter((row) => row.excluded).map((row) => row.memberId));
  return named(rankByPlayed(rows, excluded), members).map(({ memberId, name, company, rank, played }) => ({
    memberId,
    name,
    company,
    rank,
    played,
  }));
}
