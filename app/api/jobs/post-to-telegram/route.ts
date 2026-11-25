import { fromVercelCron } from "@/lib/cron";
import { postToTelegram } from "@/lib/post-to-telegram";

// A run sends at most ten posts of 10 s each (lib/telegram.ts) and holds the job for 15 minutes, so this must stay below.
export const maxDuration = 300;

// Vercel's Cron Job, on Sundays at the hours the reminders fall on and every hour (vercel.json): posts what is due to the
// Club's Telegram group. Anyone else is refused before anything is read. Answers what the run did and why; 500 when it
// failed, so that the run shows as failed in Vercel's log as well as on the Organiser page.
export async function GET(request: Request) {
  if (!fromVercelCron(request)) return new Response("Unauthorized", { status: 401 });
  try {
    const run = await postToTelegram(new Date());
    return Response.json(run, { status: run.outcome === "failed" ? 500 : 200 });
  } catch (error) {
    // The run could not even be recorded, which means the database could not be reached.
    console.error("Posting to Telegram failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ outcome: "failed", detail: "The run could not be recorded." }, { status: 500 });
  }
}
