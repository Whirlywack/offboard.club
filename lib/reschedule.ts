// The Organiser's changes to the schedule (#16): skipping an upcoming Matchday, undoing a skip, and setting a Season's
// start, each made by lib/seasons.ts. After each, every tournament the site created on Lichess for a Sunday that is no
// longer a Matchday is cancelled there with the Organiser's permission and cleared from its Matchday, so that
// Collecting results does not look for it.
//
// The change itself stands whatever Lichess does. A tournament that cannot be cancelled, because Lichess refuses or
// cannot be reached or the Organiser's permission cannot be used, is cleared all the same and kept in
// "tournamentCancellation" with why, for the Organiser to cancel by hand: the Organiser page lists each one until the
// Organiser says it is done. Until then Members can still join it on Lichess, but nothing is collected from it, as its
// Sunday has no Matchday. Should that Sunday become a Matchday again, its tournament is wanted after all: it is
// forgotten here, and Creating Matchdays finds it on the team and records it again (lib/create-matchdays.ts).
//
// Each refuses a change that would change nothing, so that a form sent twice does not make it twice.

import { db } from "./db";
import { sentence } from "./jobs";
import { LICHESS_DEADLINE_MS } from "./leaving";
import { cancelSwiss, timeLimit } from "./lichess";
import { organiserToken, refusedPermission } from "./organiser-lichess";
import { matchdayStart, ZONE } from "./schedule";
import { placesIn, readSchedule, seasonDates, setSeasonStart, skipSunday, unskipSunday } from "./seasons";

// What the Organiser is told: what happened, and whether it needs them, as a refusal or a tournament to cancel by hand.
export type Said = { text: string; problem: boolean };

const refusal = (text: string): Said => ({ text, problem: true });

// A Sunday as the Organiser page writes it, "Sunday 29 November".
const sunday = (date: string) =>
  matchdayStart(date).toLocaleDateString("en-GB", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long" });

// The change, then what became of each tournament it left without a Matchday.
const told = (text: string, tournaments: Said[]): Said => ({
  text: [text, ...tournaments.map((t) => t.text)].join(" "),
  problem: tournaments.some((t) => t.problem),
});

// `date` is a Sunday ("YYYY-MM-DD"), as each of these three is given it.
export async function skipMatchday(date: string, now: Date): Promise<Said> {
  const before = await readSchedule(now);
  if (before.skipped.includes(date)) return refusal(`${sunday(date)} is already skipped.`);
  const place = placesIn(before, [date]).get(date);
  if (!place) return refusal(`${sunday(date)} has no Matchday to skip.`);
  const problem = await skipSunday(date, now);
  if (problem) return refusal(problem);
  const end = seasonDates(await readSchedule(now), place.season)!.at(-1)!;
  return told(`${sunday(date)} is skipped, so Season ${place.season} now ends on ${sunday(end)}.`, await cancelStranded(now));
}

export async function unskipMatchday(date: string, now: Date): Promise<Said> {
  if (!(await readSchedule(now)).skipped.includes(date)) return refusal(`${sunday(date)} isn't skipped.`);
  const problem = await unskipSunday(date, now);
  if (problem) return refusal(problem);
  return told(`${sunday(date)} is no longer skipped.`, await cancelStranded(now));
}

// `start` is a "YYYY-MM-DD" date, which setSeasonStart checks is a Sunday.
export async function changeSeasonStart(number: number, start: string, now: Date): Promise<Said> {
  if (seasonDates(await readSchedule(now), number)?.[0] === start) return refusal(`Season ${number} already starts on ${sunday(start)}.`);
  const problem = await setSeasonStart(number, start, now);
  if (problem) return refusal(problem);
  const first = seasonDates(await readSchedule(now), number)![0];
  return told(`Season ${number} now starts on ${sunday(first)}.`, await cancelStranded(now));
}

export type Cancellation = { lichessTournamentId: string; date: string; problem: string };

// Every tournament to cancel on Lichess by hand, by its Sunday.
export async function tournamentCancellations(): Promise<Cancellation[]> {
  const { rows } = await db.query<Cancellation>(
    `select "lichessTournamentId", to_char("date", 'YYYY-MM-DD') as "date", "problem" from "tournamentCancellation"
     order by "date", "lichessTournamentId"`,
  );
  return rows;
}

// The Organiser has cancelled it on Lichess: the site forgets it.
export async function forgetTournamentCancellation(lichessTournamentId: string): Promise<void> {
  await db.query(`delete from "tournamentCancellation" where "lichessTournamentId" = $1`, [lichessTournamentId]);
}

type Tournament = { date: string; lichessTournamentId: string };

// Each tournament recorded for a Matchday that has not started and has no results, whose Sunday the schedule no longer
// has as a Matchday, cancelled on Lichess, within one deadline for them all, and cleared; and each kept to cancel by
// hand whose Sunday is a Matchday again, forgotten. What became of each tournament, for the Organiser.
async function cancelStranded(now: Date): Promise<Said[]> {
  const { rows } = await db.query<Tournament>(
    `select to_char("date", 'YYYY-MM-DD') as "date", "lichessTournamentId" from "matchday"
     where "ingestedAt" is null and "lichessTournamentId" is not null`,
  );
  const kept = await tournamentCancellations();
  const places = placesIn(await readSchedule(now), [...rows, ...kept].map((t) => t.date));
  const wanted = kept.filter((t) => places.has(t.date)).map((t) => t.date);
  if (wanted.length > 0) await db.query(`delete from "tournamentCancellation" where "date" = any($1::date[])`, [wanted]);
  const stranded = rows.filter((t) => matchdayStart(t.date) > now && !places.has(t.date));
  if (stranded.length === 0) return [];
  const permission = await organiserToken(now);
  const deadline = timeLimit(LICHESS_DEADLINE_MS, `Lichess took more than ${LICHESS_DEADLINE_MS / 1000} s`);
  try {
    const said: Said[] = [];
    for (const tournament of stranded)
      said.push(await cancel(tournament, "problem" in permission ? permission.problem : await tryCancel(tournament, permission, deadline.signal)));
    return said;
  } finally {
    deadline.clear();
  }
}

// Null once Lichess has cancelled it, or has no such tournament; otherwise why not.
async function tryCancel({ lichessTournamentId }: Tournament, permission: { token: string; lichessId: string }, signal: AbortSignal) {
  try {
    await cancelSwiss(permission.token, lichessTournamentId, signal);
    return null;
  } catch (error) {
    return refusedPermission(error, permission.lichessId) ?? (error instanceof Error ? error.message : "unknown error");
  }
}

// Clears the tournament from its Matchday, unless that has changed since, having first kept it to cancel by hand if
// Lichess did not cancel it: if the clearing fails, it is still kept.
async function cancel({ date, lichessTournamentId }: Tournament, problem: string | null): Promise<Said> {
  if (problem)
    await db.query(
      `insert into "tournamentCancellation" ("lichessTournamentId", "date", "problem") values ($1, $2, $3)
       on conflict ("lichessTournamentId") do update set "date" = excluded."date", "problem" = excluded."problem"`,
      [lichessTournamentId, date, `${sentence(problem)}.`],
    );
  await db.query(`delete from "matchday" where "date" = $1 and "lichessTournamentId" = $2 and "ingestedAt" is null`, [
    date,
    lichessTournamentId,
  ]);
  return problem
    ? { text: `The site couldn't cancel the tournament for ${sunday(date)} on Lichess: cancel it there by hand, as listed below.`, problem: true }
    : { text: `The tournament for ${sunday(date)} is cancelled on Lichess.`, problem: false };
}
