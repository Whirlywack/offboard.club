import Image from "next/image";
import fallback from "../../fallback.module.css";
import pawnOutline from "../../photos/pawn-outline.webp";
import { RuledLinks } from "../../ruled-links";
import ui from "../../ui.module.css";
import styles from "../seasons.module.css";

// For a Season too far off to have a page: any after the one after the current one, whose dates would still move, and
// every one after Season 1 while Season 1 is not scheduled. Like a Recap's, it streams in after the page's App Shell,
// under a 200 that Next.js marks noindex. It is the not-found page's plate (app/not-found.tsx), with its pawn in outline:
// a place nobody holds yet.
export default function NoSeason() {
  return (
    <main id="main" className={`${fallback.plate} ${ui.grain}`}>
      <div className={fallback.text}>
        <h1 className={`${fallback.title} ${ui.display}`}>
          <em>That</em> Season&apos;s dates aren&apos;t set yet
        </h1>
        <p className={`${ui.caps} ${styles.noSeasonLabel}`}>Season Leaderboard</p>
        <nav aria-label="More">
          <RuledLinks
            className={fallback.links}
            links={[
              ["/seasons", "This Season's Leaderboard"],
              ["/all-time", "All-time Leaderboard"],
              ["/", "Home"],
            ]}
          />
        </nav>
      </div>
      <Image className={fallback.empty} src={pawnOutline} alt="" sizes="(min-width: 900px) 208px, 104px" />
    </main>
  );
}
