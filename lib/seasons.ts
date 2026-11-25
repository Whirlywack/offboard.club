// The stored schedule: Seasons whose start is fixed, skipped Sundays, and the Matchdays that follow from them.
// Every function takes the time it treats as now. Tests replace the database with a fake Store.

import { db, type Queryable } from "./db";
import { addDays, firstSeasonStart, isSunday, MAX_SEASONS, matchdayStart, nextSeasonStart, seasonMatchdays, sundayAWeekAfter, vilniusDate } from "./schedule";
import { signUpTimes } from "./signups";

// Kept in lib/schedule.ts, which proxy.ts can use without the database.
export { MAX_SEASONS };
// How far ahead a Sunday can be skipped or a Season's start set.
export const DAYS_AHEAD = 730;

// A Season whose start is fixed: Season 1 once scheduled, and any Season whose start the Organiser set.
// Seasons without one start two weeks after the previous Season's last Matchday.
export type StoredSeason = { number: number; start: string };

export type Store = {
  seasons(): Promise<StoredSeason[]>;
  skippedSundays(): Promise<string[]>;
  signUpTimes(): Promise<Date[]>;
  // Leaves a Season that is already stored as it is, so of several racing callers only the first is kept.
  addSeason(season: StoredSeason): Promise<void>;
  setStart(season: StoredSeason): Promise<void>;
  setSkipped(date: string, skipped: boolean): Promise<void>;
  // The dates of the Matchdays ingested so far, whose Season no change to the schedule may alter.
  ingestedDates(): Promise<string[]>;
};

export const postgresStore = (q: Queryable): Store => ({
  async seasons() {
    const { rows } = await q.query<StoredSeason>(`select "number", to_char("start", 'YYYY-MM-DD') as "start" from "season"`);
    return rows;
  },
  async skippedSundays() {
    const { rows } = await q.query<{ date: string }>(`select to_char("date", 'YYYY-MM-DD') as "date" from "skippedSunday"`);
    return rows.map((row) => row.date);
  },
  signUpTimes: () => signUpTimes(q),
  async addSeason({ number, start }) {
    await q.query(`insert into "season" ("number", "start") values ($1, $2) on conflict ("number") do nothing`, [number, start]);
  },
  async setStart({ number, start }) {
    await q.query(
      `insert into "season" ("number", "start") values ($1, $2) on conflict ("number") do update set "start" = excluded."start"`,
      [number, start],
    );
  },
  async setSkipped(date, skipped) {
    await q.query(
      skipped
        ? `insert into "skippedSunday" ("date") values ($1) on conflict do nothing`
        : `delete from "skippedSunday" where "date" = $1`,
      [date],
    );
  },
  async ingestedDates() {
    const { rows } = await q.query<{ date: string }>(
      `select to_char("date", 'YYYY-MM-DD') as "date" from "matchday" where "ingestedAt" is not null order by "date" desc`,
    );
    return rows.map((row) => row.date);
  },
});

export const postgres = postgresStore(db);

// The schedule as stored. readSchedule reads it once for a caller with several questions about it.
export type Schedule = { seasons: StoredSeason[]; skipped: string[] };
type Season = { number: number; matchdays: string[] };

// Every Season in order up to the last one; nothing until Season 1 is stored.
function* seasons({ seasons: stored, skipped }: Schedule): Generator<Season> {
  const fixed = new Map(stored.map((s) => [s.number, s.start]));
  for (let number = 1, start = fixed.get(1); start && number <= MAX_SEASONS; number++) {
    const matchdays = seasonMatchdays(start, skipped);
    yield { number, matchdays };
    start = fixed.get(number + 1) ?? nextSeasonStart(matchdays.at(-1)!);
  }
}

const findSeason = (schedule: Schedule, number: number) => {
  for (const s of seasons(schedule)) if (s.number >= number) return s.number === number ? s : undefined;
};

// Reads the schedule, first storing Season 1 if its sixteenth sign-up has arrived. Checking on every read,
// rather than where a sign-up completes, means no way of signing up can miss it, and a failure is retried.
// Once stored, Season 1 stays put whoever signs up or leaves later.
async function load(store: Store, now: Date): Promise<Schedule> {
  const [stored, skipped] = await Promise.all([store.seasons(), store.skippedSundays()]);
  if (stored.some((s) => s.number === 1)) return { seasons: stored, skipped };
  const due = firstSeasonStart(await store.signUpTimes());
  if (!due) return { seasons: stored, skipped };
  // Noticed too late for that Sunday (the database was down, say): give the same week's notice from now.
  const start = matchdayStart(due) > now ? due : sundayAWeekAfter(now);
  await store.addSeason({ number: 1, start });
  // Another request may have stored Season 1 first; the stored one is the one that counts.
  return { seasons: await store.seasons(), skipped };
}

export type Matchday = { season: number; number: number; date: string; start: Date };

// The schedule, read once, for the functions below that take it.
export const readSchedule = (now: Date, store = postgres) => load(store, now);

// The first Matchday that has not started by `now`, or null while Season 1 is not scheduled.
export function nextMatchdayIn(schedule: Schedule, now: Date): Matchday | null {
  for (const { number: season, matchdays } of seasons(schedule)) {
    const i = matchdays.findIndex((date) => matchdayStart(date) > now);
    if (i >= 0) return { season, number: i + 1, date: matchdays[i], start: matchdayStart(matchdays[i]) };
  }
  return null;
}

export const upcomingMatchday = async (now: Date, store = postgres) => nextMatchdayIn(await load(store, now), now);

const isSeasonNumber = (number: number) => Number.isInteger(number) && number >= 1 && number <= MAX_SEASONS;

// The dates of a Season's six Matchdays, or null if there is no such Season yet.
export function seasonDates(schedule: Schedule, number: number): string[] | null {
  if (!isSeasonNumber(number)) return null;
  return findSeason(schedule, number)?.matchdays ?? null;
}

export const matchdaysOfSeason = async (number: number, now: Date, store = postgres) =>
  isSeasonNumber(number) ? seasonDates(await load(store, now), number) : null;

export type Place = { season: number; number: number };

// Which Season each date's Matchday belongs to, and which of its six it is. A date that is none of a Season's six, such
// as a Sunday before Season 1 or the week off between two Seasons, belongs to no Season and is left out. Goes through
// the schedule no further than the latest date given.
export function placesIn(schedule: Schedule, dates: Iterable<string>): Map<string, Place> {
  const placed = new Map<string, Place>();
  const wanted = new Set(dates);
  if (wanted.size === 0) return placed;
  const latest = [...wanted].reduce((a, b) => (a > b ? a : b));
  for (const { number: season, matchdays } of seasons(schedule)) {
    matchdays.forEach((date, i) => {
      if (wanted.has(date)) placed.set(date, { season, number: i + 1 });
    });
    if (matchdays.at(-1)! >= latest) break;
  }
  return placed;
}

// The Matchdays that have started by `now`.
function started(schedule: Schedule, now: Date): string[] {
  const dates: string[] = [];
  for (const { matchdays } of seasons(schedule))
    for (const date of matchdays) {
      if (matchdayStart(date) > now) return dates;
      dates.push(date);
    }
  return dates;
}

// Why a change to the schedule cannot be made, or null: it must leave the Matchdays already played where they were,
// judged both by their start and by ingestion, so that a Matchday ingested before its Sunday's 20:00 (a tournament made
// by hand) or on a Sunday outside every Season keeps its place; and no Season may start before the previous one has
// finished.
function changeProblem(before: Schedule, after: Schedule, now: Date, ingested: string[]): string | null {
  if (started(before, now).join() !== started(after, now).join()) return "That would move Matchdays already played.";
  const [was, would] = [placesIn(before, ingested), placesIn(after, ingested)];
  const moved = ingested.find((date) => JSON.stringify(was.get(date)) !== JSON.stringify(would.get(date)));
  if (moved) return `That would change which Season the Matchday of ${moved}, already played, belongs to.`;
  const last = Math.max(...after.seasons.map((s) => s.number));
  let previous: Season | undefined;
  for (const s of seasons(after)) {
    if (s.number > last) break;
    if (previous && s.matchdays[0] <= previous.matchdays.at(-1)!)
      return `Season ${s.number} would start before Season ${previous.number} has finished.`;
    previous = s;
  }
  return null;
}

function sundayProblem(date: string, now: Date): string | null {
  if (!isSunday(date)) return `${date} is not a Sunday.`;
  if (matchdayStart(date) <= now) return `It is too late to change ${date}.`;
  if (date > addDays(vilniusDate(now), DAYS_AHEAD)) return `${date} is more than two years ahead.`;
  return null;
}

async function setSkipped(date: string, skipped: boolean, now: Date, store: Store): Promise<string | null> {
  const problem = sundayProblem(date, now);
  if (problem) return problem;
  const [before, ingested] = await Promise.all([load(store, now), store.ingestedDates()]);
  const after = { ...before, skipped: [...before.skipped.filter((d) => d !== date), ...(skipped ? [date] : [])] };
  const changed = changeProblem(before, after, now, ingested);
  if (changed) return changed;
  await store.setSkipped(date, skipped);
  return null;
}

// A Sunday with no Matchday: it is not one of its Season's six, so that Season runs a week longer and the
// ones after it move back. A Season whose start was set keeps it, even if that leaves no week off before it.
// Each returns why the change cannot be made, or null once it is made.
export const skipSunday = (date: string, now: Date, store = postgres) => setSkipped(date, true, now, store);
export const unskipSunday = (date: string, now: Date, store = postgres) => setSkipped(date, false, now, store);

// The Organiser's start for a Season, in place of the automatic one; Seasons after it without a start of their
// own move with it. Returns why the change cannot be made, or null once it is made.
export async function setSeasonStart(number: number, start: string, now: Date, store = postgres): Promise<string | null> {
  if (!isSeasonNumber(number)) return `There is no Season ${number}.`;
  const problem = sundayProblem(start, now);
  if (problem) return problem;
  const [before, ingested] = await Promise.all([load(store, now), store.ingestedDates()]);
  if (number > 1 && !findSeason(before, 1)) return "Season 1 is not scheduled yet.";
  const after = { ...before, seasons: [...before.seasons.filter((s) => s.number !== number), { number, start }] };
  const changed = changeProblem(before, after, now, ingested);
  if (changed) return changed;
  await store.setStart({ number, start });
  return null;
}
