import Link from "next/link";
import styles from "../../profile/profile.module.css";
import ui from "../../ui.module.css";

// For an address with no Profile behind it, whether nobody has that id or they have not finished signing up.
export default function NoProfile() {
  return (
    <main id="main" className={styles.plain}>
      <div className={styles.head}>
        <h1 className={`${styles.title} ${ui.display}`}>
          <em>No</em> Profile at this address
        </h1>
        <p className={styles.line}>The person may still be signing up, or may have left the Club.</p>
      </div>
      <div className={styles.body}>
        <nav aria-label="More" className={ui.backLinks}>
          <Link href="/recaps">Recaps</Link>
          <Link href="/">Home</Link>
        </nav>
      </div>
    </main>
  );
}
