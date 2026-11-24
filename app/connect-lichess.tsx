"use client";

import { useActionState } from "react";
import { connectLichess } from "./actions";
import ui from "./ui.module.css";

// Used by the connect step and, to swap accounts, by the Profile edit page, where it is the quieter button.
export function ConnectLichess({ label, quiet = false }: { label: string; quiet?: boolean }) {
  const [problem, action, pending] = useActionState(connectLichess, "");
  return (
    <form action={action} className={ui.actions}>
      <button disabled={pending} className={quiet ? ui.quiet : undefined}>
        {pending ? "Opening Lichess…" : label}
      </button>
      {problem && (
        <p role="alert" className={ui.alert}>
          {problem}
        </p>
      )}
    </form>
  );
}
