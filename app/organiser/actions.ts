"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrganiser } from "@/lib/auth";
import { pendingCookie } from "@/lib/connect-lichess";
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
