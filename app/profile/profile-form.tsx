"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveProfile, type ProfileFormState } from "../actions";
import ui from "../ui.module.css";
import styles from "./profile.module.css";
import { OPEN_TO_MAX, POSITION_MAX, readProfileForm, type Profile } from "@/lib/profile";

type Field = keyof NonNullable<ProfileFormState>["typed"];

// Which field a refusal is about, so it can be shown, and announced, beside that field. readProfileForm (the same
// check the server makes) is asked about each field on its own; a refusal none of them gives is about the Company
// website, which only the server can check.
function fieldOf(state: NonNullable<ProfileFormState>): Field {
  for (const field of ["position", "openTo", "linkedInUrl"] as const) {
    if (readProfileForm({ get: (name) => (name === field ? state.typed[field] : null) }) === state.problem) return field;
  }
  return "companyWebsite";
}

// The optional Profile fields, used by the step after the welcome step and by the edit page.
export function ProfileForm({ saved, welcome = false }: { saved: Profile | null; welcome?: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, null);
  // After a refused submission the form shows what was typed rather than what is saved.
  const shown = state?.typed ?? {
    companyWebsite: saved?.company?.domain ?? "",
    position: saved?.position ?? "",
    linkedInUrl: saved?.linkedInUrl ?? "",
    openTo: saved?.openTo ?? "",
  };
  const wrong = state ? fieldOf(state) : null;
  // The props that tie a field to its hint and, after a refusal, to the message saying what is wrong with it.
  const describe = (field: Field, hint?: string) => ({
    id: field,
    name: field,
    defaultValue: shown[field],
    "aria-invalid": wrong === field || undefined,
    "aria-describedby": [hint, wrong === field && `${field}-error`].filter(Boolean).join(" ") || undefined,
  });
  const error = (field: Field) =>
    wrong === field && (
      <p id={`${field}-error`} role="alert" className={ui.alert}>
        {state?.problem}
      </p>
    );

  return (
    <form action={action} className={`${styles.form} ${ui.arrive}`}>
      {welcome && <input type="hidden" name="next" value="home" />}

      <div className={styles.field}>
        <label htmlFor="companyWebsite">Company website</label>
        <p id="companyWebsite-hint" className={styles.hint}>
          The website of the company you work for. Members who give the same website share one Company, and its name is
          taken from that website.
        </p>
        {error("companyWebsite")}
        <input
          {...describe("companyWebsite", "companyWebsite-hint")}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="vinted.com"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="position">Position</label>
        <p id="position-hint" className={styles.hint}>
          Up to {POSITION_MAX} characters.
        </p>
        {error("position")}
        <input {...describe("position", "position-hint")} autoComplete="organization-title" />
      </div>

      <div className={styles.field}>
        <label htmlFor="linkedInUrl">LinkedIn profile link</label>
        {error("linkedInUrl")}
        <input
          {...describe("linkedInUrl")}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://www.linkedin.com/in/your-name"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="openTo">Open to</label>
        <p id="openTo-hint" className={styles.hint}>
          Up to {OPEN_TO_MAX} characters: what you would welcome from other Members, such as coffee chats, mentoring or
          hearing about jobs. Sales and recruiting pitches are only allowed if this line invites them.
        </p>
        {error("openTo")}
        <input {...describe("openTo", "openTo-hint")} />
      </div>

      <div className={ui.actions}>
        <button disabled={pending}>{pending ? "Saving…" : welcome ? "Save and continue" : "Save"}</button>
        {welcome && (
          <Link className={ui.quiet} href="/">
            Skip for now
          </Link>
        )}
      </div>
    </form>
  );
}
