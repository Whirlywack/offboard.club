import { backUp } from "@/lib/backup";
import { fromVercelCron } from "@/lib/cron";

// The run stops waiting for the dump and the store 240 s (JOB_DEADLINE_MS) after its first line, with time left to record
// why, and holds the job for 15 minutes, so this must stay between the two.
export const maxDuration = 300;

// Vercel's Cron Job, every night (vercel.json): dumps the database to the private Blob store. Anyone else is refused
// before anything is read. Answers what the run did and why, never any of the dump; 500 when it failed, so that the run
// shows as failed in Vercel's log as well as on the Organiser page.
export async function GET(request: Request) {
  if (!fromVercelCron(request)) return new Response("Unauthorized", { status: 401 });
  try {
    const run = await backUp(new Date());
    return Response.json(run, { status: run.outcome === "failed" ? 500 : 200 });
  } catch (error) {
    // The run could not even be recorded, which means the database could not be reached.
    console.error("Backing up failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ outcome: "failed", detail: "The run could not be recorded." }, { status: 500 });
  }
}
