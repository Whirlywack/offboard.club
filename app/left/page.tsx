import type { Metadata } from "next";
import Link from "next/link";
import ui from "../ui.module.css";

export const metadata: Metadata = { title: "After you leave the Club" };

// Where someone lands once their account is deleted (leaveClub in app/actions.ts), signed out. It reads nothing, so
// anyone can open it, a signed-in Member included, and each sentence is true for whoever does.
export default function LeftPage() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>After you leave the Club</h1>
        <p className={ui.lede}>If you&apos;ve just deleted your account, it&apos;s gone and you&apos;re signed out.</p>
      </div>
      <div className={ui.prose}>
        <p>You&apos;re welcome back any time: just sign in with LinkedIn again.</p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
