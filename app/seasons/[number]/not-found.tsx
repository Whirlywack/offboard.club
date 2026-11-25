import Link from "next/link";
import ui from "../../ui.module.css";

// For a Season the schedule does not have yet, which before Season 1 is scheduled is every Season after it. Like a
// Recap's, it streams in after the page's App Shell, under a 200 that Next.js marks noindex.
export default function NoSeason() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Season Leaderboard</p>
        <h1>That Season isn&apos;t scheduled yet</h1>
        <p className={ui.lede}>
          No Season has dates yet. Season 1 starts once sixteen Members have joined, and the rest follow from it.
        </p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/seasons">This Season&apos;s Leaderboard</Link>
        <Link href="/all-time">All-time Leaderboard</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
