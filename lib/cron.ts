// Whether a request is Vercel's scheduled request. Vercel sends the project's CRON_SECRET as "Authorization: Bearer
// <CRON_SECRET>" with every Cron Job (and every path Schedule) it runs: vercel.com/docs/cron-jobs/manage-cron-jobs,
// "Securing cron jobs". Vercel recommends at least 16 characters; with a shorter secret, or none, nothing is accepted.

import { createHash, timingSafeEqual } from "node:crypto";

export const CRON_SECRET_MIN = 16;

// Why the scheduled jobs are refused every time, as a sentence that does not reveal the secret; null if they are not.
export function cronSecretProblem(): string | null {
  const secret = process.env.CRON_SECRET;
  const so = "so the site refuses every scheduled run.";
  if (!secret) return `CRON_SECRET isn't set, ${so}`;
  if (secret.length < CRON_SECRET_MIN) return `CRON_SECRET is shorter than ${CRON_SECRET_MIN} characters, ${so}`;
  return null;
}

const digest = (text: string) => createHash("sha256").update(text).digest();

export function fromVercelCron(request: Request): boolean {
  if (cronSecretProblem()) return false;
  // Compared as digests, so that neither the secret's length nor its characters show in the time taken.
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${process.env.CRON_SECRET}`));
}
