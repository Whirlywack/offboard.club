"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrganiser } from "@/lib/auth";
import { pendingCookie } from "@/lib/connect-lichess";
import { forgetTeamRemoval } from "@/lib/leaving";
import { ORGANISER_FLOW, organiserLichessConfigured, startOrganiserConnection } from "@/lib/organiser-lichess";

// "Connect Lichess" on the Organiser page: off to Lichess to approve the Organiser's permission, which comes back to
// app/api/lichess/organiser-callback. Anyone but the Organiser is not found, and nothing is started.
export async function connectOrganiserLichess(): Promise<void> {
  const { id } = await requireOrganiser();
  if (!organiserLichessConfigured()) redirect("/organiser?lichess=unset");
  const { url, cookie } = startOrganiserConnection(id);
  (await cookies()).set(pendingCookie(cookie, ORGANISER_FLOW));
  redirect(url);
}

// A Lichess id is at most 30 characters; anything longer names no account the site could have kept.
const LICHESS_ID_MAX = 30;

// "Done" under an account on the Organiser page's list of people to remove from the Lichess team by hand: the
// Organiser has removed it on Lichess, so the site forgets it. Anyone but the Organiser is not found, and nothing is
// forgotten.
export async function teamRemovalDone(form: FormData): Promise<void> {
  await requireOrganiser();
  const lichessId = form.get("lichessId");
  if (typeof lichessId === "string" && lichessId.length <= LICHESS_ID_MAX) await forgetTeamRemoval(lichessId);
  redirect("/organiser");
}
