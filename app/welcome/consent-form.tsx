"use client";

import { useActionState } from "react";
import { consent } from "../actions";

export function ConsentForm({ name }: { name: string }) {
  const [problem, action, pending] = useActionState(consent, "");
  return (
    <form action={action}>
      <fieldset>
        <legend>Your name in public</legend>
        <p>
          Leaderboards are public. They show you as {name} and, if you add one later, your Company. Your email is
          never shown.
        </p>
        <label>
          <input type="checkbox" name="publicDisplay" value="yes" required /> I agree that my name and Company will
          appear publicly on Leaderboards.
        </label>
      </fieldset>

      <fieldset>
        <legend>House rules</legend>
        <ol>
          <li>No outside help during Games.</li>
          <li>No sales or recruiting pitches, unless the other person&apos;s &ldquo;open to&rdquo; line invites it.</li>
        </ol>
        <label>
          <input type="checkbox" name="houseRules" value="yes" required /> I accept the house rules.
        </label>
      </fieldset>

      {problem && <p role="alert">{problem}</p>}
      <button disabled={pending}>Continue</button>
    </form>
  );
}
