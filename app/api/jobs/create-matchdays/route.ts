import { fromVercelCron } from "@/lib/cron";
import { createUpcomingMatchday } from "@/lib/create-matchdays";

// The run gives up on Lichess after 240 s (JOB_DEADLINE_MS) and holds the job for 15 minutes, so this must stay below.
export const maxDuration = 300;

// Vercel's Cron Job, every hour (vercel.json): creates the upcoming Matchday's tournament on Lichess once it is due.
// Anyone else is refused before anything is read. Answers what the run did and why; 500 when it failed, so that the
// run shows as failed in Vercel's log as well as on the Organiser page.
export async function GET(request: Request) {
  if (!fromVercelCron(request)) return new Response("Unauthorized", { status: 401 });
  try {
    const run = await createUpcomingMatchday(new Date());
    return Response.json(run, { status: run.outcome === "failed" ? 500 : 200 });
  } catch (error) {
    // The run could not even be recorded, which means the database could not be reached.
    console.error("Creating Matchdays failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ outcome: "failed", detail: "The run could not be recorded." }, { status: 500 });
  }
}
