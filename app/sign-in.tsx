"use client";

import Link from "next/link";
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
      {/* LinkedIn's API terms: next to the button, that the site stores the profile, how often, and the policy. */}
      <p id="linkedin-notice" className={styles.notice}>
        By signing in with LinkedIn you let Offboard store your LinkedIn name, photo and email, updated each time you sign
        in. <Link href="/privacy">Privacy and terms</Link>
      </p>
    </form>
  );
}
