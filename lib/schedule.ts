// When Matchdays happen. Dates are Vilnius calendar days as "YYYY-MM-DD".

import { SEASON_LENGTH } from "./leaderboard";

export const ZONE = "Europe/Vilnius";
export const START_HOUR = 20;
export const MEMBERS_TO_START = 16;

const DAY = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => fromMs(toMs(date) + days * DAY);

const sundayOnOrAfter = (date: string) => addDays(date, (7 - new Date(toMs(date)).getUTCDay()) % 7);

// Whether a "YYYY-MM-DD" string is a real calendar day and a Sunday.
export const isSunday = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(toMs(date)) && sundayOnOrAfter(date) === date;

// Whether a date could be a Matchday's, and so a Recap's address: a Sunday from the Club's first year to the end of the
// century. proxy.ts checks it, so this file must stay free of the database.
export const isRecapDate = (date: string) => isSunday(date) && date >= "2026-01-01" && date < "2100-01-01";

// The Vilnius calendar day of an instant.
export const vilniusDate = (instant: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(instant);

// The instant a Matchday starts: 20:00 Vilnius time on that day, whatever the clocks are doing.
export function matchdayStart(date: string): Date {
  const wall = toMs(date) + START_HOUR * 3_600_000; // 20:00 as if Vilnius were UTC
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
        .formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]),
    );
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms;
  };
  // 20:00 is never inside a clock change (those happen at 03:00/04:00), so one correction is exact.
  return new Date(wall - offsetAt(wall - offsetAt(wall)));
}

// How many more sign-ups Season 1 is waiting for, or null once there are enough.
export const signUpsNeeded = (signUps: number) => (signUps < MEMBERS_TO_START ? MEMBERS_TO_START - signUps : null);

// The first Sunday whose Matchday is at least seven days after an instant.
export function sundayAWeekAfter(instant: Date): string {
  const earliest = instant.getTime() + 7 * DAY;
  const sunday = sundayOnOrAfter(vilniusDate(new Date(earliest)));
  // An instant on a Sunday after 20:00 is less than a week before the next Sunday's Matchday.
  return matchdayStart(sunday).getTime() >= earliest ? sunday : addDays(sunday, 7);
}

// Season 1 starts the first Sunday whose Matchday is at least seven days after the sixteenth sign-up.
export function firstSeasonStart(signUps: Date[]): string | null {
  const sixteenth = [...signUps].sort((a, b) => a.getTime() - b.getTime())[MEMBERS_TO_START - 1];
  return sixteenth ? sundayAWeekAfter(sixteenth) : null;
}

// A Season is six played Matchdays; a skipped Sunday pushes the rest back a week.
export function seasonMatchdays(start: string, skipped: Iterable<string> = []): string[] {
  const skip = new Set(skipped);
  const dates: string[] = [];
  for (let d = sundayOnOrAfter(start); dates.length < SEASON_LENGTH; d = addDays(d, 7)) if (!skip.has(d)) dates.push(d);
  return dates;
}

// One Sunday off between Seasons.
export const nextSeasonStart = (lastMatchday: string) => addDays(lastMatchday, 14);
