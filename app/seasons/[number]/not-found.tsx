import Link from "next/link";
import ui from "../../ui.module.css";

// For a Season too far off to have a page: any after the one after the current one, whose dates would still move, and
// every one after Season 1 while Season 1 is not scheduled. Like a Recap's, it streams in after the page's App Shell,
// under a 200 that Next.js marks noindex.
export default function NoSeason() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Season Leaderboard</p>
        <h1>That Season&apos;s dates aren&apos;t set yet</h1>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/seasons">This Season&apos;s Leaderboard</Link>
        <Link href="/all-time">All-time Leaderboard</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
