import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { requireWelcomed } from "@/lib/auth";
import { CALLBACK_PATH, clearedPendingCookie, finishConnection, PENDING_COOKIE, REMOVED_BY_MS } from "@/lib/connect-lichess";
import { removeSwitchedFrom } from "@/lib/leaving";
import { noticeLater } from "@/lib/request-failures";

// Up to five Lichess requests, each of which may wait a minute after a rate-limit response. The connection gives up
// well before this (CONNECTION_DEADLINE_MS) so that there is still time to revoke the token, and then to remove the
// account a switch replaced (REMOVED_BY_MS).
export const maxDuration = 300;

// Where Lichess sends the person back after they approve (or decline) Offboard. The redirect URI registered with
// each authorization request is <BETTER_AUTH_URL>/api/lichess/callback.
export async function GET(request: Request) {
  // First, so that the token's revocation, and what is done after the person has been sent on, end within the
  // callback's 300 s however long reading the session takes.
  const started = Date.now();
  const removeBy = started + REMOVED_BY_MS;
  const jar = await cookies();
  const pending = jar.get(PENDING_COOKIE)?.value;
  // Single use: cleared before anything else, whatever happens next.
  jar.delete(clearedPendingCookie());
  // A session that cannot be read, as when the database cannot be reached, sends the person back to the connect step
  // saying it didn't work, not to an empty error. A Member who was switching accounts cannot be told apart then: the
  // connect step sends a Member home, so they are told nothing.
  const person = await requireWelcomed().catch((error: unknown) => {
    unstable_rethrow(error);
    console.error("Coming back from Lichess, the session could not be read:", error instanceof Error ? error.message : error);
    noticeLater(error, CALLBACK_PATH, "route");
    redirect("/welcome/lichess?lichess=failed");
  });
  const { to, replaced } = await finishConnection(person, new URL(request.url).searchParams, pending, started);
  // The account a switch replaced is removed from the Club's Lichess team after the person has been sent on, so that
  // Lichess cannot keep them waiting or undo the switch.
  if (replaced) after(() => removeSwitchedFrom(replaced, removeBy));
  redirect(to);
}
