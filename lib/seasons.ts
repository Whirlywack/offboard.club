// The stored schedule: Seasons whose start is fixed, skipped Sundays, and the Matchdays that follow from them.
// Every function takes the time it treats as now. Tests replace the database with a fake Store.
//
// The Club's Telegram group is told of each change a Member would notice (#13): a Sunday skipped, or given back its
// Matchday, and a Season's start, set by the Organiser or by the sixteenth sign-up. The notice is queued by the
// statement that makes the change, and only when it changes something, so it is queued once however the change comes
// about and however often it is asked for (lib/telegram.ts). Skipping a Sunday also takes back its reminders, in the
// same statement, unless one is already being sent.

import { db, type Queryable } from "./db";
import { addDays, firstSeasonStart, isSunday, MAX_SEASONS, matchdayStart, nextSeasonStart, seasonMatchdays, sundayAWeekAfter, vilniusDate } from "./schedule";
import { signUpTimes } from "./signups";
import { deliverNotice, NOTICE, postDay, postingSetUp } from "./telegram";

// A post for the Telegram group, worth posting until `until`; null when Telegram is not set up or there is nothing to say.
type Notice = { text: string; until: Date } | null;

// Kept in lib/schedule.ts, which proxy.ts can use without the database.
export { MAX_SEASONS };
// How far ahead a Sunday can be skipped or a Season's start set.
export const DAYS_AHEAD = 730;

// A Season whose start is fixed: Season 1 once scheduled, and any Season whose start the Organiser set.
// Seasons without one start two weeks after the previous Season's last Matchday.
export type StoredSeason = { number: number; start: string };

// Each change queues its notice for the Telegram group in the same statement, and only if it changed what is stored.
export type Store = {
  seasons(): Promise<StoredSeason[]>;
  skippedSundays(): Promise<string[]>;
  signUpTimes(): Promise<Date[]>;
  // Leaves a Season that is already stored as it is, so of several racing callers only the first is kept.
  addSeason(season: StoredSeason, notice: Notice): Promise<void>;
  setStart(season: StoredSeason, notice: Notice): Promise<void>;
  setSkipped(date: string, skipped: boolean, notice: Notice): Promise<void>;
  // The dates of the Matchdays ingested so far, whose Season no change to the schedule may alter.
  ingestedDates(): Promise<string[]>;
};

// `changed` is a statement that returns a row when it changes something; the notice, its text and until the parameters
// after the statement's own, is queued from that row. `first` is another part of the same statement, ending in a comma.
const withNotice = (changed: string, n: number, first = "") =>
  `with ${first}changed as (${changed} returning 1)
   insert into "telegramPost" ("key", "text", "until") select '${NOTICE}' || gen_random_uuid()::text, $${n}, $${n + 1} from changed where $${n}::text is not null`;

// The reminders of the Sunday $1 not yet claimed by a delivery (lib/post-to-telegram.ts keys them by date).
const TAKE_BACK_REMINDERS = `reminders as (delete from "telegramPost" where "key" like 'reminder:' || to_char($1::date, 'YYYY-MM-DD') || ':%' and "claimedAt" is null), `;
const noticeParams = (notice: Notice) => [notice?.text ?? null, notice?.until ?? null];

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
  async addSeason({ number, start }, notice) {
    await q.query(withNotice(`insert into "season" ("number", "start") values ($1, $2) on conflict ("number") do nothing`, 3), [
      number,
      start,
      ...noticeParams(notice),
    ]);
  },
  async setStart({ number, start }, notice) {
    await q.query(
      withNotice(
        `insert into "season" ("number", "start") values ($1, $2)
         on conflict ("number") do update set "start" = excluded."start" where "season"."start" is distinct from excluded."start"`,
        3,
      ),
      [number, start, ...noticeParams(notice)],
    );
  },
  async setSkipped(date, skipped, notice) {
    await q.query(
      skipped
        ? withNotice(`insert into "skippedSunday" ("date") values ($1) on conflict do nothing`, 2, TAKE_BACK_REMINDERS)
        : withNotice(`delete from "skippedSunday" where "date" = $1`, 2),
      [date, ...noticeParams(notice)],
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
  // Its notice waits for the next run of Posting to Telegram: this may be a page being read.
  await store.addSeason({ number: 1, start }, seasonNotice(1, seasonMatchdays(start, skipped)[0]));
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

// The notices, each worth posting until the Sunday it is about has begun.
const notice = (text: string, date: string): Notice => (postingSetUp() ? { text, until: matchdayStart(date) } : null);
const seasonNotice = (number: number, first: string) => notice(`Season ${number} starts on ${postDay(first)} at 20:00.`, first);
const isMatchday = (schedule: Schedule, date: string) => placesIn(schedule, [date]).has(date);

// Posts the notice just queued, or an older one still waiting, and nothing else: at most one request to Telegram, cut
// off at 10 s, and three statements. It never throws: a failure leaves the change made, and the notice for the next
// run of Posting to Telegram, which tries a refused one again and reports one Telegram may have posted.
const announce = (now: Date) =>
  deliverNotice(now).catch((error: Error) => void console.error("Posting a notice to Telegram failed:", error.message));

async function setSkipped(date: string, skipped: boolean, now: Date, store: Store): Promise<string | null> {
  const problem = sundayProblem(date, now);
  if (problem) return problem;
  const [before, ingested] = await Promise.all([load(store, now), store.ingestedDates()]);
  const after = { ...before, skipped: [...before.skipped.filter((d) => d !== date), ...(skipped ? [date] : [])] };
  const changed = changeProblem(before, after, now, ingested);
  if (changed) return changed;
  // Only a Sunday that had a Matchday, or has one now, is news: not one before Season 1 or in a week off.
  const next = nextMatchdayIn(after, matchdayStart(date));
  const told = skipped
    ? isMatchday(before, date) && notice(`No Matchday on ${postDay(date)}.${next ? ` The next one is on ${postDay(next.date)} at 20:00.` : ""}`, date)
    : isMatchday(after, date) && notice(`${postDay(date)} has a Matchday after all, at 20:00.`, date);
  await store.setSkipped(date, skipped, told || null);
  if (told) await announce(now);
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
  // The Season's first Matchday, which a skipped Sunday may put after the start; news only when it moves.
  const first = findSeason(after, number)?.matchdays[0];
  const told = first !== undefined && first !== findSeason(before, number)?.matchdays[0] && seasonNotice(number, first);
  await store.setStart({ number, start }, told || null);
  if (told) await announce(now);
  return null;
}
