"use client";

import { useFormStatus } from "react-dom";
import ui from "../ui.module.css";

// The Organiser page's Connect Lichess button. It says it is working from the press until the browser leaves for Lichess,
// as the Member's button does (app/connect-lichess.tsx), so a slow start does not look like a press that missed. While
// the permission works it is the quiet button, so that the filled one is there only when connecting is needed.
export function ConnectButton({ label, quiet }: { label: string; quiet: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={quiet ? ui.quiet : undefined} disabled={pending}>
      {pending ? "Opening Lichess…" : label}
    </button>
  );
}
