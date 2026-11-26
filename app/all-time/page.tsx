import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { MemberCell, ProfilesNote } from "../leaderboard";
import board from "../leaderboards.module.css";
import ui from "../ui.module.css";
import { viewerIsMember } from "@/lib/auth";
import { getAllTime } from "@/lib/leaderboards";
import { noticeLater } from "@/lib/request-failures";

export const metadata: Metadata = { title: "All-time Leaderboard" };

// The all-time Leaderboard: every Member ranked by Matchdays played, whatever they scored. Public, like every
// Leaderboard: names and Companies only.
export default function AllTimePage() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Leaderboard</p>
        <h1>All-time Leaderboard</h1>
        <p className={ui.lede}>
          Members ranked by how many Matchdays they&apos;ve played. Win or lose, every Sunday you play counts.
        </p>
      </div>
      <Suspense>
        <AllTime />
      </Suspense>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/seasons">This Season&apos;s Leaderboard</Link>
        <Link href="/recaps">Recaps</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}

// Said plainly, and logged, if the database cannot be read.
async function AllTime() {
  await connection();
  const [rows, member] = await Promise.all([
    getAllTime().catch((error: Error) => {
      console.error("The all-time Leaderboard could not be read:", error.message);
      noticeLater(error, "/all-time");
      return null;
    }),
    viewerIsMember("/all-time"),
  ]);
  if (rows === null)
    return <p className={ui.alert}>This Leaderboard can&apos;t be shown right now. Please try again in a minute.</p>;
  if (rows.length === 0)
    return <p className={`${board.empty} ${ui.arrive}`}>Nobody is on it yet. Everyone who plays the first Matchday will be.</p>;
  return (
    <section aria-label="Leaderboard" className={board.board}>
      <table className={board.table}>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Name</th>
            <th scope="col" className={board.number}>
              Played
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.memberId}>
              <td>{row.rank}</td>
              <MemberCell member={row} />
              <td className={`${board.number} ${board.score}`}>{row.played}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`${ui.small} ${ui.muted}`}>
        Members who&apos;ve played the same number of Matchdays share a rank. Companies are where Members work now.
      </p>
      {!member && <ProfilesNote />}
    </section>
  );
}
