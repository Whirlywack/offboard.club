import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { requireWelcomed } from "@/lib/auth";
import { clearedPendingCookie, finishConnection, PENDING_COOKIE, REMOVED_BY_MS } from "@/lib/connect-lichess";
import { removeSwitchedFrom } from "@/lib/leaving";

// Up to five Lichess requests, each of which may wait a minute after a rate-limit response. The connection gives up
// well before this (CONNECTION_DEADLINE_MS) so that there is still time to revoke the token, and then to remove the
// account a switch replaced (REMOVED_BY_MS).
export const maxDuration = 300;

// Where Lichess sends the person back after they approve (or decline) Offboard. The redirect URI registered with
// each authorization request is <BETTER_AUTH_URL>/api/lichess/callback.
export async function GET(request: Request) {
  // First, so that what is done after the person has been sent on ends within the callback's 300 s.
  const removeBy = Date.now() + REMOVED_BY_MS;
  const jar = await cookies();
  const pending = jar.get(PENDING_COOKIE)?.value;
  // Single use: cleared before anything else, whatever happens next.
  jar.delete(clearedPendingCookie());
  // A session that cannot be read, as when the database cannot be reached, sends the person back to the connect step
  // saying it didn't work, not to an empty error.
  const person = await requireWelcomed().catch((error: unknown) => {
    unstable_rethrow(error);
    console.error("Coming back from Lichess, the session could not be read:", error instanceof Error ? error.message : error);
    redirect("/welcome/lichess?lichess=failed");
  });
  const { to, replaced } = await finishConnection(person, new URL(request.url).searchParams, pending);
  // The account a switch replaced is removed from the Club's Lichess team after the person has been sent on, so that
  // Lichess cannot keep them waiting or undo the switch.
  if (replaced) after(() => removeSwitchedFrom(replaced, removeBy));
  redirect(to);
}
