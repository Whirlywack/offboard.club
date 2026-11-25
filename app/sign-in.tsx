"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import styles from "./home.module.css";
import ui from "./ui.module.css";

// `contactable`: whether the footer links to the Organiser (lib/contact.ts), so the notice can point there.
export function SignIn({ contactable }: { contactable: boolean }) {
  const [problem, action, pending] = useActionState(signIn, "");
  return (
    <form action={action} className={`${styles.signIn} ${ui.arrive}`}>
      <button disabled={pending} aria-describedby="linkedin-notice">
        {pending ? "Opening LinkedIn…" : "Sign in with LinkedIn"}
      </button>
      {problem && (
        <p role="alert" className={ui.alert}>
          {problem}
        </p>
      )}
      {/* LinkedIn's API terms: say what the site receives before the person connects. */}
      <p id="linkedin-notice" className={styles.notice}>
        Signing in gives Offboard your name, photo and email address from LinkedIn. Your email is never shown to
        anyone, and only signed-in Members see your photo. Your name appears publicly on Leaderboards, with your Company
        if you add one, but only after you agree to that on the next page.{" "}
        {contactable
          ? "You can ask the Organiser to delete your data at any time, using the contact link at the foot of the page."
          : "Deleting your data on request will be available before the Club opens."}
      </p>
    </form>
  );
}
