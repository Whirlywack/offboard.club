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

import { revoke } from "./connect-lichess";
import { db, type Queryable } from "./db";
import { kickFromTeam, timeLimit } from "./lichess";
import { MEMBER_SQL } from "./members";
import { organiserToken, refusedPermission, tokenConnectedBy } from "./organiser-lichess";
import { inTransaction } from "./transaction";

// Removing someone from the team, and revoking the Organiser's token, each give up on Lichess after this, so that
// leaving never waits on Lichess for long: a rate-limited request alone would wait a minute. Both fit in the 60 s that
// app/profile/leave allows its action (its maxDuration). The deletion from app/welcome/leave asks Lichess nothing and
// has no such limit: it deletes only someone who has not connected Lichess (deleteSignUp in app/actions.ts), so has no
// account in the team, and cannot have connected the Organiser's permission, which only a Member can.
export const LICHESS_DEADLINE_MS = 25_000;

// Deletes the person `memberId`, after removing their Lichess account from the Club's team. False if there was nobody
// to delete. Throws if the database fails, having deleted nothing; removing them from the team again on a retry is
// harmless.
export async function removeMember(memberId: string): Promise<boolean> {
  const now = new Date();
  const { rows } = await db.query<{ lichessId: string | null }>(`select "lichessId" from "user" where id = $1`, [memberId]);
  if (!rows[0]) return false;
  const { lichessId } = rows[0];
  const ownToken = await tokenConnectedBy(memberId, now);
  const problem = lichessId === null ? null : await leaveTeam(lichessId, now);
  const deleted = await inTransaction(async (q) => {
    const { rowCount } = await q.query(`delete from "user" where id = $1`, [memberId]);
    if (problem) await keepForOrganiser(q, lichessId!, problem);
    return !!rowCount;
  });
  if (deleted && ownToken) await revoke(ownToken, LICHESS_DEADLINE_MS);
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
// LICHESS_DEADLINE_MS, or at `by` (a time, in ms) if that comes first: null once Lichess has answered that it did, or
// why not as a sentence for the Organiser. Lichess answers the same when it keeps the account because it leads the team
// (kickFromTeam), so a leader who leaves stays in the team with nothing kept.
async function leaveTeam(lichessId: string, now: Date, by = Infinity): Promise<string | null> {
  const teamId = process.env.LICHESS_TEAM_ID;
  if (!teamId) return "LICHESS_TEAM_ID is not set, so the Club's Lichess team is not known.";
  const permission = await organiserToken(now);
  if ("problem" in permission) return permission.problem;
  // Reckoned only now, once the permission has been read, just before Lichess is asked.
  const ms = Math.min(LICHESS_DEADLINE_MS, by - Date.now());
  const deadline = timeLimit(ms, `Lichess took more than ${ms / 1000} s`);
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
// to the account they had or have switched back, or another Member who has connected it since. Throws if the database
// fails.
export async function removeSwitchedFrom(lichessId: string, by: number): Promise<void> {
  const { rowCount } = await db.query(`select 1 from "user" where "lichessId" = $1`, [lichessId]);
  if (rowCount) return;
  const problem = await leaveTeam(lichessId, new Date(), by);
  if (problem) await keepForOrganiser(db, lichessId, problem);
}

// Kept once per account, however many removals of it ran at once, and only while nobody has it: a Member may connect
// it again while Lichess is being asked, and the Organiser must not then be told to remove it.
const keepForOrganiser = (q: Queryable, lichessId: string, problem: string) =>
  q.query(
    `insert into "teamRemoval" ("lichessId", "problem")
     select $1, $2 where not exists (select 1 from "user" where "lichessId" = $1)
     on conflict ("lichessId") do update set "at" = now(), "problem" = excluded."problem"`,
    [lichessId, problem],
  );

// An account still to remove from the Club's Lichess team by hand, with why the site could not.
export type TeamRemoval = { lichessId: string; problem: string };

// Every account still to remove from the team by hand, the oldest first.
export async function teamRemovals(): Promise<TeamRemoval[]> {
  const { rows } = await db.query<TeamRemoval>(`select "lichessId", "problem" from "teamRemoval" order by "at", "lichessId"`);
  return rows;
}

// The Organiser has removed the account on Lichess: the site forgets it.
export async function forgetTeamRemoval(lichessId: string): Promise<void> {
  await db.query(`delete from "teamRemoval" where "lichessId" = $1`, [lichessId]);
}
