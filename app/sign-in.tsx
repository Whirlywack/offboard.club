"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import styles from "./home.module.css";
import ui from "./ui.module.css";

export function SignIn() {
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
        LinkedIn gives Offboard your name, photo and email address. Your email is never shown. Once you agree, your
        name and Company appear publicly on Leaderboards. You can ask the Organiser to delete your data at any time.
      </p>
    </form>
  );
}
