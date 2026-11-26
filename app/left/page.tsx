import type { Metadata } from "next";
import styles from "../profile/profile.module.css";
import { RuledLinks } from "../ruled-links";
import ui from "../ui.module.css";

export const metadata: Metadata = { title: "After you leave the Club" };

// Where someone lands once their account is deleted (leaveClub in app/actions.ts), signed out. It reads nothing, so
// anyone can open it, a signed-in Member included, and each sentence is true for whoever does.
export default function LeftPage() {
  return (
    <main id="main" className={styles.plain}>
      <div className={styles.head}>
        <h1 className={`${styles.title} ${ui.display}`}>
          <em>After</em> you leave the Club
        </h1>
        <p className={styles.line}>If you&apos;ve just deleted your account, it&apos;s gone and you&apos;re signed out.</p>
      </div>
      <div className={styles.body}>
        <p>You&apos;re welcome back any time: just sign in with LinkedIn again.</p>
        <nav aria-label="More">
          <RuledLinks links={[["/", "Home"]]} />
        </nav>
      </div>
    </main>
  );
}
