// What a Recap shows, read from ingested Matchdays: the Matchday Leaderboard with each Member's name and the Company
// they were at that night. Recaps are public, so nothing else about a Member is read: no email, photo or LinkedIn.
// The Awards (#8) are computed from the stored Games and are not read here yet.

import type { Company } from "./companies";
import { db } from "./db";
import { matchdayLeaderboard } from "./leaderboard";
import type { Score } from "./matchday";
import { matchdayOn } from "./matchdays";
import { MEMBER_SQL } from "./members";
import { isRecapDate } from "./schedule";

export type RecapRow = Score & { name: string; company: Pick<Company, "domain" | "name"> | null };
export type Recap = { date: string; lichessTournamentId: string; leaderboard: RecapRow[] };

// The Recap of the Matchday of `date`, as "YYYY-MM-DD", or null if no Matchday of that date has been ingested.
export async function getRecap(date: string): Promise<Recap | null> {
  if (!isRecapDate(date)) return null;
  const matchday = await matchdayOn(date);
  if (!matchday?.ingested || !matchday.lichessTournamentId) return null;
  type Row = Score & { name: string; companyDomain: string | null; companyName: string | null; excluded: boolean };
  // MEMBER_SQL names columns of "user" alone; neither "matchdayResult" nor "company" has any of those names.
  const { rows } = await db.query<Row>(
    `select r."userId" as "memberId", r."rank", r."points", r."rating", u.name,
       c."domain" as "companyDomain", c."name" as "companyName", u."lichessMarked" or u."lichessClosed" as "excluded"
     from "matchdayResult" r join "user" u on u.id = r."userId" left join "company" c on c."domain" = r."companyDomain"
     where r."matchdayDate" = $1 and ${MEMBER_SQL}
     order by r."rank"`,
    [date],
  );
  // A Member whose Lichess account is marked or closed is left out, and the Members after them move up.
  const excluded = new Set(rows.filter((r) => r.excluded).map((r) => r.memberId));
  const shown = rows.map(({ memberId, rank, points, rating, name, companyDomain, companyName }) => ({
    memberId,
    rank,
    points,
    rating,
    name,
    company: companyDomain && companyName ? { domain: companyDomain, name: companyName } : null,
  }));
  return { date, lichessTournamentId: matchday.lichessTournamentId, leaderboard: matchdayLeaderboard(shown, excluded) };
}

// The dates of every ingested Matchday, newest first.
export async function recapDates(): Promise<string[]> {
  const { rows } = await db.query<{ date: string }>(
    `select to_char("date", 'YYYY-MM-DD') as "date" from "matchday" where "ingestedAt" is not null order by "date" desc`,
  );
  return rows.map((row) => row.date);
}
