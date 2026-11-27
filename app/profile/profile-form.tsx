"use client";

import Link from "next/link";
import { useActionState, type KeyboardEvent } from "react";
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
  // Enter in the open-to box saves the form, as it did when the box was one line, rather than start a line that would
  // be saved as a space. Not while a save is under way, as a disabled button stops Enter in a field, and not while a
  // keyboard is still composing a word, whose Enter chooses it: Safari says so of that Enter by key code 229 alone.
  const saveOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!pending) event.currentTarget.form?.requestSubmit();
  };

  return (
    <form action={action} className={styles.form}>
      {welcome && <input type="hidden" name="next" value="home" />}

      <div className={styles.field}>
        <label htmlFor="companyWebsite">Company website</label>
        <p id="companyWebsite-hint" className={styles.hint}>
          The website of the company you work for. Its name, taken from the site, shows with your name on Leaderboards
          and in Recaps. Freelance or between jobs? Leave it empty.
        </p>
        {error("companyWebsite")}
        <input
          {...describe("companyWebsite", "companyWebsite-hint")}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g. vinted.com"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="position">Position</label>
        <p id="position-hint" className={styles.hint}>
          Up to {POSITION_MAX} characters.
        </p>
        {error("position")}
        <input {...describe("position", "position-hint")} autoComplete="organization-title" placeholder="e.g. Backend engineer" />
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
          placeholder="linkedin.com/in/your-name"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="openTo">Open to</label>
        <p id="openTo-hint" className={styles.hint}>
          What you&apos;d welcome from other Members, in up to {OPEN_TO_MAX} characters. Sales and recruiting pitches
          are only allowed if this line invites them.
        </p>
        {error("openTo")}
        {/* Four lines, so all of it can be read back on a phone. A phone's return key is labelled for what it does. */}
        <textarea
          {...describe("openTo", "openTo-hint")}
          rows={4}
          enterKeyHint="go"
          onKeyDown={saveOnEnter}
          placeholder="e.g. A coffee, mentoring, hearing about jobs"
        />
      </div>

      <div className={`${ui.actions} ${styles.formActions}`}>
        <button disabled={pending}>{pending ? "Saving…" : welcome ? "Save and continue" : "Save changes"}</button>
        {welcome && (
          <Link className={ui.quiet} href="/">
            Skip for now
          </Link>
        )}
      </div>
    </form>
  );
}
