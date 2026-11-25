"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrganiser } from "@/lib/auth";
import { pendingCookie } from "@/lib/connect-lichess";
import { forgetTeamRemoval, MEMBER_ID_MAX, removeMember } from "@/lib/leaving";
import { SWISS_ID } from "@/lib/lichess";
import { ORGANISER_FLOW, organiserLichessConfigured, startOrganiserConnection } from "@/lib/organiser-lichess";
import { changeSeasonStart, forgetTournamentCancellation, skipMatchday, unskipMatchday, type Said } from "@/lib/reschedule";
import { isSunday } from "@/lib/schedule";

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

// "Done" under a tournament on the Organiser page's list of those to cancel on Lichess by hand, as teamRemovalDone.
export async function tournamentCancelled(form: FormData): Promise<void> {
  await requireOrganiser();
  const id = form.get("lichessTournamentId");
  if (typeof id === "string" && SWISS_ID.test(id)) await forgetTournamentCancellation(id);
  redirect("/organiser");
}

// "Skip" or "Undo" beside a Sunday on the Organiser page: the pressed button's name says which, its value the Sunday.
// Anyone but the Organiser is not found, and nothing changes.
export async function changeSunday(_previous: Said | null, form: FormData): Promise<Said> {
  await requireOrganiser();
  const [skip, unskip] = [form.get("skip"), form.get("unskip")];
  const date = typeof skip === "string" ? skip : unskip;
  if (typeof date !== "string" || !isSunday(date)) return { text: "Choose a Sunday from the list.", problem: true };
  const said = await (typeof skip === "string" ? skipMatchday : unskipMatchday)(date, new Date());
  refresh();
  return said;
}

// "Set start" on the Organiser page: a Season's first Matchday on another Sunday. Anyone but the Organiser is not found,
// and nothing changes.
export async function setStart(_previous: Said | null, form: FormData): Promise<Said> {
  await requireOrganiser();
  const [season, start] = [form.get("season"), form.get("start")];
  if (typeof season !== "string" || !/^[1-9]\d{0,2}$/.test(season)) return { text: "Choose a Season.", problem: true };
  if (typeof start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return { text: "Choose the Sunday it starts on.", problem: true };
  const said = await changeSeasonStart(Number(season), start, new Date());
  refresh();
  return said;
}

// "Remove" on the step that confirms removing a Member (app/organiser/remove): that Member's account deleted, as if they
// had deleted it themselves (lib/leaving.ts), and back to the Organiser page saying so. Anyone but the Organiser is not
// found, and nobody is removed. The Organiser leaves the Club from their Profile, as any Member does, not from here.
export async function removeFromClub(form: FormData): Promise<void> {
  const { id } = await requireOrganiser();
  const memberId = form.get("memberId");
  if (memberId === id) redirect("/organiser?member=self");
  const removed = typeof memberId === "string" && memberId.length <= MEMBER_ID_MAX && (await removeMember(memberId));
  redirect(`/organiser?member=${removed ? "removed" : "gone"}`);
}
