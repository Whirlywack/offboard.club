"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import ui from "../../ui.module.css";
import styles from "../profile.module.css";

// The confirmation page's two choices. Keeping the account comes first and is the filled button, so that the easy press
// and the first stop from the keyboard are the safe ones; deleting is outlined in the error colour. From the press until
// the account is gone, which can take a while when Lichess is slow, the button says it is working, so that the wait
// does not look like a press that missed or invite a second one, and keeping is no longer offered, as it no longer can be.
export function LeaveActions() {
  const { pending } = useFormStatus();
  return (
    <div className={`${ui.actions} ${styles.formActions}`}>
      <Link className={ui.button} href="/profile" aria-disabled={pending || undefined} tabIndex={pending ? -1 : undefined}>
        Keep my account
      </Link>
      <button className={styles.delete} disabled={pending}>
        {pending ? "Deleting…" : "Delete my account"}
      </button>
    </div>
  );
}
