// The scheduled job that collects each Matchday's results (#12), run by Vercel every five minutes on Sunday evenings and
// every hour otherwise (vercel.json, app/api/jobs/collect-results). It looks after the latest Sunday whose 20:00 has
// come, from then until the next Sunday's: once that Matchday's tournament has finished on Lichess, it ingests it
// (ingestTournament), which publishes its Recap. A tournament still being played is left for a later run. A run that
// could not collect it records why (runJob), and the next run tries again; one Matchday is looked after for a week,
// after which `pnpm ingest` is the way in.
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

import { done, failed, JOB_DEADLINE_MS, runJob, sentence, skipped, type JobRun } from "./jobs";
import { getSwiss, timeLimit } from "./lichess";
import { ingestTournament, matchdayOn } from "./matchdays";
import { latestSunday } from "./schedule";

export const JOB = "collect-results";

// Lichess marks a tournament finished as the last Game ends, a moment before it has counted that Game into the
// standings, and waits 10 s itself before announcing the final ranking (lila, SwissApi.finishGame and doFinish). The
// standings are read no sooner.
export const SETTLE_MS = 10_000;

// One run of the job at `now`: what it did and why. Throws only if the database cannot record the run.
export const collectResults = (now: Date) => runJob(JOB, () => collect(now));

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function collect(now: Date): Promise<JobRun> {
  const date = latestSunday(now);
  const matchday = await matchdayOn(date);
  const id = matchday?.lichessTournamentId;
  if (!id) return skipped(`Sunday ${date} has no tournament on Lichess, so there are no results to collect.`, date);
  const collected = skipped(`The results of the Matchday of ${date} are in, and its Recap is public.`, date);
  if (matchday.ingested) return collected;

  const cannot = (why: string) => failed(`The results of the Matchday of ${date} could not be collected: ${sentence(why)}.`, date);
  const deadline = timeLimit(JOB_DEADLINE_MS, `Lichess took more than ${JOB_DEADLINE_MS / 1000} s`);
  try {
    const swiss = await getSwiss(id, deadline.signal);
    // lila deletes a Swiss tournament that has not had two players an hour after its start, and its creator can delete
    // one before it starts.
    if (!swiss)
      return cannot(`Lichess has no tournament ${id}. Lichess deletes a tournament that fewer than two players joined an hour after its start`);
    if (swiss.status !== "finished")
      return skipped(`Tournament ${id}, the Matchday of ${date}, has not finished on Lichess yet; its results are collected once it has.`, date);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const ingestion = await ingestTournament(id, { signal: deadline.signal });
    if (ingestion.outcome === "unchanged") return collected; // by `pnpm ingest`, in the meantime
    if (ingestion.outcome === "refused") return cannot(ingestion.problem);
    return done(
      `Collected the results of the Matchday of ${date}: ${count(ingestion.members, "Member", "Members")} played, with ${count(ingestion.games, "Game", "Games")} between them. Its Recap is public.`,
      date,
    );
  } catch (error) {
    return cannot(error instanceof Error ? error.message : "unknown error");
  } finally {
    deadline.clear();
  }
}
