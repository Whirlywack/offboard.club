// Whether a request is Vercel's scheduled request. Vercel sends the project's CRON_SECRET as "Authorization: Bearer
// <CRON_SECRET>" with every Cron Job (and every path Schedule) it runs: vercel.com/docs/cron-jobs/manage-cron-jobs,
// "Securing cron jobs". Without a secret of at least 16 characters, as Vercel recommends, nothing is accepted.

import { createHash, timingSafeEqual } from "node:crypto";

const digest = (text: string) => createHash("sha256").update(text).digest();

export function fromVercelCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  // Compared as digests, so that neither the secret's length nor its characters show in the time taken.
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}
