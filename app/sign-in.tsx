"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function SignIn() {
  const [problem, action, pending] = useActionState(signIn, "");
  return (
    <form action={action}>
      <button disabled={pending}>Sign in with LinkedIn</button>
      {problem && <p role="alert">{problem}</p>}
    </form>
  );
}
