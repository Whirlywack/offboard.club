"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, type KeyboardEvent } from "react";
import { saveProfile, type ProfileFormState } from "../actions";
import ui from "../ui.module.css";
import styles from "./profile.module.css";
import { NEW_MEMBER_HOME } from "@/lib/members";
import { OPEN_TO_MAX, POSITION_MAX, type Profile } from "@/lib/profile";

type Field = keyof NonNullable<ProfileFormState>["typed"];

// The optional Profile fields, used by the step after the welcome step and by the edit page.
export function ProfileForm({ saved, welcome = false }: { saved: Profile | null; welcome?: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, null);
  const form = useRef<HTMLFormElement>(null);
  // The answer the page came with: a form posted before the page's scripts loaded comes back with its messages, and by
  // the time the scripts run the person may be typing in another field.
  const loadedWith = useRef(state);
  // Once a save is refused, the first wrong field from the top takes the focus, and the screen shows that field whole,
  // its label and what is wrong with it included: focus alone would bring only its box into view.
  useEffect(() => {
    if (state === loadedWith.current) return;
    const wrong = form.current?.querySelector<HTMLElement>("[aria-invalid]");
    wrong?.focus({ preventScroll: true });
    wrong?.parentElement?.scrollIntoView({ block: "nearest" });
  }, [state]);
  // After a refused submission the form shows what was typed rather than what is saved.
  const shown = state?.typed ?? {
    companyWebsite: saved?.company?.domain ?? "",
    position: saved?.position ?? "",
    linkedInUrl: saved?.linkedInUrl ?? "",
    openTo: saved?.openTo ?? "",
  };
  // An answer from before #111, given across a deploy or a rollback, has no problems.
  const problem = (field: Field) => state?.problems?.[field];
  // The props that tie a field to its hint and, after a refusal, to the message saying what is wrong with it.
  const describe = (field: Field, hint?: string) => ({
    id: field,
    name: field,
    defaultValue: shown[field],
    "aria-invalid": !!problem(field) || undefined,
    "aria-describedby": [hint, problem(field) && `${field}-error`].filter(Boolean).join(" ") || undefined,
  });
  const error = (field: Field) =>
    problem(field) && (
      <p id={`${field}-error`} role="alert" className={ui.alert}>
        {problem(field)}
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
    <form ref={form} action={action} className={styles.form}>
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
          <Link className={ui.quiet} href={NEW_MEMBER_HOME}>
            Skip for now
          </Link>
        )}
      </div>
    </form>
  );
}
