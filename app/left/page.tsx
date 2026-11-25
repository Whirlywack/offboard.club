import type { Metadata } from "next";
import Link from "next/link";
import ui from "../ui.module.css";

export const metadata: Metadata = { title: "You've left the Club" };

// Where someone lands once their account is deleted (leaveClub in app/actions.ts), signed out. It reads nothing, so it
// says the same to anyone who opens it.
export default function LeftPage() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>You&apos;ve left the Club</h1>
        <p className={ui.lede}>Your account is deleted, and you&apos;re signed out.</p>
      </div>
      <div className={ui.prose}>
        <p>
          Your Profile and results are gone from the site. Games you played stay in other Members&apos; histories, shown
          as played against a former member.
        </p>
        <p>You&apos;re welcome back any time: signing in with LinkedIn again starts a new account.</p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
