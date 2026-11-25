// Leaving the Club (#15): a person's account deleted, by themselves from their settings or, through the same
// removeMember, by the system for any Member (the Organiser's screen for it is #16).
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
  const problem = lichessId === null ? null : await leaveTeam(lichessId, now, LICHESS_DEADLINE_MS);
  const deleted = await inTransaction(async (q) => {
    const { rowCount } = await q.query(`delete from "user" where id = $1`, [memberId]);
    if (problem) await keepForOrganiser(q, lichessId!, problem);
    return !!rowCount;
  });
  if (deleted && ownToken) await revoke(ownToken, LICHESS_DEADLINE_MS);
  return deleted;
}

// After a Member has switched to another Lichess account (app/api/lichess/callback/route.ts), removes the account they
// had from the Club's Lichess team as removeMember does, giving up on Lichess after `ms` at most, or keeps it for the
// Organiser with why. Unless someone has that account now: the Member themselves, if they did not switch after all or
// have switched back, or another Member who has connected it since. Throws if the database fails.
export async function removeSwitchedFrom(lichessId: string, ms: number): Promise<void> {
  const { rowCount } = await db.query(`select 1 from "user" where "lichessId" = $1`, [lichessId]);
  if (rowCount) return;
  const problem = await leaveTeam(lichessId, new Date(), Math.min(ms, LICHESS_DEADLINE_MS));
  if (problem) await keepForOrganiser(db, lichessId, problem);
}

// Kept once per account, however many removals of it ran at once.
const keepForOrganiser = (q: Queryable, lichessId: string, problem: string) =>
  q.query(
    `insert into "teamRemoval" ("lichessId", "problem") values ($1, $2)
     on conflict ("lichessId") do update set "at" = now(), "problem" = excluded."problem"`,
    [lichessId, problem],
  );

const ended = (why: string) => (why.endsWith(".") ? why : `${why}.`);

// Removes the account from the Club's Lichess team with the Organiser's permission, giving up on Lichess after `ms`: null
// once Lichess has answered that it did, or why not as a sentence for the Organiser. Lichess answers the same when it
// keeps the account because it leads the team (kickFromTeam), so a leader who leaves stays in the team with nothing kept.
async function leaveTeam(lichessId: string, now: Date, ms: number): Promise<string | null> {
  const teamId = process.env.LICHESS_TEAM_ID;
  if (!teamId) return "LICHESS_TEAM_ID is not set, so the Club's Lichess team is not known.";
  const permission = await organiserToken(now);
  if ("problem" in permission) return permission.problem;
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
