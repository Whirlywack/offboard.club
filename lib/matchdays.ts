// Matchdays as stored: recording which Lichess tournament is a Matchday's, and ingesting a finished one. lib/matchday.ts
// turns a tournament's exports into scores and Games; this file fetches them from Lichess and keeps them.

import { db, type Queryable } from "./db";
import { getPublicAccounts, getSwiss, SWISS_ID, swissGames, swissResults, teamHasSwiss, type PublicAccount } from "./lichess";
import { ingestMatchday, type Game, type MemberRef, type Score } from "./matchday";
import { MEMBER_SQL } from "./members";
import { isSunday, vilniusDate } from "./schedule";
import { postgres } from "./seasons";
import { inTransaction } from "./transaction";

const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === "23505";

// Records the tournament the site has created on Lichess for the Matchday of `date` (#11), before it is played. True
// once it is that Matchday's tournament, including when it already was; false if the Matchday already has another
// tournament, or the tournament is another Matchday's.
export async function registerTournament(date: string, tournamentId: string, q: Queryable = db): Promise<boolean> {
  try {
    const { rowCount } = await q.query(
      `insert into "matchday" ("date", "lichessTournamentId") values ($1, $2)
       on conflict ("date") do update set "lichessTournamentId" = excluded."lichessTournamentId"
       where "matchday"."lichessTournamentId" is null or "matchday"."lichessTournamentId" = excluded."lichessTournamentId"`,
      [date, tournamentId],
    );
    return rowCount === 1;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

// `participants` counts everyone in the tournament's results, `members` those of them who are Members.
export type Ingestion =
  | { outcome: "ingested"; date: string; participants: number; members: number; games: number; redone: boolean }
  | { outcome: "unchanged"; date: string }
  | { outcome: "refused"; problem: string };

const refused = (problem: string): Ingestion => ({ outcome: "refused", problem });

// Ingests a finished Swiss tournament on the Club's Lichess team as the Matchday of the Vilnius day it started on,
// which must be a Sunday that is not skipped: each
// participating Member's result with their Company at this moment, every Game between two Members, and each such
// Member's blitz rating and marks as Lichess shows them now. Participants who are not Members are left out.
//
// A tournament already ingested is not fetched again, and nothing changes: the stored Matchday is the record of that
// night. A tournament that is unknown, not the Club's, not finished, played by no Member, or at odds with a Matchday
// already stored is refused with a plain message and nothing is stored. Lichess and database failures throw, also
// with nothing stored.
//
// `redo` is the Organiser's deliberate second look, for when a Member was missed, such as one who connected their
// Lichess account only after playing: the tournament is fetched again and its Matchday's results and Games are
// replaced, in one transaction. Members already in it keep the Company recorded the first time.
//
// `signal` gives up on Lichess, which then throws with nothing stored.
export async function ingestTournament(
  tournamentId: string,
  { redo = false, signal }: { redo?: boolean; signal?: AbortSignal } = {},
): Promise<Ingestion> {
  const teamId = process.env.LICHESS_TEAM_ID;
  if (!teamId) return refused("LICHESS_TEAM_ID is not set, so the Club's Lichess team is not known.");
  if (!SWISS_ID.test(tournamentId))
    return refused(`"${tournamentId}" is not a Lichess Swiss tournament id, which is eight letters and digits.`);

  const registered = await matchdayOf(tournamentId);
  if (registered?.ingested && !redo) return { outcome: "unchanged", date: registered.date };
  const redone = !!registered?.ingested;

  const swiss = await getSwiss(tournamentId, signal);
  if (!swiss) return refused(`Lichess has no Swiss tournament ${tournamentId}.`);
  if (!(await teamHasSwiss(teamId, swiss, signal))) return refused(`Tournament ${tournamentId} is not on the Club's Lichess team.`);
  if (swiss.status !== "finished") return refused(`Tournament ${tournamentId} has not finished yet, so it cannot be ingested.`);
  const date = vilniusDate(swiss.startsAt);
  if (!isSunday(date)) return refused(`Tournament ${tournamentId} started on ${date}, which is not a Sunday, so it is not a Matchday.`);
  if ((await postgres.skippedSundays()).includes(date)) return refused(`Sunday ${date} is skipped, so it has no Matchday.`);
  if (registered && registered.date !== date)
    return refused(`Tournament ${tournamentId} is the Matchday of ${registered.date}, but Lichess says it started on ${date}.`);
  const other = (await matchdayOn(date))?.lichessTournamentId;
  if (other && other !== tournamentId) return refused(`The Matchday of ${date} is tournament ${other}, not ${tournamentId}.`);

  const resultsNdjson = await swissResults(tournamentId, signal);
  const gamesNdjson = await swissGames(tournamentId, signal);
  const members = await allMembers();
  const { scores, games } = ingestMatchday(resultsNdjson, gamesNdjson, members);
  const participants = resultsNdjson.split("\n").filter((line) => line.trim()).length;
  // Most likely the Members who played connected other Lichess accounts since; a Matchday stored empty would publish
  // an empty Recap and never be looked at again.
  if (scores.length === 0)
    return refused(`None of the ${participants} participants of tournament ${tournamentId} is a Member.`);
  const lichessIdOf = new Map(members.map((m) => [m.memberId, m.lichessId]));
  const played = scores.map((s) => lichessIdOf.get(s.memberId)!);
  const accounts = await getPublicAccounts(played, signal);

  let stored: boolean;
  try {
    stored = await inTransaction(async (q) => {
      if (redone) {
        if (!(await reclaim(q, date, tournamentId))) return false;
        const recorded = await clear(q, date);
        await storeResults(q, date, scores);
        await keepCompanies(q, date, recorded);
      } else {
        if (!(await claim(q, date, tournamentId))) return false;
        await storeResults(q, date, scores);
      }
      await storeGames(q, date, games);
      await refreshAccounts(q, played, accounts);
      return true;
    });
  } catch (error) {
    // registerTournament put the tournament under another day between the checks above and the claim.
    if (!isUniqueViolation(error) || (error as { constraint?: string }).constraint !== "matchday_lichessTournamentId_key") throw error;
    const now = await matchdayOf(tournamentId);
    return refused(`Tournament ${tournamentId} became the Matchday of ${now?.date ?? "another day"} while it was being ingested.`);
  }
  if (stored) return { outcome: "ingested", date, participants, members: scores.length, games: games.length, redone };
  // Another run ingested it first, or the Matchday of that date changed while this one was fetching.
  const now = await matchdayOf(tournamentId);
  return now?.ingested && !redo
    ? { outcome: "unchanged", date: now.date }
    : refused(`The Matchday of ${date} changed while tournament ${tournamentId} was being ingested.`);
}

async function matchdayOf(tournamentId: string) {
  const { rows } = await db.query<{ date: string; ingested: boolean }>(
    `select to_char("date", 'YYYY-MM-DD') as "date", "ingestedAt" is not null as "ingested" from "matchday" where "lichessTournamentId" = $1`,
    [tournamentId],
  );
  return rows[0] ?? null;
}

// The Matchday of a Vilnius day: its tournament, if known, and whether it has been ingested.
export async function matchdayOn(date: string) {
  const { rows } = await db.query<{ lichessTournamentId: string | null; ingested: boolean }>(
    `select "lichessTournamentId", "ingestedAt" is not null as "ingested" from "matchday" where "date" = $1`,
    [date],
  );
  return rows[0] ?? null;
}

async function allMembers(): Promise<MemberRef[]> {
  const { rows } = await db.query<MemberRef>(`select id as "memberId", "lichessId" from "user" where ${MEMBER_SQL}`);
  return rows;
}

// Marks the Matchday ingested, creating its row for a tournament made by hand. Of several runs at once, only the first
// to get here stores anything: the others wait for it, then find it ingested.
async function claim(q: Queryable, date: string, tournamentId: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values ($1, $2, now())
     on conflict ("date") do update set "lichessTournamentId" = excluded."lichessTournamentId", "ingestedAt" = excluded."ingestedAt"
     where "matchday"."ingestedAt" is null
       and ("matchday"."lichessTournamentId" is null or "matchday"."lichessTournamentId" = excluded."lichessTournamentId")`,
    [date, tournamentId],
  );
  return rowCount === 1;
}

// For a redo: marks the Matchday ingested again, only if it is still this tournament's and ingested, which also holds
// back any other run on it until this one ends.
async function reclaim(q: Queryable, date: string, tournamentId: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `update "matchday" set "ingestedAt" = now() where "date" = $1 and "lichessTournamentId" = $2 and "ingestedAt" is not null`,
    [date, tournamentId],
  );
  return rowCount === 1;
}

// For a redo: removes the Matchday's results and Games, and only that Matchday's. Returns the Company each Member's
// result recorded, null included.
async function clear(q: Queryable, date: string) {
  const { rows } = await q.query<{ userId: string; companyDomain: string | null }>(
    `select "userId", "companyDomain" from "matchdayResult" where "matchdayDate" = $1`,
    [date],
  );
  await q.query(`delete from "game" where "matchdayDate" = $1`, [date]);
  await q.query(`delete from "matchdayResult" where "matchdayDate" = $1`, [date]);
  return rows;
}

// For a redo: puts back the Company recorded the first time for each Member who was in the Matchday then.
async function keepCompanies(q: Queryable, date: string, recorded: { userId: string; companyDomain: string | null }[]) {
  await q.query(
    `update "matchdayResult" r set "companyDomain" = k."companyDomain"
     from unnest($2::text[], $3::text[]) as k ("userId", "companyDomain")
     where r."matchdayDate" = $1 and r."userId" = k."userId"`,
    [date, recorded.map((r) => r.userId), recorded.map((r) => r.companyDomain)],
  );
}

// The Company is read from each Member's row by the same statement that stores the result, so it is theirs at this
// moment; changing Company later leaves it as it was.
async function storeResults(q: Queryable, date: string, scores: Score[]) {
  await q.query(
    `insert into "matchdayResult" ("matchdayDate", "userId", "rank", "points", "rating", "companyDomain")
     select $1::date, r."userId", r."rank", r."points", r."rating", (select u."companyDomain" from "user" u where u.id = r."userId")
     from unnest($2::text[], $3::integer[], $4::double precision[], $5::integer[]) as r ("userId", "rank", "points", "rating")`,
    [date, scores.map((s) => s.memberId), scores.map((s) => s.rank), scores.map((s) => s.points), scores.map((s) => s.rating)],
  );
}

async function storeGames(q: Queryable, date: string, games: Game[]) {
  const column = <T>(value: (g: Game) => T) => games.map(value);
  await q.query(
    `insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt")
     select g."lichessGameId", $1::date, g."whiteId", g."blackId", g."winner", g."status", g."plies", g."whiteRating", g."blackRating", g."winnerClockCentis", g."finishedAt"
     from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::integer[], $8::integer[], $9::integer[], $10::integer[], $11::timestamptz[])
       as g ("lichessGameId", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt")`,
    [
      date,
      column((g) => g.lichessGameId),
      column((g) => g.white),
      column((g) => g.black),
      column((g) => g.winner),
      column((g) => g.status),
      column((g) => g.plies),
      column((g) => g.ratings.white),
      column((g) => g.ratings.black),
      column((g) => g.winnerClockCentis),
      column((g) => new Date(g.finishedAt).toISOString()),
    ],
  );
}

// Each account as Lichess shows it now. One Lichess no longer has at all is closed; a rating it does not give is kept.
// Only a Member still connected to the same account is changed.
async function refreshAccounts(q: Queryable, lichessIds: string[], accounts: PublicAccount[]) {
  const found = new Map(accounts.map((a) => [a.id, a]));
  const shown = lichessIds.map((id) => found.get(id) ?? { id, blitzRating: null, marked: false, closed: true });
  await q.query(
    `update "user" u set "lichessBlitzRating" = coalesce(a."blitzRating", u."lichessBlitzRating"), "lichessMarked" = a."marked", "lichessClosed" = a."closed"
     from unnest($1::text[], $2::integer[], $3::boolean[], $4::boolean[]) as a ("lichessId", "blitzRating", "marked", "closed")
     where u."lichessId" = a."lichessId"`,
    [shown.map((a) => a.id), shown.map((a) => a.blitzRating), shown.map((a) => a.marked), shown.map((a) => a.closed)],
  );
}
