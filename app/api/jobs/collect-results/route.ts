import { collectResults } from "@/lib/collect-results";
import { fromVercelCron } from "@/lib/cron";
import { fakeLichessUrl } from "@/lib/lichess";

// The run gives up on Lichess, and starts no post to Telegram, 240 s (JOB_DEADLINE_MS) after its first line, and holds
// the job for 15 minutes, so this must stay between the two.
export const maxDuration = 300;

// Vercel's Cron Job, every five minutes on Sunday evenings and every hour otherwise (vercel.json): collects the latest
// Matchday's results once its tournament has finished, which publishes its Recap. Anyone else is refused before anything
// is read. Answers what the run did and why; 500 when it failed, so that the run shows as failed in Vercel's log as well
// as on the Organiser page.
export async function GET(request: Request) {
  if (!fromVercelCron(request)) return new Response("Unauthorized", { status: 401 });
  // Outside production the client may follow LICHESS_URL to a fake Lichess, whose made-up results would become a real
  // Matchday in whatever database this is. `pnpm collect-results` runs the job against a local one.
  if (fakeLichessUrl())
    return Response.json(
      { outcome: "failed", detail: "The site follows LICHESS_URL to a fake Lichess, so it collects no results here. Locally, run pnpm collect-results." },
      { status: 500 },
    );
  try {
    const run = await collectResults(new Date());
    return Response.json(run, { status: run.outcome === "failed" ? 500 : 200 });
  } catch (error) {
    // The run could not even be recorded, which means the database could not be reached.
    console.error("Collecting results failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ outcome: "failed", detail: "The run could not be recorded." }, { status: 500 });
  }
}
