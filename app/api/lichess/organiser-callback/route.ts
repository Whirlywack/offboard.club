import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  const organiser = await requireOrganiser();
  redirect(await finishOrganiserConnection(organiser, new URL(request.url).searchParams, pending));
}
