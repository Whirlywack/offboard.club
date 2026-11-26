import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { MemberCell, MoreLinks, ProfilesNote } from "../leaderboard";
import board from "../leaderboards.module.css";
import ui from "../ui.module.css";
import styles from "./all-time.module.css";
import { viewerIsMember } from "@/lib/auth";
import { getAllTime } from "@/lib/leaderboards";
import { noticeLater } from "@/lib/request-failures";

export const metadata: Metadata = { title: "All-time Leaderboard" };

// The all-time Leaderboard: every Member ranked by Matchdays played, whatever they scored. Public, like every
// Leaderboard: names and Companies only. The Season page's plainer sibling: its heading in large type alone, then the
// same table.
export default function AllTimePage() {
  return (
    <main id="main">
      <div className={styles.head}>
        <h1 className={ui.display}>
          <em>All-time</em> Leaderboard
        </h1>
        <p className={styles.lede}>Members ranked by how many Matchdays they&apos;ve played.</p>
      </div>
      <Suspense>
        <AllTime />
      </Suspense>
    </main>
  );
}

const MORE: [string, string][] = [
  ["/seasons", "This Season's Leaderboard"],
  ["/recaps", "Recaps"],
  ["/", "Home"],
];

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
    return (
      <div className={board.down}>
        <p className={ui.alert}>This Leaderboard can&apos;t be shown right now. Please try again in a minute.</p>
        <MoreLinks links={MORE} />
      </div>
    );
  return (
    <section aria-label="Leaderboard" className={board.board}>
      {rows.length === 0 ? (
        <p className={board.empty}>Nobody is on it yet.</p>
      ) : (
        <table className={board.table}>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Name</th>
              <th scope="col" className={board.score}>
                Played
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.memberId}>
                <td>{row.rank}</td>
                <MemberCell member={row} />
                <td className={board.score}>{row.played}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!member && rows.length > 0 && <ProfilesNote />}
      <MoreLinks links={MORE} />
    </section>
  );
}
