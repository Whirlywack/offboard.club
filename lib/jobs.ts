// The bookkeeping every scheduled job shares (migrations/007_organiser.sql): one run at a time, each run's outcome and
// why, and every failure, kept where the Organiser page (#16) and the failure alerts (#17) read them.

import { randomUUID } from "node:crypto";
import { db } from "./db";

export type Outcome = "done" | "skipped" | "failed";

// What a run did and why, as a sentence for the Organiser, and the Matchday it concerned, if any.
export type JobRun = { outcome: Outcome; detail: string; matchdayDate: string | null };

export const done = (detail: string, matchdayDate: string | null = null): JobRun => ({ outcome: "done", detail, matchdayDate });
export const skipped = (detail: string, matchdayDate: string | null = null): JobRun => ({ outcome: "skipped", detail, matchdayDate });
export const failed = (detail: string, matchdayDate: string | null = null): JobRun => ({ outcome: "failed", detail, matchdayDate });

// Runs `work` as `job` unless another run of it is still working, then records how it went, and the failure if it
// failed. A run holds the job for 15 minutes, longer than any run lasts (its route's maxDuration is 300 s), so of runs
// started together only one works; a run that dies lets go when its hold lapses. A database failure while recording
// throws, after the run's own work.
export async function runJob(job: string, work: () => Promise<JobRun>): Promise<JobRun> {
  const hold = randomUUID();
  const { rowCount } = await db.query(
    `insert into "scheduledJob" ("job", "lockedBy", "lockedUntil") values ($1, $2, now() + interval '15 minutes')
     on conflict ("job") do update set "lockedBy" = excluded."lockedBy", "lockedUntil" = excluded."lockedUntil"
     where "scheduledJob"."lockedUntil" is null or "scheduledJob"."lockedUntil" <= now()`,
    [job, hold],
  );
  if (rowCount !== 1) return skipped("Another run of this job is still working, so this one did nothing.");

  let run: JobRun;
  try {
    run = await work();
  } catch (error) {
    run = failed(`The job stopped: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
  if (run.outcome === "failed")
    await db.query(`insert into "jobFailure" ("job", "matchdayDate", "problem") values ($1, $2, $3)`, [job, run.matchdayDate, run.detail]);
  // Only while this run still holds the job: one whose hold lapsed leaves the next run's alone.
  await db.query(
    `update "scheduledJob" set "lastRunAt" = now(), "lastOutcome" = $3, "lastDetail" = $4, "lockedBy" = null, "lockedUntil" = null
     where "job" = $1 and "lockedBy" = $2`,
    [job, hold, run.outcome, run.detail],
  );
  return run;
}

export type Failure = { job: string; at: Date; matchdayDate: string | null; problem: string };

// The most recent failure of any scheduled job, or null if none has failed.
export async function lastFailure(): Promise<Failure | null> {
  const { rows } = await db.query<Failure>(
    `select "job", "at", to_char("matchdayDate", 'YYYY-MM-DD') as "matchdayDate", "problem" from "jobFailure" order by "at" desc, "id" desc limit 1`,
  );
  return rows[0] ?? null;
}
