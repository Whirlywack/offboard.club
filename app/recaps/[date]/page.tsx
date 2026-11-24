import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ui from "../../ui.module.css";
import { longDate } from "../dates";
import styles from "../recaps.module.css";
import { viewerIsMember } from "@/lib/auth";
import { companyLabel } from "@/lib/companies";
import { lichessSwissUrl } from "@/lib/lichess";
import { getRecap } from "@/lib/recaps";
import { isRecapDate } from "@/lib/schedule";

export async function generateMetadata({ params }: PageProps<"/recaps/[date]">): Promise<Metadata> {
  const { date } = await params;
  return { title: isRecapDate(date) ? `Recap of ${longDate(date)}` : "Recap" };
}

// The Recap of the Matchday of a Vilnius day, at /recaps/YYYY-MM-DD. Public, like every Leaderboard: names and
// Companies only. Each name links to the Member's Profile, which only Members can open, and only Members see the link
// to the tournament on Lichess. An address that cannot be a Matchday's date never gets here: proxy.ts answers it with
// a 404.
export default function RecapPage({ params }: PageProps<"/recaps/[date]">) {
  return (
    <main id="main" className={ui.page}>
      <Suspense>
        <RecapOf params={params} />
      </Suspense>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/recaps">All Recaps</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}

async function RecapOf({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const [recap, member] = await Promise.all([
    getRecap(date).catch((error: Error) => {
      console.error("A Recap could not be read:", error.message);
      return undefined;
    }),
    viewerIsMember(),
  ]);
  if (recap === undefined) return <p className={ui.alert}>This Recap cannot be shown just now. Please try again later.</p>;
  if (!recap) notFound();
  return (
    <article className={styles.recap}>
      <div className={ui.intro}>
        <h1>
          Recap of <time dateTime={recap.date}>{longDate(recap.date)}</time>
        </h1>
        {/* Lichess's standings list the same order and points under Lichess names, which only Members may see. */}
        {member && (
          <p className={styles.lichessLink}>
            <a href={lichessSwissUrl(recap.lichessTournamentId)} target="_blank" rel="noopener noreferrer">
              The Matchday on Lichess
            </a>
          </p>
        )}
      </div>
      <section aria-labelledby="leaderboard" className={styles.board}>
        <h2 id="leaderboard">Leaderboard</h2>
        {recap.leaderboard.length === 0 ? (
          <p className={styles.empty}>Nobody is on this Matchday&apos;s Leaderboard.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Name</th>
                <th scope="col">Company</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {recap.leaderboard.map((row) => (
                <tr key={row.memberId}>
                  <td>{row.rank}</td>
                  <th scope="row">
                    <Link href={`/profiles/${row.memberId}`}>{row.name}</Link>
                  </th>
                  <td>{row.company && companyLabel(row.company)}</td>
                  <td>{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </article>
  );
}
