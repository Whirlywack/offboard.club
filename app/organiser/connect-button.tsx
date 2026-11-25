"use client";

import { useFormStatus } from "react-dom";

// The Organiser page's Connect Lichess button. It says it is working from the press until the browser leaves for Lichess,
// as the Member's button does (app/connect-lichess.tsx), so a slow start does not look like a press that missed.
export function ConnectButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? "Opening Lichess…" : label}</button>;
}
