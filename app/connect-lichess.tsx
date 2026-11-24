"use client";

import { useActionState } from "react";
import { connectLichess } from "./actions";

// Used by the connect step and, to swap accounts, by the Profile edit page.
export function ConnectLichess({ label }: { label: string }) {
  const [problem, action, pending] = useActionState(connectLichess, "");
  return (
    <form action={action}>
      <button disabled={pending}>{label}</button>
      {problem && <p role="alert">{problem}</p>}
    </form>
  );
}
