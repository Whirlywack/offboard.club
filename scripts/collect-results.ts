// One run of the job that collects the latest Matchday's results (lib/collect-results.ts), here, against the fake
// Lichess and the local database: what Vercel's scheduled request does in production, which the site's own endpoint
// refuses while it follows a fake Lichess. `pnpm collect-results`, with `pnpm fake-lichess` running and the block from
// `pnpm db:start` in .env.local; `pnpm seed season-over` leaves a finished Matchday on the fake Lichess to collect. The
// run is recorded as Vercel's would be, so the Organiser page shows it. Refuses, before anything else, a database not on
// this machine and a LICHESS_URL that is not the fake Lichess's address on it.
import { notLocal } from "./local-db.mjs";
import { collectResults } from "@/lib/collect-results";
import { db } from "@/lib/db";
import { fakeLichessUrl } from "@/lib/lichess";

if (process.argv.length > 2) {
  console.error("Usage: pnpm collect-results, with no arguments.");
  process.exit(1);
}
const why =
  notLocal(process.env.DATABASE_URL) ??
  (URL.parse(fakeLichessUrl() ?? "")?.hostname === "127.0.0.1" ? null : "the site does not follow LICHESS_URL to http://127.0.0.1:<port>");
if (why) {
  console.error(`Refusing to collect results: ${why}. Put the block from pnpm db:start in .env.local.`);
  process.exit(1);
}

collectResults(new Date())
  .then(
    (run) => {
      console.log(`${run.outcome}: ${run.detail}`);
      return run.outcome === "failed" ? 1 : 0;
    },
    (error: Error) => {
      console.error("The run could not be recorded:", error.message);
      return 1;
    },
  )
  .then(async (code) => {
    await db.end();
    process.exit(code);
  });
