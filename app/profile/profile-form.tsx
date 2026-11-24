"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveProfile } from "../actions";
import { OPEN_TO_MAX, POSITION_MAX, type ProfileFields } from "@/lib/profile";

// The optional Profile fields, used by the step after the welcome step and by the edit page.
export function ProfileForm({ saved, welcome = false }: { saved: ProfileFields | null; welcome?: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, null);
  // After a refused submission the form shows what was typed rather than what is saved.
  const shown = state?.typed ?? saved;
  return (
    <form action={action}>
      {welcome && <input type="hidden" name="next" value="home" />}
      {/* The Company website (#6) goes here, first. */}
      <p>
        <label>
          Position (up to {POSITION_MAX} characters) <input name="position" defaultValue={shown?.position ?? ""} />
        </label>
      </p>
      <p>
        <label>
          LinkedIn profile link{" "}
          <input
            name="linkedInUrl"
            inputMode="url"
            defaultValue={shown?.linkedInUrl ?? ""}
            placeholder="https://www.linkedin.com/in/your-name"
          />
        </label>
      </p>
      <p>
        <label>
          Open to{" "}
          <input name="openTo" defaultValue={shown?.openTo ?? ""} aria-describedby="open-to-hint" />
        </label>
        <br />
        <small id="open-to-hint">
          Up to {OPEN_TO_MAX} characters: what you would welcome from other Members, such as coffee chats, mentoring or
          hearing about jobs. Sales and recruiting pitches are only allowed if this line invites them.
        </small>
      </p>

      {state && <p role="alert">{state.problem}</p>}
      <button disabled={pending}>{welcome ? "Save and continue" : "Save"}</button>
      {welcome && (
        <>
          {" "}
          <Link href="/">Skip for now</Link>
        </>
      )}
    </form>
  );
}
