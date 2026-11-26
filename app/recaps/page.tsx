import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import ui from "../ui.module.css";
import { longDate } from "./dates";
import styles from "./recaps.module.css";
import { recapDates } from "@/lib/recaps";
import { noticeLater } from "@/lib/request-failures";

export const metadata: Metadata = { title: "Recaps" };

export default function RecapsPage() {
  return (
    <main id="main" className={ui.page}>
      <h1>Recaps</h1>
      <p className={`${ui.lede} ${styles.underTitle}`}>
        Every Matchday gets a Recap with that night&apos;s Leaderboard and Awards. Newest first.
      </p>
      <Suspense>
        <RecapList />
      </Suspense>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}

// Newest first. Said plainly, and logged, if the database cannot be read.
async function RecapList() {
  await connection();
  const dates = await recapDates().catch((error: Error) => {
    console.error("The Recaps page could not read the Matchdays:", error.message);
    noticeLater(error, "/recaps");
    return null;
  });
  if (dates === null) return <p className={ui.alert}>The Recaps can&apos;t be shown right now. Please try again in a minute.</p>;
  if (dates.length === 0)
    return (
      <p className={`${styles.empty} ${ui.arrive}`}>
        No Recaps yet. The first one appears here after the first Matchday.
      </p>
    );
  return (
    <ul className={`${styles.list} ${ui.arrive}`} role="list">
      {dates.map((date) => (
        <li key={date}>
          <Link href={`/recaps/${date}`}>
            <time dateTime={date}>{longDate(date)}</time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
