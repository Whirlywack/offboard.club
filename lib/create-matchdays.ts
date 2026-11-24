// The scheduled job that creates each Matchday's tournament on Lichess (#11), run every hour by Vercel
// (app/api/jobs/create-matchdays). Once the upcoming Matchday is six days away or less and has no tournament, it creates
// a Swiss on the Club's team with the Organiser's permission and records it (registerTournament), so that the link
// exists for the site and the reminders. A skipped Sunday is not in the schedule, so it gets nothing.
//
// Exactly once per Matchday:
// - Runs at the same moment: only the run holding the job works (runJob); the others do nothing.
// - Runs one after another: a Matchday that has its tournament recorded is left alone, without asking Lichess.
// - A run that created the tournament on Lichess but did not record it (it died, the answer was lost, the database
//   failed): before creating, every run looks on the Club's team for a tournament of the Matchday's name starting at the
//   Matchday's start, and records that one instead of creating another. Only the team's leaders can create tournaments
//   on it. Nothing is created unless that look succeeded.

import { matchdayOn, registerTournament } from "./matchdays";
import { createSwiss, teamSwissNamed, timeLimit, type Swiss } from "./lichess";
import { done, failed, runJob, skipped, type JobRun } from "./jobs";
import { organiserToken, refusedPermission } from "./organiser-lichess";
import { upcomingMatchday, type Matchday } from "./seasons";

export const JOB = "create-matchdays";
export const LEAD_DAYS = 6;
const DAY_MS = 86_400_000;

// Vercel runs the job every hour (vercel.json), but delivery is best effort and a refused run records nothing: a last
// run older than this means runs are not getting through.
export const OVERDUE_MS = 2 * 3_600_000;

// Lichess may take two minutes a request when it rate-limits; the run gives up after 240 s, within the route's
// maxDuration of 300 s, so that it can still record why.
export const JOB_DEADLINE_MS = 240_000;

// Named for the Club and the date; Lichess allows 2 to 30 letters, digits, spaces and common punctuation, without
// "Lichess". The name is also how a tournament created but not recorded is found again.
export const tournamentName = (date: string) => `Offboard Matchday ${date}`;

const DESCRIPTION = "Offboard's weekly Matchday: five Games of five minutes plus three seconds a move. Recaps at https://offboard.club";

// The Swiss form Lichess's POST /api/swiss/new/{teamId} takes, field by field. A team's tournament is open to the
// team's members only; Lichess picks the time between rounds itself, 30 seconds for 5+3.
export const matchdayTournament = ({ date, start }: Pick<Matchday, "date" | "start">): Record<string, string> => ({
  name: tournamentName(date),
  "clock.limit": "300", // seconds: five minutes each
  "clock.increment": "3", // seconds a move
  nbRounds: "5",
  startsAt: String(start.getTime()), // 20:00 Vilnius time, in milliseconds since the epoch
  rated: "true",
  // Lichess's no-show ban ("Play your games": no entry for someone who missed a Game in a recent Swiss). Only true
  // switches it on, and Lichess's own form starts with it on, so it is sent switched off.
  "conditions.playYourGames": "false",
  description: DESCRIPTION,
});

// One run of the job at `now`: what it did and why. Throws only if the database cannot record the run.
export const createUpcomingMatchday = (now: Date) => runJob(JOB, () => createIfDue(now));

async function createIfDue(now: Date): Promise<JobRun> {
  const next = await upcomingMatchday(now);
  if (!next) return skipped("No Matchday is scheduled, so there is nothing to create.");
  const { date, start } = next;
  if (start.getTime() - now.getTime() > LEAD_DAYS * DAY_MS)
    return skipped(`The next Matchday, ${date}, is more than ${LEAD_DAYS} days away; its tournament is created once it is ${LEAD_DAYS} days away.`, date);
  const known = (await matchdayOn(date))?.lichessTournamentId;
  if (known) return skipped(`The Matchday of ${date} already has its tournament, ${known}.`, date);

  const cannot = (why: string) => failed(`The Matchday of ${date} could not be created: ${sentence(why)}.`, date);
  const teamId = process.env.LICHESS_TEAM_ID;
  if (!teamId) return cannot("LICHESS_TEAM_ID is not set, so the Club's Lichess team is not known.");
  const permission = await organiserToken(now);
  if ("problem" in permission) return cannot(permission.problem);

  const deadline = timeLimit(JOB_DEADLINE_MS, `Lichess took more than ${JOB_DEADLINE_MS / 1000} s`);
  const signal = deadline.signal;
  let made: Swiss | null = null;
  try {
    const name = tournamentName(date);
    const earlier = await teamSwissNamed(teamId, name, signal);
    const found = earlier.find((swiss) => swiss.startsAt.getTime() === start.getTime());
    if (!found && earlier.length > 0)
      return cannot(`the Club's team already has a tournament named "${name}" that does not start at 20:00 Vilnius time that day, so none was created. Check it on Lichess.`);
    const swiss = found ?? (made = await createSwiss(permission.token, teamId, matchdayTournament(next), signal));
    if (!(await registerTournament(date, swiss.id)))
      return failed(
        `Tournament ${swiss.id} is on Lichess for the Matchday of ${date}, but was not recorded: that Matchday already has another tournament, or this one is another Matchday's.`,
        date,
      );
    return done(
      found
        ? `Recorded tournament ${swiss.id}, which an earlier run created on Lichess without recording it, as the Matchday of ${date}.`
        : `Created tournament ${swiss.id} on Lichess for the Matchday of ${date}.`,
      date,
    );
  } catch (error) {
    const why = sentence(refusedPermission(error, permission.lichessId) ?? (error instanceof Error ? error.message : "unknown error"));
    if (made) return failed(`Tournament ${made.id} was created on Lichess for the Matchday of ${date} but could not be recorded (${why}); the next run records it.`, date);
    return cannot(why);
  } finally {
    deadline.clear();
  }
}

// A reason without its closing full stop, to go inside a sentence.
const sentence = (why: string) => why.replace(/\.$/, "");
