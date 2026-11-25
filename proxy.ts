import { NextResponse, type NextRequest } from "next/server";
import { isRecapDate, isSeasonAddress } from "@/lib/schedule";

// A Recap address that cannot be a Matchday's date, such as /recaps/abc or /recaps/2026-02-30, is answered here with a
// real 404. The page itself cannot: with Partial Prefetching, Next.js sends a dynamic route's App Shell, and with it a
// 200, before the page reads its date. This check needs no data, which is all Proxy should do (Next.js: Proxy is not
// for fetching data), so a well-formed Sunday with no ingested Matchday is left to the page: it shows the not-found
// page with noindex, under a 200. A Season Leaderboard's address is answered the same way: /seasons/1 to /seasons/200
// go to the page, and anything else, such as /seasons/0, /seasons/01 or /seasons/201, gets the 404.
export function proxy(request: NextRequest) {
  const [, section, segment = ""] = request.nextUrl.pathname.split("/");
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    value = "";
  }
  const possible = section === "seasons" ? isSeasonAddress(value) : isRecapDate(value);
  if (!possible) return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
}

export const config = { matcher: ["/recaps/:date", "/seasons/:number"] };
