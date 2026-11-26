import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { MoreLinks } from "../leaderboard";
import ui from "../ui.module.css";
import { longDate } from "./dates";
import styles from "./recaps.module.css";
import { recapDates } from "@/lib/recaps";
import { noticeLater } from "@/lib/request-failures";

export const metadata: Metadata = { title: "Recaps" };

export default function RecapsPage() {
  return (
    <main id="main" className={styles.index}>
      <div className={styles.indexHead}>
        <h1 className={`${styles.indexTitle} ${ui.display}`}>
          <em>Recaps</em>
        </h1>
        <p className={styles.indexLede}>Each Matchday&apos;s Leaderboard and Awards.</p>
      </div>
      <Suspense>
        <RecapList />
      </Suspense>
      <MoreLinks links={[["/", "Home"]]} />
    </main>
  );
}

// Newest first, one Sunday to a ruled row (ui.ruled). Said plainly, and logged, if the database cannot be read.
async function RecapList() {
  await connection();
  const dates = await recapDates().catch((error: Error) => {
    console.error("The Recaps page could not read the Matchdays:", error.message);
    noticeLater(error, "/recaps");
    return null;
  });
  if (dates === null)
    return <p className={`${ui.alert} ${styles.unread}`}>The Recaps can&apos;t be shown right now. Please try again in a minute.</p>;
  if (dates.length === 0) return <p className={`${styles.none} ${ui.display}`}>No Recaps yet.</p>;
  return (
    <ul className={`${ui.ruled} ${styles.dates}`} role="list">
      {dates.map((date) => (
        <li key={date}>
          <Link href={`/recaps/${date}`}>
            <span>
              <time dateTime={date}>{longDate(date)}</time>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M3 12h17M14 6l6 6-6 6" />
            </svg>
          </Link>
        </li>
      ))}
    </ul>
  );
}
