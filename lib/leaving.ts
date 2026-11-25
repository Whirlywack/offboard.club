// Leaving the Club (#15): a person's account deleted, by themselves from their settings or, through the same
// removeMember, by the Organiser from the Organiser page (#16).
//
// Deleting the "user" row deletes everything that is theirs, as the foreign keys of migrations/ have it: their sign-in
// (sessions and LinkedIn account row), their Profile, their Lichess connection, their results, so that they leave every
// Leaderboard and Recap past and present, and the Organiser's Lichess permission if they connected it. Their Games stay,
// with their side empty, so that opponents keep them in their histories against a former member. A Member's own
// Lichess token was never kept (lib/connect-lichess.ts); the Organiser's is revoked on Lichess as well, so that no copy
// of it, in a backup say, is still worth anything.
//
// Their Lichess account is removed from the Club's Lichess team first, with the Organiser's permission. If that cannot
// be done the deletion goes ahead all the same, and the account is kept in "teamRemoval" with why, for the Organiser to
// remove by hand; the Organiser page lists every one until the Organiser says it is done, which forgets it, or until a
// Member connects it again (lib/connect-lichess.ts). A Member who switches to another Lichess account has the old one
// removed the same way (#44, removeSwitchedFrom).
//
// A Member may connect an account again while Lichess is being asked to remove it, and Lichess may then remove it after
// it joined the team: so once Lichess has, the site looks again at who has it (removedFromTeam). Someone who does is
// kept in "teamRemoval" too, and the Organiser page names them as a Member to ask to connect Lichess again, which adds
// the account to the team and forgets it.

import { revoke } from "./connect-lichess";
import { db, type Queryable } from "./db";
import { kickFromTeam, limitBy, NO_TIME_LEFT } from "./lichess";
import { MEMBER_SQL } from "./members";
import { organiserToken, refusedPermission, tokenConnectedBy } from "./organiser-lichess";
import { inTransaction } from "./transaction";

// Removing someone from the team, and revoking the Organiser's token, each give up on Lichess after this, so that
// leaving never waits on Lichess for long: a rate-limited request alone would wait a minute.
export const LICHESS_DEADLINE_MS = 25_000;

// Both together also end this long after the action that removes someone began, so that the action ends inside the
// 60 s its page allows (its maxDuration) when the Organiser leaves (app/profile/leave), who is removed from the team and
// has their token revoked: reading the session before may take up to 20 s when the database has to be tried twice
// (lib/db.ts), and the deletion and signing out after keep the rest. Anyone else is asked of Lichess one of the two
// only, as only the Organiser's own permission removes from the team, so removing them from the Organiser page
// (app/organiser/remove) fits as it is. The deletion from app/welcome/leave asks Lichess nothing: it deletes only
// someone who has not connected Lichess (deleteSignUp in app/actions.ts), so has no account in the team, and cannot
// have connected the Organiser's permission, which only a Member can.
export const LEAVING_LICHESS_BY_MS = 45_000;

// Deletes the person `memberId`, after removing their Lichess account from the Club's team, for an action that began
// at `started` (in ms). False if there was nobody to delete. Throws if the database fails, having deleted nothing;
// removing them from the team again on a retry is harmless.
export async function removeMember(memberId: string, started = Date.now()): Promise<boolean> {
  const by = started + LEAVING_LICHESS_BY_MS;
  const now = new Date();
  const { rows } = await db.query<{ lichessId: string | null }>(`select "lichessId" from "user" where id = $1`, [memberId]);
  if (!rows[0]) return false;
  const { lichessId } = rows[0];
  const ownToken = await tokenConnectedBy(memberId, now);
  const problem = lichessId === null ? null : await leaveTeam(lichessId, now, by);
  const deleted = await inTransaction(async (q) => {
    const { rows: gone } = await q.query<{ lichessId: string | null }>(`delete from "user" where id = $1 returning "lichessId"`, [memberId]);
    if (lichessId !== null) await (problem ? keepForOrganiser(q, lichessId, problem) : removedFromTeam(q, lichessId));
    // The account they had as they went: another, if a switch was saved while Lichess was being asked, which has joined
    // the team and which nobody's leaving will now remove.
    const switched = gone[0]?.lichessId;
    if (switched && switched !== lichessId) await keepForOrganiser(q, switched, CONNECTED_WHILE_LEAVING);
    return gone.length > 0;
  });
  if (deleted && ownToken) await revoke(ownToken, Math.min(LICHESS_DEADLINE_MS, by - Date.now()));
  return deleted;
}

// Better Auth's ids are 32 characters; anything much longer, sent to the Organiser page, names nobody.
export const MEMBER_ID_MAX = 64;

// Whether the person `id` is a Member, the only people the Organiser removes.
export async function isMember(id: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from "user" where id = $1 and ${MEMBER_SQL}`, [id]);
  return rows.length > 0;
}

export type Removable = { id: string; name: string; lichessUsername: string };

// Every Member but the Organiser, by name, for the Organiser to choose whom to remove; each with their Lichess username,
// which tells two of the same name apart. Sorted here, as English sorts names, not as the database's collation would.
export async function membersToRemove(organiserId: string): Promise<Removable[]> {
  const { rows } = await db.query<Removable>(`select id, name, "lichessUsername" from "user" where id <> $1 and ${MEMBER_SQL}`, [
    organiserId,
  ]);
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en") || a.lichessUsername.localeCompare(b.lichessUsername, "en"));
}

const ended = (why: string) => (why.endsWith(".") ? why : `${why}.`);

// Removes the account from the Club's Lichess team with the Organiser's permission, giving up on Lichess after
// LICHESS_DEADLINE_MS, or at `by` (a time, in ms) if that comes first, and not asking it at all once `by` has come: null
// once Lichess has answered that it did, or why not as a sentence for the Organiser. Lichess answers the same when it
// keeps the account because it leads the team (kickFromTeam), so a leader who leaves stays in the team with nothing
// kept.
async function leaveTeam(lichessId: string, now: Date, by: number): Promise<string | null> {
  const teamId = process.env.LICHESS_TEAM_ID;
  if (!teamId) return "LICHESS_TEAM_ID is not set, so the Club's Lichess team is not known.";
  const permission = await organiserToken(now);
  if ("problem" in permission) return permission.problem;
  // Reckoned only now, once the permission has been read, just before Lichess is asked.
  const deadline = limitBy(by, LICHESS_DEADLINE_MS);
  if (!deadline) return NO_TIME_LEFT;
  try {
    await kickFromTeam(permission.token, teamId, lichessId, deadline.signal);
    return null;
  } catch (error) {
    return ended(refusedPermission(error, permission.lichessId) ?? (error instanceof Error ? error.message : "unknown error"));
  } finally {
    deadline.clear();
  }
}

// After a Member has switched to another Lichess account (app/api/lichess/callback/route.ts), removes the account the
// switch replaced from the Club's Lichess team as removeMember does, giving up on Lichess at `by` if not before, or
// keeps it for the Organiser with why. Unless someone has that account now: the Member themselves, if they "switched"
// to the account they had or have switched back, or another Member who has connected it since; and once Lichess has
// removed it, the site looks again (removedFromTeam). Throws if the database fails.
export async function removeSwitchedFrom(lichessId: string, by: number): Promise<void> {
  const { rowCount } = await db.query(`select 1 from "user" where "lichessId" = $1`, [lichessId]);
  if (rowCount) return;
  const problem = await leaveTeam(lichessId, new Date(), by);
  await (problem ? keepForOrganiser(db, lichessId, problem) : removedFromTeam(db, lichessId));
}

// Why an account is kept for the Organiser when its owner connected it while they were being removed from the Club.
const CONNECTED_WHILE_LEAVING = "Its owner connected it to Offboard while their account was being deleted, so the site didn't remove it from the Club's team.";
// Why the account of someone who has it is kept, once Lichess has removed it from the team.
const OUT_OF_TEAM = "Lichess removed it from the Club's team just as it was connected again.";

// Kept once per account, however many removals of it ran at once, and only while nobody has it: a Member may connect
// it again while Lichess is being asked, and the Organiser must not then be told to remove it.
const keepForOrganiser = (q: Queryable, lichessId: string, problem: string) =>
  q.query(
    `insert into "teamRemoval" ("lichessId", "problem")
     select $1, $2 where not exists (select 1 from "user" where "lichessId" = $1)
     on conflict ("lichessId") do update set "at" = now(), "problem" = excluded."problem"`,
    [lichessId, problem],
  );

// Once Lichess has removed the account from the Club's team, nothing is left to remove by hand, so whatever was kept
// is forgotten; but someone who has the account now is out of the team, and it is kept for the Organiser.
async function removedFromTeam(q: Queryable, lichessId: string) {
  await q.query(`delete from "teamRemoval" where "lichessId" = $1`, [lichessId]);
  await q.query(
    `insert into "teamRemoval" ("lichessId", "problem")
     select $1, $2 where exists (select 1 from "user" where "lichessId" = $1)
     on conflict ("lichessId") do update set "at" = now(), "problem" = excluded."problem"`,
    [lichessId, OUT_OF_TEAM],
  );
}

// An account kept for the Organiser, with why: to remove from the Club's Lichess team by hand, or, when a Member has
// it (`heldBy`, their name), out of the team, for that Member to connect again.
export type TeamRemoval = { lichessId: string; problem: string; heldBy: string | null };

// Every account kept for the Organiser, the oldest first.
export async function teamRemovals(): Promise<TeamRemoval[]> {
  const { rows } = await db.query<TeamRemoval>(
    `select r."lichessId", r."problem", m.name as "heldBy" from "teamRemoval" r
     left join (select name, "lichessId" from "user" where ${MEMBER_SQL}) m on m."lichessId" = r."lichessId"
     order by r."at", r."lichessId"`,
  );
  return rows;
}

// The Organiser has removed the account on Lichess: the site forgets it.
export async function forgetTeamRemoval(lichessId: string): Promise<void> {
  await db.query(`delete from "teamRemoval" where "lichessId" = $1`, [lichessId]);
}
