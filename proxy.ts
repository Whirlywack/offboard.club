import { NextResponse, type NextRequest } from "next/server";
import { isRecapDate } from "@/lib/schedule";

// A Recap address that cannot be a Matchday's date, such as /recaps/abc or /recaps/2026-02-30, is answered here with a
// real 404. The page itself cannot: with Partial Prefetching, Next.js sends a dynamic route's App Shell, and with it a
// 200, before the page reads its date. This check needs no data, which is all Proxy should do (Next.js: Proxy is not
// for fetching data), so a well-formed Sunday with no ingested Matchday is left to the page: it shows the not-found
// page with noindex, under a 200.
export function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.split("/")[2] ?? "";
  let date: string;
  try {
    date = decodeURIComponent(segment);
  } catch {
    date = "";
  }
  if (!isRecapDate(date)) return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
}

export const config = { matcher: "/recaps/:date" };
