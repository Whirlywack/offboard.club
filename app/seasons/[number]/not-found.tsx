import { RuledLinks } from "../../ruled-links";
import ui from "../../ui.module.css";
import styles from "../seasons.module.css";

// For a Season too far off to have a page: any after the one after the current one, whose dates would still move, and
// every one after Season 1 while Season 1 is not scheduled. Like a Recap's, it streams in after the page's App Shell,
// under a 200 that Next.js marks noindex.
export default function NoSeason() {
  return (
    <main id="main" className={styles.noSeason}>
      <div>
        <h1 className={ui.display}>
          <em>That</em> Season&apos;s dates aren&apos;t set yet
        </h1>
        <p className={`${ui.caps} ${styles.label}`}>Season Leaderboard</p>
      </div>
      <nav aria-label="More">
        <RuledLinks
          links={[
            ["/seasons", "This Season's Leaderboard"],
            ["/all-time", "All-time Leaderboard"],
            ["/", "Home"],
          ]}
        />
      </nav>
    </main>
  );
}
