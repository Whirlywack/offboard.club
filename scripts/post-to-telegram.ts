// One run of the job that posts to the Club's Telegram group (lib/post-to-telegram.ts), here, against the local
// database and the fake Telegram, as if it were the time given: what Vercel's scheduled request does in production.
// `pnpm post-to-telegram [<time>]`, the time as an ISO instant with its offset (2026-11-29T10:00+02:00), now if left
// out, with `pnpm fake-telegram` running and the block from `pnpm db:start` in .env.local; the fake Telegram prints what
// is posted, and `pnpm seed` prints the times of the next Matchday's reminders. The run is recorded as Vercel's would
// be, so the Organiser page shows it. Refuses, before anything else, a database not on this machine and a TELEGRAM_URL
// that is not the fake Telegram's address on it; then, in its first statement, a database db:start did not make.
import { madeByDbStart, notLocal } from "./local-db.mjs";
import { db } from "@/lib/db";
import { postToTelegram } from "@/lib/post-to-telegram";
import { fakeTelegramUrl } from "@/lib/telegram";

const [time, ...rest] = process.argv.slice(2);
const at = time === undefined ? new Date() : new Date(/(Z|[+-]\d\d:\d\d)$/.test(time) ? time : NaN);
if (rest.length > 0 || Number.isNaN(at.getTime())) {
  console.error("Usage: pnpm post-to-telegram [<time>], the time as an ISO instant with its offset, such as 2026-11-29T10:00+02:00.");
  process.exit(1);
}
const why =
  notLocal(process.env.DATABASE_URL) ??
  (URL.parse(fakeTelegramUrl() ?? "")?.hostname === "127.0.0.1" ? null : "the site does not follow TELEGRAM_URL to http://127.0.0.1:<port>");
if (why) {
  console.error(`Refusing to post: ${why}. Put the block from pnpm db:start in .env.local.`);
  process.exit(1);
}

async function main(): Promise<number> {
  if (!(await madeByDbStart(db))) {
    console.error("Refusing: this database was not made by pnpm db:start, so posting leaves it alone.");
    return 1;
  }
  const run = await postToTelegram(at);
  console.log(`${run.outcome}, as of ${at.toISOString()}: ${run.detail}`);
  return run.outcome === "failed" ? 1 : 0;
}

main()
  .catch((error: Error) => {
    // The database could not be reached, or the run could not be recorded.
    console.error("Posting to Telegram stopped:", error.message);
    return 1;
  })
  .then(async (code) => {
    await db.end();
    process.exit(code);
  });
