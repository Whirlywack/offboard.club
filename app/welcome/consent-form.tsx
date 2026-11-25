"use client";

import { useActionState } from "react";
import { consent } from "../actions";
import ui from "../ui.module.css";
import styles from "./welcome.module.css";
import { consentProblem } from "@/lib/consent";

// The message lib/consent.ts gives when only the house rules were accepted, so a refusal can be shown, and announced,
// beside the box it is about.
const PUBLIC_DISPLAY_MISSING = consentProblem({ get: (name) => (name === "houseRules" ? "yes" : null) });

export function ConsentForm({ name }: { name: string }) {
  const [problem, action, pending] = useActionState(consent, "");
  const about = !problem ? null : problem === PUBLIC_DISPLAY_MISSING ? "publicDisplay" : "houseRules";
  const error = (box: "publicDisplay" | "houseRules") =>
    about === box && (
      <p id={`${box}-error`} role="alert" className={ui.alert}>
        {problem}
      </p>
    );
  return (
    <form action={action} className={`${styles.consent} ${ui.arrive}`}>
      <fieldset className={styles.agreement}>
        <legend>Your name in public</legend>
        <p>
          Leaderboards and Recaps are public: anyone can see them, signed in or not. They show you as {name}, with your
          Company if you add one. Your email is never shown, and your Profile is for signed-in Members only.
        </p>
        <label className={styles.check}>
          <input
            type="checkbox"
            name="publicDisplay"
            value="yes"
            required
            aria-invalid={about === "publicDisplay" || undefined}
            aria-describedby={about === "publicDisplay" ? "publicDisplay-error" : undefined}
          />
          <span>I agree that my name, and my Company if I add one, will appear publicly on Leaderboards.</span>
        </label>
        {error("publicDisplay")}
      </fieldset>

      <fieldset className={styles.agreement}>
        <legend>House rules</legend>
        <p>Two rules, so Sundays stay fair and nobody gets sold to.</p>
        <ol className={styles.rules}>
          <li>No outside help during Games, such as an engine, an analysis board or a friend&apos;s advice.</li>
          <li>No sales or recruiting pitches, unless the other person&apos;s &ldquo;open to&rdquo; line invites it.</li>
        </ol>
        <label className={styles.check}>
          <input
            type="checkbox"
            name="houseRules"
            value="yes"
            required
            aria-invalid={about === "houseRules" || undefined}
            aria-describedby={about === "houseRules" ? "houseRules-error" : undefined}
          />
          <span>I accept the house rules.</span>
        </label>
        {error("houseRules")}
      </fieldset>

      <div className={ui.actions}>
        <button disabled={pending}>{pending ? "Saving…" : "Agree and continue"}</button>
      </div>
    </form>
  );
}
