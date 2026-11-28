// The scheduled job that collects each Matchday's results (#12), run by Vercel every five minutes on Sunday evenings and
// every hour otherwise (vercel.json, app/api/jobs/collect-results). It looks after the latest Sunday whose 20:00 has
// come, from then until the next Sunday's: once that Matchday's tournament has finished on Lichess, it ingests it
// (ingestTournament), which publishes its Recap, then posts the Recap to the Telegram group (lib/post-to-telegram.ts).
// A tournament still being played is left for a later run. A run that
// could not collect it records why (runJob), and the next run tries again; one Matchday is looked after for a week,
// after which `pnpm ingest` is the way in, and the Organiser page keeps it in sight for a few weeks more (uncollected).
//
// The schedule is in UTC: a Matchday starts at 17:00 UTC in summer time and 18:00 in winter time and is over within
// about two hours, so runs every five minutes from 17:00 to 23:55 UTC on Sunday put its Recap out within minutes of
// the last Game. The hourly run, which retries what failed, shares its minute with Creating Matchdays', so that the two
// wake the database together.
//
// Ingested once: a run that finds the Matchday ingested asks Lichess nothing; of runs at the same moment, only the one
// holding the job works (runJob); and ingestion itself stores a Matchday once.
//
// Outside production the client may follow LICHESS_URL to a fake Lichess, whose made-up results ingestion would store
// as a real Matchday. So the endpoint refuses to run while it does, and `pnpm collect-results`, the way to run this
// locally, refuses any database not on this machine.

import { db } from "./db";
import { done, failed, JOB_DEADLINE_MS, runJob, sentence, skipped, type JobRun } from "./jobs";
import { getSwiss, timeLimit } from "./lichess";
import { ingestTournament, matchdayOn } from "./matchdays";
import { postRecap } from "./post-to-telegram";
import { addDays, latestSunday, matchdayStart, ZONE } from "./schedule";

export const JOB = "collect-results";

// Lichess marks a tournament finished as the last Game ends, a moment before it has counted that Game into the
// standings, and waits 10 s itself before announcing the final ranking (lila, SwissApi.finishGame and doFinish). The
// standings are read no sooner.
export const SETTLE_MS = 10_000;

// One run of the job at `now`: what it did and why. Throws only if the database cannot record the run.
export const collectResults = (now: Date) => runJob(JOB, () => collect(now));

// When runs stop looking after the Matchday of `date`: as the next Sunday's starts.
export const lastTryAt = (date: string) => matchdayStart(addDays(date, 7));

// How far back the Organiser page lists Matchdays played whose results are not in: eight Sundays, the latest included,
// as long as a Season with its week off and a skipped Sunday. Long enough to be seen on an occasional visit, and a
// tournament Lichess deleted drops off by itself.
export const UNCOLLECTED_WEEKS = 8;

export type Uncollected = { date: string; lichessTournamentId: string };

// The Matchdays of the last UNCOLLECTED_WEEKS Sundays that have started, have their tournament recorded and have no
// results, latest first: the one runs still look after, then those they have left to `pnpm ingest`.
export async function uncollected(now: Date): Promise<Uncollected[]> {
  const latest = latestSunday(now);
  const { rows } = await db.query<Uncollected>(
    `select to_char("date", 'YYYY-MM-DD') as "date", "lichessTournamentId" from "matchday"
     where "ingestedAt" is null and "lichessTournamentId" is not null and "date" between $1 and $2
     order by "date" desc`,
    [addDays(latest, -7 * (UNCOLLECTED_WEEKS - 1)), latest],
  );
  return rows;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Dates as the Organiser page writes them, a Matchday as "Sunday 29 November" and an instant as "Sunday 6 December at
// 20:00", each kept on one line as the Season page keeps its dates.
const whole = (text: string) => text.replaceAll(" ", " ");
const day = (date: string) =>
  whole(new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }));
const moment = (at: Date) =>
  whole(at.toLocaleString("en-GB", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }));

async function collect(now: Date): Promise<JobRun> {
  const date = latestSunday(now);
  const sunday = day(date);
  const matchday = await matchdayOn(date);
  const id = matchday?.lichessTournamentId;
  // A skipped Sunday, a Sunday before Season 1 or between two Seasons, or one whose tournament was never created.
  if (!id) return skipped(`No Matchday on ${sunday}.`, date);
  const collected = skipped(`The Recap of ${sunday} is public.`, date);
  if (matchday.ingested) return collected;

  // The same words for the same cause, so that a failure that stands is recorded once (runJob). A refusal would be
  // refused by `pnpm ingest` in the same way, so only a failure that may pass is told what to do if it does not: runs
  // look after this Matchday until the next Sunday's starts (latestSunday), then leave it to `pnpm ingest`.
  const refusal = (why: string) => failed(`Couldn't collect the results of ${sunday}: ${sentence(why)}.`, date);
  const lastTry = moment(lastTryAt(date));
  const cannot = (why: string) =>
    failed(
      `Couldn't collect the results of ${sunday}: ${sentence(why)}. The site keeps trying until ${lastTry}. If it hasn't worked by then, run pnpm ingest ${id}.`,
      date,
    );
  const deadline = timeLimit(JOB_DEADLINE_MS, `Lichess took more than ${JOB_DEADLINE_MS / 60_000} minutes`);
  try {
    const swiss = await getSwiss(id, deadline.signal);
    // lila deletes a Swiss tournament that has not had two players an hour after its start, and its creator can delete
    // one before it starts. Either way there is nothing to collect, now or later, and nothing for the Organiser to do.
    if (!swiss) return skipped(`Lichess deleted the tournament for ${sunday}, so it has no results.`, date);
    if (swiss.status !== "finished") return skipped(`The tournament for ${sunday} hasn't finished yet.`, date);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const ingestion = await ingestTournament(id, { signal: deadline.signal });
    if (ingestion.outcome === "unchanged") return collected; // by `pnpm ingest`, in the meantime
    if (ingestion.outcome === "refused") return refusal(ingestion.problem);
    // To the Telegram group; how that went is Posting to Telegram's to report, which tries again what failed.
    await postRecap(date, now);
    return done(
      `Collected the results of ${sunday}: ${count(ingestion.members, "Member", "Members")} played ${count(ingestion.games, "Game", "Games")}. The Recap is public.` +
        (ingestion.withoutMoves ? ` The moves of ${count(ingestion.withoutMoves, "Game", "Games")} were not kept.` : ""),
      date,
    );
  } catch (error) {
    return cannot(error instanceof Error ? error.message : "unknown error");
  } finally {
    deadline.clear();
  }
}
