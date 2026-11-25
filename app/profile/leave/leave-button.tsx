"use client";

import { useFormStatus } from "react-dom";

// The confirmation page's button. It says it is working from the press until the account is gone, which can take a
// while when Lichess is slow, so that the wait does not look like a press that missed or invite a second one.
export function LeaveButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? "Deleting your account…" : "Delete my account"}</button>;
}
