import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExternalLink } from "../../external-link";
import { ProfilesNote } from "../../leaderboard";
import queenKing from "../../photos/queen-king.webp";
import ui from "../../ui.module.css";
import { Awards } from "../awards";
import { longDate } from "../dates";
import { More } from "../more";
import styles from "../recaps.module.css";
import { viewerIsMember } from "@/lib/auth";
import { AWARD_GAMES_ARE_PUBLIC } from "@/lib/awards";
import { companyLabel } from "@/lib/companies";
import { seasonOfMatchday } from "@/lib/leaderboards";
import { lichessSwissUrl } from "@/lib/lichess";
import { getRecap } from "@/lib/recaps";
import { noticeLater } from "@/lib/request-failures";
import { isRecapDate } from "@/lib/schedule";

// This page's route as Next.js names it, by which a failure it catches is recorded.
const ROUTE = "/recaps/[date]";

export async function generateMetadata({ params }: PageProps<"/recaps/[date]">): Promise<Metadata> {
  const { date } = await params;
  return { title: isRecapDate(date) ? `Recap of ${longDate(date)}` : "Recap" };
}

// The Recap of the Matchday of a Vilnius day, at /recaps/YYYY-MM-DD. Public, like every Leaderboard: names and
// Companies only, then the Awards. Each name links to the Member's Profile, which only Members can open, and only
// Members see the link to the tournament on Lichess and each Award's Game (lib/awards.ts, AWARD_GAMES_ARE_PUBLIC). An
// address that cannot be a Matchday's date never gets here: proxy.ts answers it with a 404.
export default function RecapPage({ params }: PageProps<"/recaps/[date]">) {
  return (
    <main id="main" className={styles.recap}>
      <Suspense>
        <RecapOf params={params} />
      </Suspense>
      <More
        links={[
          ["/recaps", "All Recaps"],
          ["/", "Home"],
        ]}
      />
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

// The night as it ended: its date over the queen standing above the fallen king, then its Awards, the event of the
// page, on black, then where everyone finished.
async function RecapOf({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  await connection(); // the Matchday's Season is read from the schedule as of now
  const [recap, member, season] = await Promise.all([
    getRecap(date).catch((error: Error) => {
      console.error("A Recap could not be read:", error.message);
      noticeLater(error, ROUTE);
      return undefined;
    }),
    viewerIsMember(ROUTE),
    seasonOfMatchday(date, new Date()).catch((error: unknown) => {
      noticeLater(error, ROUTE);
      return null;
    }),
  ]);
  if (recap === undefined)
    return <p className={`${ui.alert} ${styles.unreadRecap}`}>This Recap can&apos;t be shown right now. Please try again in a minute.</p>;
  if (!recap) notFound();
  return (
    <article>
      <header className={`${styles.head} ${ui.grain}`}>
        <h1 className={`${styles.title} ${ui.display}`}>
          <em>Recap</em> of <time dateTime={recap.date}>{longDate(recap.date)}</time>
        </h1>
        <div className={styles.night}>
          {season && (
            <p>
              Matchday {season.number} of <Link href={`/seasons/${season.season}`}>Season {season.season}</Link>
            </p>
          )}
          {/* Lichess's standings list the same order and points under Lichess names, which only Members may see. */}
          {member && (
            <p>
              <ExternalLink href={lichessSwissUrl(recap.lichessTournamentId)}>Open this Matchday on Lichess</ExternalLink>
            </p>
          )}
        </div>
        <Image className={styles.fallen} src={queenKing} alt="" sizes="(min-width: 900px) 720px, 360px" preload />
      </header>
      <Awards awards={recap.awards} showGames={AWARD_GAMES_ARE_PUBLIC || member} />
      <section aria-labelledby="leaderboard" className={styles.board}>
        <h2 id="leaderboard" className={`${styles.boardTitle} ${ui.display}`}>
          Leaderboard
        </h2>
        {recap.leaderboard.length === 0 ? (
          <p className={`${styles.nobody} ${ui.display}`}>Nobody is on this Matchday&apos;s Leaderboard.</p>
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
                  {/* A whole number stands as far from the edge as the whole part of a half does, so the units line up */}
                  <td className={Number.isInteger(row.points) ? styles.whole : undefined}>{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!member && recap.leaderboard.length > 0 && <ProfilesNote />}
      </section>
    </article>
  );
}
