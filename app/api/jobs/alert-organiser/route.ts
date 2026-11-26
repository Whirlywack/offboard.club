import { alertOrganiser, alertWithoutDatabase } from "@/lib/alerts";
import { fromVercelCron } from "@/lib/cron";

// A run sends at most ten alerts of 10 s each (lib/telegram.ts) and holds the job for 15 minutes, so this must stay below.
export const maxDuration = 300;

// Vercel's Cron Job, every hour (vercel.json): sends the Organiser the private alerts that are due. Anyone else is
// refused before anything is read. Answers what the run did and why; 500 when it failed, so that the run shows as failed
// in Vercel's log as well as on the Organiser page.
export async function GET(request: Request) {
  if (!fromVercelCron(request)) return new Response("Unauthorized", { status: 401 });
  try {
    const run = await alertOrganiser(new Date());
    return Response.json(run, { status: run.outcome === "failed" ? 500 : 200 });
  } catch (error) {
    // The run could not even be recorded, which means the database could not be used: the Organiser is told directly.
    console.error("Alerting the Organiser failed:", error instanceof Error ? error.message : "unknown error");
    await alertWithoutDatabase(error);
    return Response.json({ outcome: "failed", detail: "The run could not be recorded." }, { status: 500 });
  }
}
