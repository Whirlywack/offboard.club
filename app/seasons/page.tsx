import type { Metadata } from "next";
import { Suspense } from "react";
import { seasonLeaderboard } from "./season";

export const metadata: Metadata = { title: "Season Leaderboard" };

// The current Season's Leaderboard, which the site header and the home page link to: the latest Season with an
// ingested Matchday, until the next Season's first is ingested (lib/leaderboards.ts). Each Season also has an address
// of its own, /seasons/1 and on, which never changes.
export default function CurrentSeasonPage() {
  return (
    <main id="main">
      <Suspense>
        <CurrentSeason />
      </Suspense>
    </main>
  );
}

async function CurrentSeason() {
  return seasonLeaderboard("current");
}
