import type { Metadata } from "next";
import Image from "next/image";
import styles from "./fallback.module.css";
import pawnOutline from "./photos/pawn-outline.webp";
import { RuledLinks } from "./ruled-links";
import ui from "./ui.module.css";

export const metadata: Metadata = { title: "Page not found" };

// For any address the site does not have, including Recap addresses that cannot be a Matchday's date (proxy.ts). Its
// picture is the outline of a pawn: a place nobody holds.
export default function NotFound() {
  return (
    <main id="main" className={`${styles.plate} ${ui.grain}`}>
      <div className={styles.text}>
        <h1 className={`${styles.title} ${ui.display}`}>
          <em>Nothing</em> at this address
        </h1>
        <p className={styles.lede}>The address may have a typo in it.</p>
        <nav aria-label="More">
          <RuledLinks
            className={styles.links}
            links={[
              ["/", "Home"],
              ["/recaps", "Recaps"],
            ]}
          />
        </nav>
      </div>
      <Image className={styles.empty} src={pawnOutline} alt="" sizes="(min-width: 900px) 208px, 104px" />
    </main>
  );
}
