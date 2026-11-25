import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ui from "../ui.module.css";
import { seasonLeaderboard } from "./season";

export const metadata: Metadata = { title: "Season Leaderboard" };

// The current Season's Leaderboard, which the site header and the home page link to: the latest Season with an
// ingested Matchday, until the next Season's first is ingested (lib/leaderboards.ts). Each Season also has an address
// of its own, /seasons/1 and on, which never changes.
export default function CurrentSeasonPage() {
  return (
    <main id="main" className={ui.page}>
      <Suspense>
        <CurrentSeason />
      </Suspense>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/all-time">All-time Leaderboard</Link>
        <Link href="/recaps">Recaps</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}

async function CurrentSeason() {
  return seasonLeaderboard("current");
}
