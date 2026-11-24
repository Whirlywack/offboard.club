"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, getSession, linkedInConfigured, requireSignedUp } from "@/lib/auth";
import { consentProblem } from "@/lib/consent";
import { db } from "@/lib/db";
import { readProfileForm } from "@/lib/profile";

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
  redirect("/welcome/profile");
}

// After a submission that could not be saved: why, and what was typed, so the form can show it again.
export type ProfileFormState = { problem: string; typed: Record<"position" | "linkedInUrl" | "openTo", string> } | null;

// The optional Profile fields, from the step after the welcome step or from the edit page. Nothing in the form
// says whose Profile it is: the row changed is always the caller's own.
export async function saveProfile(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const { id } = await requireSignedUp();
  const fields = readProfileForm(form);
  if (typeof fields === "string") {
    const typed = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    return { problem: fields, typed: { position: typed("position"), linkedInUrl: typed("linkedInUrl"), openTo: typed("openTo") } };
  }
  await db.query(
    `update "user" set "position" = $2, "linkedInUrl" = $3, "openTo" = $4, "updatedAt" = now() where id = $1`,
    [id, fields.position, fields.linkedInUrl, fields.openTo],
  );
  // The step after the welcome step carries on home; the edit page shows the Profile as others see it.
  redirect(form.get("next") === "home" ? "/" : `/profiles/${id}`);
}
