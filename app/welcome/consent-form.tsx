"use client";

import { useActionState } from "react";
import { consent } from "../actions";
import ui from "../ui.module.css";
import styles from "./welcome.module.css";
import { consentProblem, HOUSE_RULES } from "@/lib/consent";

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
          You&apos;ll appear as {name}, with your Company if you add one. Only signed-in Members see your photo and Profile,
          and your email is never shown.
        </p>
        <p>
          Being listed is part of being a Member, so if you&apos;d rather not be, please don&apos;t join. To leave later,
          delete your account on Edit your Profile. That takes you off every Leaderboard, Recap and Award.
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
          <span>
            I accept that my name, and my Company if I add one, appear publicly on Leaderboards, in Recaps and Awards, and
            as Season champion, for as long as I&apos;m a Member.
          </span>
        </label>
        {error("publicDisplay")}
      </fieldset>

      <fieldset className={styles.agreement}>
        <legend>House rules</legend>
        <p>Two rules, so Sundays stay fair and nobody gets sold to.</p>
        <ol className={styles.rules}>
          {HOUSE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
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
