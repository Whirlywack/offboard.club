import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isRecapDate, isSeasonAddress } from "@/lib/schedule";

// Real 404s for what can be told without reading any data, which is all Proxy should do (Next.js: Proxy is not for
// fetching data). The pages themselves cannot: with Partial Prefetching, Next.js sends a dynamic route's App Shell, and
// with it a 200, before the page reads anything.
//
// - A Recap address that cannot be a Matchday's date, such as /recaps/abc or /recaps/2026-02-30. A well-formed Sunday
//   with no ingested Matchday is left to the page: it shows the not-found page with noindex, under a 200.
// - A Season Leaderboard's address that cannot be a Season: /seasons/1 to /seasons/200 go to the page, and anything
//   else, such as /seasons/0, /seasons/01 or /seasons/201, gets the 404.
// - The Organiser page for a visitor with no session cookie at all. Whether a session is the Organiser's needs the
//   database, so a signed-in Member who is not the Organiser is left to the page, which shows them the not-found page
//   with noindex, under a 200.
export function proxy(request: NextRequest) {
  const notFound = () => NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  const [, section, segment = ""] = request.nextUrl.pathname.split("/");
  if (section === "organiser") return getSessionCookie(request) ? undefined : notFound();
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    value = "";
  }
  const possible = section === "seasons" ? isSeasonAddress(value) : isRecapDate(value);
  if (!possible) return notFound();
}

export const config = { matcher: ["/recaps/:date", "/seasons/:number", "/organiser"] };
