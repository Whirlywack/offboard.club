import Image from "next/image";
import styles from "../../fallback.module.css";
import pawnOutline from "../../photos/pawn-outline.webp";
import { RuledLinks } from "../../ruled-links";
import ui from "../../ui.module.css";

// For an address with no Profile behind it, whether nobody has that id or they have not finished signing up. In the
// site's not-found plate (app/not-found.tsx), with its outline of a pawn: a place nobody holds.
export default function NoProfile() {
  return (
    <main id="main" className={`${styles.plate} ${ui.grain}`}>
      <div className={styles.text}>
        <h1 className={`${styles.title} ${ui.display}`}>
          <em>No</em> Profile at this address
        </h1>
        <p className={styles.lede}>The person may still be signing up, or may have left the Club.</p>
        <nav aria-label="More">
          <RuledLinks
            className={styles.links}
            links={[
              ["/recaps", "Recaps"],
              ["/", "Home"],
            ]}
          />
        </nav>
      </div>
      <Image className={styles.empty} src={pawnOutline} alt="" sizes="(min-width: 900px) 208px, 104px" />
    </main>
  );
}
