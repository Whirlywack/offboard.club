"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "./actions";
import styles from "./home.module.css";
import ui from "./ui.module.css";

// Brings a problem into sight as it arrives, as the header's button is a screen or more above it.
const intoView = (said: HTMLParagraphElement | null) => said?.scrollIntoView({ block: "center" });

// `shown` is a problem to show before the button is pressed. The home page's header button sends this form too (its id),
// so that either button goes to LinkedIn the same way and a problem shows here, beside the note. Each press that comes
// back with one is a new alert (its key), so it is said and brought into sight again when the words are the same.
export function SignIn({ problem: shown }: { problem: string }) {
  const [{ problem, tries }, action, pending] = useActionState(signIn, { problem: shown, tries: 0 });
  return (
    <form id="sign-in" action={action} className={styles.signIn}>
      <button disabled={pending} aria-describedby="linkedin-notice">
        {pending ? "Opening LinkedIn…" : "Sign in with LinkedIn"}
      </button>
      {problem && (
        <p key={tries} ref={tries ? intoView : undefined} role="alert" className={ui.alert}>
          {problem}
        </p>
      )}
      {/* LinkedIn's API terms: next to the button, that the site stores the profile, how often, and the policy. */}
      <p id="linkedin-notice" className={styles.notice}>
        Signing in lets Offboard store your LinkedIn name, photo and email, updated each time you sign in.{" "}
        <Link href="/privacy">Privacy and terms</Link>
      </p>
    </form>
  );
}
