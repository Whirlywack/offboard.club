import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { recapDates } from "@/lib/recaps";
import { longDate } from "./dates";

export const metadata: Metadata = { title: "Recaps" };

export default function RecapsPage() {
  return (
    <main>
      <h1>Recaps</h1>
      <p>After each Matchday, its Recap shows that night&apos;s Leaderboard.</p>
      <Suspense>
        <RecapList />
      </Suspense>
      <p>
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}

// Newest first. Said plainly, and logged, if the database cannot be read.
async function RecapList() {
  await connection();
  const dates = await recapDates().catch((error: Error) => {
    console.error("The Recaps page could not read the Matchdays:", error.message);
    return null;
  });
  if (dates === null) return <p>The Recaps cannot be shown just now. Please try again later.</p>;
  if (dates.length === 0) return <p>There are no Recaps yet: the first comes after the first Matchday.</p>;
  return (
    <ul>
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
