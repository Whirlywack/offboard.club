import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink } from "../../external-link";
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

// The Company as companyLabel names it, "Vinted (vinted.com)", with the domain in its own span so that a narrow
// screen can put it on a line of its own.
function CompanyName({ company }: { company: Parameters<typeof companyLabel>[0] }) {
  const label = companyLabel(company);
  const domainAt = label.lastIndexOf(" (");
  if (domainAt < 0) return label;
  return (
    <>
      {label.slice(0, domainAt)} <span className={styles.domain}>{label.slice(domainAt + 1)}</span>
    </>
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
  if (recap === undefined)
    return <p className={ui.alert}>This Recap can&apos;t be shown right now. Please try again in a minute.</p>;
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
            <ExternalLink href={lichessSwissUrl(recap.lichessTournamentId)}>
              Open this Matchday on Lichess
            </ExternalLink>
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
                  <td>{row.company && <CompanyName company={row.company} />}</td>
                  <td>{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!member && recap.leaderboard.length > 0 && (
          <p className={`${ui.small} ${ui.muted}`}>Names open Profiles, which only signed-in Members can see.</p>
        )}
      </section>
    </article>
  );
}
