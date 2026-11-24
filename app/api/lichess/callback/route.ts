import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireWelcomed } from "@/lib/auth";
import { clearedPendingCookie, finishConnection, PENDING_COOKIE } from "@/lib/connect-lichess";

// Up to five Lichess requests, each of which may wait a minute after a rate-limit response. The connection gives up
// well before this (CONNECTION_DEADLINE_MS) so that there is still time to revoke the token.
export const maxDuration = 300;

// Where Lichess sends the person back after they approve (or decline) Offboard. The redirect URI registered with
// each authorization request is <BETTER_AUTH_URL>/api/lichess/callback.
export async function GET(request: Request) {
  const jar = await cookies();
  const pending = jar.get(PENDING_COOKIE)?.value;
  // Single use: cleared before anything else, whatever happens next.
  jar.delete(clearedPendingCookie());
  const person = await requireWelcomed();
  redirect(await finishConnection(person, new URL(request.url).searchParams, pending));
}
