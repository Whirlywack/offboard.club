"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { signIn } from "./actions";
import styles from "./home.module.css";
import ui from "./ui.module.css";

// `shown` is a problem to show before the button is pressed. The home page's header button sends this form too (its id),
// so that either button goes to LinkedIn the same way and a problem shows here, beside the note: one that comes back
// after a press is brought into sight, as the header's button is a screen or more above it.
export function SignIn({ problem: shown }: { problem: string }) {
  const [problem, action, pending] = useActionState(signIn, shown);
  const said = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (problem && problem !== shown) said.current?.scrollIntoView({ block: "center" });
  }, [problem, shown]);
  return (
    <form id="sign-in" action={action} className={styles.signIn}>
      <button disabled={pending} aria-describedby="linkedin-notice">
        {pending ? "Opening LinkedIn…" : "Sign in with LinkedIn"}
      </button>
      {problem && (
        <p ref={said} role="alert" className={ui.alert}>
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
