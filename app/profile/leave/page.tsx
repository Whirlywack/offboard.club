import type { Metadata } from "next";
import { Suspense } from "react";
import { leaveClub } from "../../actions";
import ui from "../../ui.module.css";
import styles from "../profile.module.css";
import { LeaveActions } from "./leave-actions";
import { requireSignedUp } from "@/lib/auth";
import { isOrganiser } from "@/lib/organiser";

export const metadata: Metadata = { title: "Leave the Club" };

// Server Actions run within their page's limit: removing the Member from the Club's Lichess team and revoking the
// Organiser's token may each take up to 25 s (lib/leaving.ts).
export const maxDuration = 60;

// The confirmation step before a Member deletes their own account, reached from the Profile edit page. Nothing is
// deleted until its button is pressed.
export default function LeavePage() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>Leave the Club</h1>
        <p className={ui.lede}>This can&apos;t be undone.</p>
      </div>
      <Suspense>
        <Confirm />
      </Suspense>
    </main>
  );
}

async function Confirm() {
  const person = await requireSignedUp();
  // What goes, what stays and, for the Organiser, what stops, then the choice: one panel, as the Profile form is. What
  // stays is all of it: Games (their side empty), everything on Lichess but the team and, only when removing them from
  // the team fails, their Lichess id on the Organiser's list until the Organiser has removed it (lib/leaving.ts). An
  // Award won against them keeps its winner and shows nothing of them.
  return (
    <form action={leaveClub} className={`${ui.panel} ${styles.confirm} ${ui.arrive}`}>
      <p>When you delete your account:</p>
      <ul className={styles.consequences}>
        <li>Your name, photo, email address and Profile are deleted.</li>
        <li>You disappear from every Leaderboard and Recap, including past ones.</li>
        <li>Your Lichess account is disconnected, and the site asks Lichess to remove it from the Club&apos;s team.</li>
        <li>Other Members keep their Games against you, with you shown as &ldquo;a&nbsp;former member&rdquo;.</li>
      </ul>
      <p>
        If the site can&apos;t remove you from the team, your Lichess username is kept until the Organiser has done it
        by hand.
      </p>
      {isOrganiser(person) && (
        <p className={ui.alert}>
          You&apos;re the Organiser. Once you leave, Matchdays stop being created and nobody is removed from the Lichess
          team until someone else is made Organiser.
        </p>
      )}
      <LeaveActions keep="/profile" />
    </form>
  );
}
