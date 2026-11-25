import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  const started = Date.now();
  const jar = await cookies();
  const pending = jar.get(PENDING_COOKIE)?.value;
  // Single use: cleared before anything else, whatever happens next.
  jar.delete(clearedPendingCookie());
  const person = await requireWelcomed();
  const to = await finishConnection(person, new URL(request.url).searchParams, pending);
  // A Member who has switched accounts no longer has the one they had: it is removed from the Club's Lichess team after
  // they have been sent on, so that Lichess cannot keep them waiting or undo the switch. Nothing is removed if they did
  // not switch after all, since the account is still theirs.
  const before = person.lichessId;
  if (before) after(() => removeSwitchedFrom(before, REMOVED_BY_MS - (Date.now() - started)));
  redirect(to);
}
