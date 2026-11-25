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
import { addDays, latestSunday, matchdayStart, ZONE } from "./schedule";

export const JOB = "collect-results";

// Lichess marks a tournament finished as the last Game ends, a moment before it has counted that Game into the
// standings, and waits 10 s itself before announcing the final ranking (lila, SwissApi.finishGame and doFinish). The
// standings are read no sooner.
export const SETTLE_MS = 10_000;

// One run of the job at `now`: what it did and why. Throws only if the database cannot record the run.
export const collectResults = (now: Date) => runJob(JOB, () => collect(now));

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
  if (!id) return skipped(`There's no tournament on Lichess for ${sunday}.`, date);
  const collected = skipped(`The Recap of ${sunday} is public.`, date);
  if (matchday.ingested) return collected;

  // The same words for the same cause, so that a failure that stands is recorded once (runJob). Runs look after this
  // Matchday until the next Sunday's starts (latestSunday), then leave it to `pnpm ingest`.
  const lastTry = moment(matchdayStart(addDays(date, 7)));
  const cannot = (why: string) =>
    failed(`Couldn't collect the results of ${sunday}: ${sentence(why)}. If it hasn't worked by ${lastTry}, run pnpm ingest ${id}.`, date);
  const deadline = timeLimit(JOB_DEADLINE_MS, `Lichess took more than ${JOB_DEADLINE_MS / 60_000} minutes`);
  try {
    const swiss = await getSwiss(id, deadline.signal);
    // lila deletes a Swiss tournament that has not had two players an hour after its start, and its creator can delete
    // one before it starts. Either way there is nothing to collect, or to ingest later.
    if (!swiss)
      return failed(
        `Lichess no longer has the tournament for ${sunday}, so there are no results. It deletes one an hour after the start if fewer than two players joined.`,
        date,
      );
    if (swiss.status !== "finished") return skipped(`The tournament for ${sunday} hasn't finished yet.`, date);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const ingestion = await ingestTournament(id, { signal: deadline.signal });
    if (ingestion.outcome === "unchanged") return collected; // by `pnpm ingest`, in the meantime
    if (ingestion.outcome === "refused") return cannot(ingestion.problem);
    return done(
      `Collected the results of ${sunday}: ${count(ingestion.members, "Member", "Members")} played ${count(ingestion.games, "Game", "Games")}. The Recap is public.`,
      date,
    );
  } catch (error) {
    return cannot(error instanceof Error ? error.message : "unknown error");
  } finally {
    deadline.clear();
  }
}
