import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { viewerIsMember } from "@/lib/auth";
import { companyLabel } from "@/lib/companies";
import { lichessSwissUrl } from "@/lib/lichess";
import { getRecap } from "@/lib/recaps";
import { isCalendarDate } from "@/lib/schedule";
import { longDate } from "../dates";

export async function generateMetadata({ params }: PageProps<"/recaps/[date]">): Promise<Metadata> {
  const { date } = await params;
  return { title: isCalendarDate(date) ? `Recap of ${longDate(date)}` : "Recap" };
}

// The Recap of the Matchday of a Vilnius day, at /recaps/YYYY-MM-DD. Public, like every Leaderboard: names and
// Companies only. Each name links to the Member's Profile, which only Members can open, and only Members see the link
// to the tournament on Lichess.
export default function RecapPage({ params }: PageProps<"/recaps/[date]">) {
  return (
    <main>
      <Suspense>
        <RecapOf params={params} />
      </Suspense>
      <p>
        <Link href="/recaps">All Recaps</Link>
      </p>
      <p>
        <Link href="/">Home</Link>
      </p>
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
  if (recap === undefined) return <p>This Recap cannot be shown just now. Please try again later.</p>;
  if (!recap) notFound();
  return (
    <article>
      <h1>
        Recap of <time dateTime={recap.date}>{longDate(recap.date)}</time>
      </h1>
      {/* Lichess's standings list the same order and points under Lichess names, which only Members may see. */}
      {member && (
        <p>
          <a href={lichessSwissUrl(recap.lichessTournamentId)} target="_blank" rel="noopener noreferrer">
            The Matchday on Lichess
          </a>
        </p>
      )}
      <section aria-labelledby="leaderboard">
        <h2 id="leaderboard">Leaderboard</h2>
        {recap.leaderboard.length === 0 ? (
          <p>Nobody is on this Matchday&apos;s Leaderboard.</p>
        ) : (
          <table>
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
