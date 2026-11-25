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
        <p className={ui.lede}>Deleting your account can&apos;t be undone.</p>
      </div>
      <Suspense>
        <Confirm />
      </Suspense>
    </main>
  );
}

async function Confirm() {
  const person = await requireSignedUp();
  // What goes, what stays and, for the Organiser, what stops, then the choice: one panel, as the Profile form is.
  return (
    <form action={leaveClub} className={`${ui.panel} ${styles.confirm} ${ui.arrive}`}>
      <p>When you delete your account:</p>
      <ul className={styles.consequences}>
        <li>Your Profile goes: your name and photo, Company, position, LinkedIn link and what you&apos;re open to.</li>
        <li>You disappear from every Leaderboard and every Recap, past and present, and from the Awards.</li>
        <li>Your Lichess account is removed from the Club&apos;s Lichess team, and is no longer connected here.</li>
        <li>Games you played stay in other Members&apos; histories, shown as played against a former member.</li>
      </ul>
      <p>Your Lichess account itself, and your Games on Lichess, stay as they are.</p>
      {isOrganiser(person) && (
        <p className={ui.alert}>
          You&apos;re the Organiser. Your Lichess permission is revoked too, so Matchdays stop being created on Lichess.
        </p>
      )}
      <LeaveActions />
    </form>
  );
}
