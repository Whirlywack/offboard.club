import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { deleteSignUp } from "../../actions";
import { LeaveActions } from "../../profile/leave/leave-actions";
import styles from "../../profile/profile.module.css";
import ui from "../../ui.module.css";
import { getSession } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";
import { mustConnectLichess } from "@/lib/members";

export const metadata: Metadata = { title: "Delete your account" };

// The confirmation step before someone part-way through signing up deletes their account, reached from either welcome
// step: the same deletion and the same choice as a Member's (app/profile/leave), saying only what is true for someone
// with no Profile, results, Games or Lichess account. Nothing is deleted until its button is pressed.
export default function DeleteAccountPage() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>Delete your account</h1>
        <p className={ui.lede}>This can&apos;t be undone.</p>
      </div>
      <Suspense>
        <Confirm />
      </Suspense>
    </main>
  );
}

// Signed-out visitors have nothing to delete, and a Member confirms on their own page, which says what they would lose.
// Keeping the account goes back to the step the person is on.
async function Confirm() {
  const session = await getSession();
  if (!session) redirect("/");
  const agreed = !mustWelcome(session.user);
  if (agreed && !mustConnectLichess(session.user)) redirect("/profile/leave");
  return (
    <form action={deleteSignUp} className={`${ui.panel} ${styles.confirm} ${ui.arrive}`}>
      <p>When you delete your account, your name, photo, email address and anything you&apos;ve agreed to are deleted.</p>
      <LeaveActions keep={agreed ? "/welcome/lichess" : "/welcome"} />
    </form>
  );
}
