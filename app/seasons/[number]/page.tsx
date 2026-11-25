import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ui from "../../ui.module.css";
import { seasonLeaderboard } from "../season";
import { isSeasonAddress } from "@/lib/schedule";

export async function generateMetadata({ params }: PageProps<"/seasons/[number]">): Promise<Metadata> {
  const { number } = await params;
  return { title: isSeasonAddress(number) ? `Season ${number} Leaderboard` : "Season Leaderboard" };
}

// A Season's Leaderboard at /seasons/N, an address that stays the same once the Season is over. Public, like every
// Leaderboard: names and Companies only. An address that cannot be a Season's never gets here: proxy.ts answers it with
// a 404. A Season the schedule does not have yet shows the not-found page, under a 200 as a Recap's does.
export default function SeasonPage({ params }: PageProps<"/seasons/[number]">) {
  return (
    <main id="main" className={ui.page}>
      <Suspense>
        <SeasonOf params={params} />
      </Suspense>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/all-time">All-time Leaderboard</Link>
        <Link href="/recaps">Recaps</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}

async function SeasonOf({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!isSeasonAddress(number)) notFound();
  return seasonLeaderboard(Number(number));
}
