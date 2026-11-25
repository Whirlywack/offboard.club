"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, getSession, linkedInConfigured, requireSignedUp, requireWelcomed } from "@/lib/auth";
import { companyForWebsite } from "@/lib/companies";
import { lichessConfigured, pendingCookie, startConnection } from "@/lib/connect-lichess";
import { consentProblem, mustWelcome } from "@/lib/consent";
import { db } from "@/lib/db";
import { removeMember } from "@/lib/leaving";
import { mustConnectLichess } from "@/lib/members";
import { readProfileForm } from "@/lib/profile";

// Returns a message to show when sign-in cannot start; otherwise goes to LinkedIn.
export async function signIn(): Promise<string> {
  if (!linkedInConfigured) return "Signing in with LinkedIn isn't set up yet. Please try again later.";
  let url: string | undefined;
  try {
    ({ url } = await auth.api.signInSocial({
      body: { provider: "linkedin", callbackURL: "/", newUserCallbackURL: "/welcome" },
      headers: await headers(),
    }));
  } catch (error) {
    console.error("LinkedIn sign-in could not start", error);
  }
  if (!url) return "LinkedIn sign-in isn't working right now. Please try again in a few minutes.";
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
  redirect("/welcome/lichess");
}

// The connect step, and swapping to a different Lichess account from the Profile edit page: off to Lichess to approve.
// Returns a message when connecting cannot start. Lichess sends the person back to app/api/lichess/callback.
export async function connectLichess(): Promise<string> {
  const { id } = await requireWelcomed();
  if (!lichessConfigured()) return "Connecting Lichess isn't set up yet. Please try again later.";
  const { url, cookie } = startConnection(id);
  (await cookies()).set(pendingCookie(cookie));
  redirect(url);
}

// After a submission that could not be saved: why, and what was typed, so the form can show it again.
export type ProfileFormState = {
  problem: string;
  typed: Record<"companyWebsite" | "position" | "linkedInUrl" | "openTo", string>;
} | null;

// The optional Profile fields, from the step after the welcome step or from the edit page. Nothing in the form
// says whose Profile it is: the row changed is always the caller's own.
export async function saveProfile(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const { id } = await requireSignedUp();
  const refuse = (problem: string): ProfileFormState => {
    const typed = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const [companyWebsite, position, linkedInUrl, openTo] = ["companyWebsite", "position", "linkedInUrl", "openTo"].map(typed);
    return { problem, typed: { companyWebsite, position, linkedInUrl, openTo } };
  };
  const fields = readProfileForm(form);
  if (typeof fields === "string") return refuse(fields);
  // Only once everything else is accepted, as it may create a Company and fetch its website.
  const company = await companyForWebsite(id, fields.companyWebsite);
  if ("problem" in company) return refuse(company.problem);
  await db.query(
    `update "user" set "companyDomain" = $2, "position" = $3, "linkedInUrl" = $4, "openTo" = $5, "updatedAt" = now()
     where id = $1`,
    [id, company.domain, fields.position, fields.linkedInUrl, fields.openTo],
  );
  // The step after the welcome step carries on home; the edit page shows the Profile as others see it.
  redirect(form.get("next") === "home" ? "/" : `/profiles/${id}`);
}

// "Delete my account" on the page that confirms it (app/profile/leave): the caller's own account, and nobody else's,
// as nothing in the form says whose it is. Their sessions go with it; signing out clears this browser's cookie.
export async function leaveClub(): Promise<void> {
  const { id } = await requireSignedUp();
  await removeMember(id);
  await auth.api.signOut({ headers: await headers() });
  redirect("/left");
}

// The same for someone part-way through signing up, from the page that confirms it for them (app/welcome/leave). That
// page says nothing of what a Member loses, so anyone who has become a Member since it was shown, in another tab say,
// is sent to their own confirmation instead, with nothing deleted.
export async function deleteSignUp(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");
  if (!mustWelcome(session.user) && !mustConnectLichess(session.user)) redirect("/profile/leave");
  await removeMember(session.user.id);
  await auth.api.signOut({ headers: await headers() });
  redirect("/left");
}
