import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireOrganiser } from "@/lib/auth";
import { clearedPendingCookie } from "@/lib/connect-lichess";
import { finishOrganiserConnection, ORGANISER_FLOW } from "@/lib/organiser-lichess";

// Up to five Lichess requests, each of which may wait a minute after a rate-limit response; the connection gives up
// well before this so that there is still time to revoke a token it does not keep.
export const maxDuration = 300;

// Where Lichess sends the Organiser back after they approve (or decline) Offboard's Organiser permission: the redirect
// URI of each such request is <BETTER_AUTH_URL>/api/lichess/organiser-callback. Anyone but the Organiser is not found.
export async function GET(request: Request) {
  const jar = await cookies();
  const pending = jar.get(ORGANISER_FLOW.cookie)?.value;
  // Single use: cleared before anything else, whatever happens next.
  jar.delete(clearedPendingCookie(ORGANISER_FLOW));
  // A session that cannot be read, as when the database cannot be reached, sends the Organiser back saying it didn't
  // work, not to an empty error.
  const organiser = await requireOrganiser().catch((error: unknown) => {
    unstable_rethrow(error);
    console.error("Coming back from Lichess, the session could not be read:", error instanceof Error ? error.message : error);
    redirect("/organiser?lichess=failed");
  });
  redirect(await finishOrganiserConnection(organiser, new URL(request.url).searchParams, pending));
}
