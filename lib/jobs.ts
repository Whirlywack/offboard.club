// The bookkeeping every scheduled job shares (migrations/007_organiser.sql, 011): one run at a time, each run's outcome
// and why, when it last did its work, and its failures, kept where the Organiser page (#16) and the private alerts to
// the Organiser (#17, lib/alerts.ts) read them.

import { randomUUID } from "node:crypto";
import { db } from "./db";

export type Outcome = "done" | "skipped" | "failed";

// What a run did and why, as a sentence for the Organiser, and the Matchday it concerned, if any.
export type JobRun = { outcome: Outcome; detail: string; matchdayDate: string | null };

// Vercel runs every job at least once an hour (vercel.json), but delivery is best effort and a refused run records
// nothing: a last run older than this means runs are not getting through.
export const OVERDUE_MS = 2 * 3_600_000;

// Lichess may take two minutes a request when it rate-limits; a run gives up on it after 240 s, within its route's
// maxDuration of 300 s, so that it can still record why.
export const JOB_DEADLINE_MS = 240_000;

// A reason without its closing full stop, to go inside a sentence.
export const sentence = (why: string) => why.replace(/\.$/, "");

export const done = (detail: string, matchdayDate: string | null = null): JobRun => ({ outcome: "done", detail, matchdayDate });
export const skipped = (detail: string, matchdayDate: string | null = null): JobRun => ({ outcome: "skipped", detail, matchdayDate });
export const failed = (detail: string, matchdayDate: string | null = null): JobRun => ({ outcome: "failed", detail, matchdayDate });

type Previous = { lastOutcome: Outcome | null; lastDetail: string | null };

// Runs `work` as `job` unless another run of it is still working, then records how it went. A run holds the job for
// 15 minutes, longer than any run lasts (its route's maxDuration is 300 s), so of runs started together only one works;
// a run that dies lets go when its hold lapses. A failure is recorded in "jobFailure" when it begins: when the previous
// run did not fail, or failed for another reason. A problem that stands for days is one failure, not one an hour. A
// database failure while recording throws, after the run's own work.
export async function runJob(job: string, work: () => Promise<JobRun>): Promise<JobRun> {
  const hold = randomUUID();
  const { rows } = await db.query<Previous>(
    `insert into "scheduledJob" ("job", "lockedBy", "lockedUntil") values ($1, $2, now() + interval '15 minutes')
     on conflict ("job") do update set "lockedBy" = excluded."lockedBy", "lockedUntil" = excluded."lockedUntil"
     where "scheduledJob"."lockedUntil" is null or "scheduledJob"."lockedUntil" <= now()
     returning "lastOutcome", "lastDetail"`,
    [job, hold],
  );
  const previous = rows[0];
  if (!previous) return skipped("Another run was already working on it.");

  let run: JobRun;
  try {
    run = await work();
  } catch (error) {
    run = failed(`The job stopped: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
  if (run.outcome === "failed" && !(previous.lastOutcome === "failed" && previous.lastDetail === run.detail))
    await db.query(`insert into "jobFailure" ("job", "matchdayDate", "problem") values ($1, $2, $3)`, [job, run.matchdayDate, run.detail]);
  // Only while this run still holds the job: one whose hold lapsed leaves the next run's alone.
  await db.query(
    `update "scheduledJob" set "lastRunAt" = now(), "lastOutcome" = $3, "lastDetail" = $4,
       "lastDoneAt" = case when $3 = 'done' then now() else "lastDoneAt" end, "lockedBy" = null, "lockedUntil" = null
     where "job" = $1 and "lockedBy" = $2`,
    [job, hold, run.outcome, run.detail],
  );
  return run;
}

export type LastRun = { at: Date; outcome: Outcome; detail: string };

// When the job last finished a run, and how; null if it never has.
export async function lastRun(job: string): Promise<LastRun | null> {
  const { rows } = await db.query<LastRun>(
    `select "lastRunAt" as "at", "lastOutcome" as "outcome", "lastDetail" as "detail" from "scheduledJob" where "job" = $1 and "lastRunAt" is not null`,
    [job],
  );
  return rows[0] ?? null;
}

// When the job last did its work, or, if it never has, when it first ran; null if it has never run.
export async function doneSince(job: string): Promise<Date | null> {
  const { rows } = await db.query<{ lastDoneAt: Date }>(`select "lastDoneAt" from "scheduledJob" where "job" = $1`, [job]);
  return rows[0]?.lastDoneAt ?? null;
}

// The jobs whose last run failed, each with why.
export async function failingJobs(): Promise<{ job: string; detail: string }[]> {
  const { rows } = await db.query<{ job: string; detail: string }>(
    `select "job", "lastDetail" as "detail" from "scheduledJob" where "lastOutcome" = 'failed'`,
  );
  return rows;
}

export type Failure = { job: string; at: Date; matchdayDate: string | null; problem: string };

// The most recent failure of any scheduled job, as of when it began; null if none has failed.
export async function lastFailure(): Promise<Failure | null> {
  const { rows } = await db.query<Failure>(
    `select "job", "at", to_char("matchdayDate", 'YYYY-MM-DD') as "matchdayDate", "problem" from "jobFailure" order by "at" desc, "id" desc limit 1`,
  );
  return rows[0] ?? null;
}
