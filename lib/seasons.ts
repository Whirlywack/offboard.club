// The stored schedule: Seasons whose start is fixed, skipped Sundays, and the Matchdays that follow from them.
// Functions that depend on the time take it as `now`. Tests replace the database with a fake Store.

import { db } from "./db";
import { firstSeasonStart, isSunday, matchdayStart, nextSeasonStart, seasonMatchdays } from "./schedule";
import { signUpTimes } from "./signups";

// A Season whose start is fixed. Seasons without one start two weeks after the previous Season's last Matchday.
export type StoredSeason = { number: number; start: string; startSetByHand: boolean };

export type Store = {
  seasons(): Promise<StoredSeason[]>;
  skippedSundays(): Promise<string[]>;
  signUpTimes(): Promise<Date[]>;
  // Leaves a Season that is already stored as it is, so of several racing callers only the first is kept.
  addSeason(season: StoredSeason): Promise<void>;
  setStartByHand(number: number, start: string): Promise<void>;
  setSkipped(date: string, skipped: boolean): Promise<void>;
};

export const postgres: Store = {
  async seasons() {
    const { rows } = await db.query<StoredSeason>(
      `select "number", to_char("start", 'YYYY-MM-DD') as "start", "startSetByHand" from "season"`,
    );
    return rows;
  },
  async skippedSundays() {
    const { rows } = await db.query<{ date: string }>(`select to_char("date", 'YYYY-MM-DD') as "date" from "skippedSunday"`);
    return rows.map((row) => row.date);
  },
  signUpTimes,
  async addSeason({ number, start, startSetByHand }) {
    await db.query(
      `insert into "season" ("number", "start", "startSetByHand") values ($1, $2, $3) on conflict ("number") do nothing`,
      [number, start, startSetByHand],
    );
  },
  async setStartByHand(number, start) {
    await db.query(
      `insert into "season" ("number", "start", "startSetByHand") values ($1, $2, true)
       on conflict ("number") do update set "start" = excluded."start", "startSetByHand" = true`,
      [number, start],
    );
  },
  async setSkipped(date, skipped) {
    await db.query(
      skipped
        ? `insert into "skippedSunday" ("date") values ($1) on conflict do nothing`
        : `delete from "skippedSunday" where "date" = $1`,
      [date],
    );
  },
};

type Schedule = { seasons: StoredSeason[]; skipped: string[] };
type Season = { number: number; matchdays: string[] };

// Every Season in order, without end; nothing until Season 1 is stored.
function* seasons({ seasons: stored, skipped }: Schedule): Generator<Season> {
  const fixed = new Map(stored.map((s) => [s.number, s.start]));
  for (let number = 1, start = fixed.get(1); start; number++) {
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
async function load(store: Store): Promise<Schedule> {
  const [stored, skipped] = await Promise.all([store.seasons(), store.skippedSundays()]);
  if (stored.some((s) => s.number === 1)) return { seasons: stored, skipped };
  const start = firstSeasonStart(await store.signUpTimes());
  if (!start) return { seasons: stored, skipped };
  await store.addSeason({ number: 1, start, startSetByHand: false });
  // Another request may have stored Season 1 first; the stored one is the one that counts.
  return { seasons: await store.seasons(), skipped };
}

export type Matchday = { season: number; number: number; date: string; start: Date };

// The first Matchday that has not started by `now`, or null while Season 1 is not scheduled.
export async function upcomingMatchday(now: Date, store = postgres): Promise<Matchday | null> {
  for (const { number: season, matchdays } of seasons(await load(store))) {
    const i = matchdays.findIndex((date) => matchdayStart(date) > now);
    if (i >= 0) return { season, number: i + 1, date: matchdays[i], start: matchdayStart(matchdays[i]) };
  }
  return null;
}

// The dates of a Season's six Matchdays, or null if there is no such Season yet.
export async function matchdaysOfSeason(number: number, store = postgres): Promise<string[] | null> {
  if (!Number.isInteger(number)) return null;
  return findSeason(await load(store), number)?.matchdays ?? null;
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

// Why a change to the schedule cannot be made, or null: it must leave the Matchdays already played where they
// were, and no Season may start before the previous one has finished.
function changeProblem(before: Schedule, after: Schedule, now: Date): string | null {
  if (started(before, now).join() !== started(after, now).join()) return "That would move Matchdays already played.";
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

const sundayProblem = (date: string, now: Date) =>
  !isSunday(date) ? `${date} is not a Sunday.` : matchdayStart(date) <= now ? `It is too late to change ${date}.` : null;

async function setSkipped(date: string, skipped: boolean, now: Date, store: Store): Promise<string | null> {
  const problem = sundayProblem(date, now);
  if (problem) return problem;
  const before = await load(store);
  const after = { ...before, skipped: [...before.skipped.filter((d) => d !== date), ...(skipped ? [date] : [])] };
  const changed = changeProblem(before, after, now);
  if (changed) return changed;
  await store.setSkipped(date, skipped);
  return null;
}

// A Sunday with no Matchday: it is not one of its Season's six, so that Season runs a week longer and the
// ones after it move back. Each returns why the change cannot be made, or null once it is made.
export const skipSunday = (date: string, now: Date, store = postgres) => setSkipped(date, true, now, store);
export const unskipSunday = (date: string, now: Date, store = postgres) => setSkipped(date, false, now, store);

// The Organiser's start for a Season, in place of the automatic one; Seasons after it without a start of their
// own move with it. Returns why the change cannot be made, or null once it is made.
export async function setSeasonStart(number: number, start: string, now: Date, store = postgres): Promise<string | null> {
  if (!Number.isInteger(number) || number < 1) return `There is no Season ${number}.`;
  const problem = sundayProblem(start, now);
  if (problem) return problem;
  const before = await load(store);
  if (number > 1 && !findSeason(before, 1)) return "Season 1 is not scheduled yet.";
  const after = { ...before, seasons: [...before.seasons.filter((s) => s.number !== number), { number, start, startSetByHand: true }] };
  const changed = changeProblem(before, after, now);
  if (changed) return changed;
  await store.setStartByHand(number, start);
  return null;
}
