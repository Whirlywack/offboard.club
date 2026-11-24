"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, getSession, linkedInConfigured } from "@/lib/auth";
import { consentProblem } from "@/lib/consent";
import { db } from "@/lib/db";

// Returns a message to show when sign-in cannot start; otherwise goes to LinkedIn.
export async function signIn(): Promise<string> {
  if (!linkedInConfigured) return "Sign-in with LinkedIn is not set up yet. Please try again later.";
  let url: string | undefined;
  try {
    ({ url } = await auth.api.signInSocial({
      body: { provider: "linkedin", callbackURL: "/", newUserCallbackURL: "/welcome" },
      headers: await headers(),
    }));
  } catch (error) {
    console.error("LinkedIn sign-in could not start", error);
  }
  if (!url) return "Sign-in is not working right now. Please try again in a few minutes.";
  redirect(url);
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}

// The welcome step. Returns a message when a box was not ticked.
export async function consent(_previous: string, form: FormData): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/");
  const problem = consentProblem(form);
  if (problem) return problem;
  // coalesce keeps the first timestamps if the form is ever sent twice.
  await db.query(
    `update "user" set "publicDisplayConsentAt" = coalesce("publicDisplayConsentAt", now()),
       "houseRulesAcceptedAt" = coalesce("houseRulesAcceptedAt", now()), "updatedAt" = now()
     where id = $1`,
    [session.user.id],
  );
  redirect("/");
}
