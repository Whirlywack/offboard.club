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

// Season 1 starts the first Sunday whose Matchday is at least seven days after the sixteenth sign-up.
export function firstSeasonStart(signUps: Date[]): string | null {
  const sixteenth = [...signUps].sort((a, b) => a.getTime() - b.getTime())[MEMBERS_TO_START - 1];
  if (!sixteenth) return null;
  const earliest = sixteenth.getTime() + 7 * DAY;
  const sunday = sundayOnOrAfter(vilniusDate(new Date(earliest)));
  // A sign-up on a Sunday after 20:00 is less than a week before the next Sunday's Matchday.
  return matchdayStart(sunday).getTime() >= earliest ? sunday : addDays(sunday, 7);
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
