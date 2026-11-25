// The Organiser's changes to the schedule (#16): skipping an upcoming Matchday, undoing a skip, and setting a Season's
// start, each made by lib/seasons.ts. A change can leave a tournament the site created on Lichess without a Matchday,
// when its Sunday is no longer one. In the same transaction as the change, each such tournament is cleared from its
// Matchday, so that Collecting results does not look for it, and kept in "tournamentCancellation"; only then is Lichess
// asked to cancel it, with the Organiser's permission, and once Lichess has, the site forgets it. So a change is never
// kept without its tournaments being cleared and kept, nor the other way round, wherever the site stops.
//
// One Lichess has not cancelled, because it refused or could not be reached, the permission could not be used, or the
// site stopped before asking, stays kept with why, for the Organiser to cancel by hand: the Organiser page lists it until
// the Organiser says it is done. Creating Matchdays asks Lichess again at each run (sweepTournaments), which also clears
// any tournament it recorded itself while a change was being made. Until it is cancelled, Members can still join it on
// Lichess, but nothing is collected from it. Should its Sunday become a Matchday again, it is wanted after all: it is
// forgotten here, and Creating Matchdays finds it on the team and records it again (lib/create-matchdays.ts).
//
// Each change refuses one that would change nothing, so that a form sent twice does not make it twice.

import { db, type Queryable } from "./db";
import { sentence } from "./jobs";
import { LICHESS_DEADLINE_MS } from "./leaving";
import { cancelSwiss, timeLimit } from "./lichess";
import { organiserToken, refusedPermission } from "./organiser-lichess";
import { matchdayStart, ZONE } from "./schedule";
import { placesIn, postgresStore, readSchedule, seasonDates, setSeasonStart, skipSunday, unskipSunday, type Store } from "./seasons";
import { postNotice } from "./telegram";
import { inTransaction } from "./transaction";

// What the Organiser is told: what happened, and whether it needs them, as a refusal or a tournament to cancel by hand.
export type Said = { text: string; problem: boolean };

const refusal = (text: string): Said => ({ text, problem: true });

// A Sunday as the Organiser page writes it, "Sunday 29 November".
const sunday = (date: string) =>
  matchdayStart(date).toLocaleDateString("en-GB", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long" });

type Tournament = { date: string; lichessTournamentId: string };
type Cancelled = Tournament & { problem: string | null };

// Why a tournament is kept until Lichess has answered, which is what stays if the site stops before then.
const UNANSWERED = "The site stopped before Lichess said whether it had cancelled it.";

// Makes a change to the schedule, with the Store of the transaction it is made in: `change` returns a refusal, or what
// it did as a sentence. Then asks Lichess to cancel the tournaments the change left without a Matchday.
async function changeSchedule(now: Date, change: (store: Store) => Promise<Said | string>): Promise<Said> {
  const made = await inTransaction(async (q) => {
    const store = postgresStore(q);
    const done = await change(store);
    return typeof done === "string" ? { text: done, stranded: await strand(q, store, now) } : done;
  });
  if (!("stranded" in made)) return made;
  const cancelled = await cancelOnLichess(made.stranded, now);
  // The change's notice for the Telegram group, queued in its transaction (lib/seasons.ts), now that the change is kept;
  // after Lichess, so that Telegram cannot hold up the cancelling. It cannot fail the change, and if it is not sent now
  // the next run of Posting to Telegram sends it.
  await postNotice(now);
  return {
    text: [
      made.text,
      ...cancelled.map(({ date, problem }) =>
        problem
          ? `The site couldn't cancel the tournament for ${sunday(date)} on Lichess: cancel it there by hand, as listed above.`
          : `The tournament for ${sunday(date)} is cancelled on Lichess.`,
      ),
    ].join(" "),
    problem: cancelled.some((c) => c.problem !== null),
  };
}

// `date` is a Sunday ("YYYY-MM-DD"), as each of these three is given it.
export const skipMatchday = (date: string, now: Date) =>
  changeSchedule(now, async (store) => {
    const before = await readSchedule(now, store);
    if (before.skipped.includes(date)) return refusal(`${sunday(date)} is already skipped.`);
    const place = placesIn(before, [date]).get(date);
    if (!place) return refusal(`${sunday(date)} has no Matchday to skip.`);
    const problem = await skipSunday(date, now, store);
    if (problem) return refusal(problem);
    const end = seasonDates(await readSchedule(now, store), place.season)!.at(-1)!;
    return `${sunday(date)} is skipped, so Season ${place.season} now ends on ${sunday(end)}.`;
  });

export const unskipMatchday = (date: string, now: Date) =>
  changeSchedule(now, async (store) => {
    if (!(await readSchedule(now, store)).skipped.includes(date)) return refusal(`${sunday(date)} isn't skipped.`);
    const problem = await unskipSunday(date, now, store);
    if (problem) return refusal(problem);
    return `${sunday(date)} is no longer skipped.`;
  });

// `start` is a "YYYY-MM-DD" date, which setSeasonStart checks is a Sunday.
export const changeSeasonStart = (number: number, start: string, now: Date) =>
  changeSchedule(now, async (store) => {
    if (seasonDates(await readSchedule(now, store), number)?.[0] === start) return refusal(`Season ${number} already starts on ${sunday(start)}.`);
    const problem = await setSeasonStart(number, start, now, store);
    if (problem) return refusal(problem);
    return `Season ${number} now starts on ${sunday(seasonDates(await readSchedule(now, store), number)![0])}.`;
  });

// For Creating Matchdays, at the end of every run: clears and keeps any tournament without a Matchday since the last
// change to the schedule, such as one the job recorded while a change was being made, then asks Lichess again to cancel
// each one kept whose Sunday is still to come. Those Lichess cancelled, as sentences for the run's record.
export async function sweepTournaments(now: Date): Promise<string[]> {
  await inTransaction((q) => strand(q, postgresStore(q), now));
  const kept = (await tournamentCancellations()).filter((t) => matchdayStart(t.date) > now);
  const cancelled = await cancelOnLichess(kept, now);
  return cancelled.filter((c) => c.problem === null).map(({ date }) => `The tournament for ${sunday(date)} is cancelled on Lichess.`);
}

export type Cancellation = { lichessTournamentId: string; date: string; problem: string };

// Every tournament to cancel on Lichess by hand, by its Sunday.
export async function tournamentCancellations(q: Queryable = db): Promise<Cancellation[]> {
  const { rows } = await q.query<Cancellation>(
    `select "lichessTournamentId", to_char("date", 'YYYY-MM-DD') as "date", "problem" from "tournamentCancellation"
     order by "date", "lichessTournamentId"`,
  );
  return rows;
}

// The tournament is cancelled on Lichess, by the Organiser or the site: the site forgets it.
export async function forgetTournamentCancellation(lichessTournamentId: string): Promise<void> {
  await db.query(`delete from "tournamentCancellation" where "lichessTournamentId" = $1`, [lichessTournamentId]);
}

// In the transaction `q`: each tournament recorded for a Matchday that has not started and has no results, whose Sunday
// is no longer a Matchday, cleared from it and kept, until Lichess has answered; and each kept whose Sunday is a Matchday
// again, forgotten. The tournaments it cleared, which no other request at the same time has.
async function strand(q: Queryable, store: Store, now: Date): Promise<Tournament[]> {
  const { rows } = await q.query<{ date: string; lichessTournamentId: string | null }>(
    `select to_char("date", 'YYYY-MM-DD') as "date", "lichessTournamentId" from "matchday"`,
  );
  const kept = await tournamentCancellations(q);
  const places = placesIn(await readSchedule(now, store), [...rows, ...kept].map((t) => t.date));
  const wanted = kept.filter((t) => places.has(t.date)).map((t) => t.date);
  if (wanted.length > 0) await q.query(`delete from "tournamentCancellation" where "date" = any($1::date[])`, [wanted]);
  const stranded: Tournament[] = [];
  for (const { date, lichessTournamentId } of rows.filter((t) => matchdayStart(t.date) > now && !places.has(t.date))) {
    if (lichessTournamentId === null) continue;
    // Only while it has this tournament and no results: the clearing is what decides, as the Matchday may have changed
    // since it was read, or another request cleared it first.
    const { rowCount } = await q.query(
      `delete from "matchday" where "date" = $1 and "lichessTournamentId" = $2 and "ingestedAt" is null`,
      [date, lichessTournamentId],
    );
    if (!rowCount) continue;
    await q.query(
      `insert into "tournamentCancellation" ("lichessTournamentId", "date", "problem") values ($1, $2, $3)
       on conflict ("lichessTournamentId") do update set "date" = excluded."date", "problem" = excluded."problem"`,
      [lichessTournamentId, date, UNANSWERED],
    );
    stranded.push({ date, lichessTournamentId });
  }
  return stranded;
}

// Asks Lichess to cancel each tournament, within one deadline for them all: forgotten once Lichess has, or has no such
// tournament; otherwise kept with why, unless the Organiser has said it is done meanwhile. What became of each.
async function cancelOnLichess(tournaments: Tournament[], now: Date): Promise<Cancelled[]> {
  if (tournaments.length === 0) return [];
  const permission = await organiserToken(now);
  const deadline = timeLimit(LICHESS_DEADLINE_MS, `Lichess took more than ${LICHESS_DEADLINE_MS / 1000} s`);
  try {
    const cancelled: Cancelled[] = [];
    for (const { date, lichessTournamentId } of tournaments) {
      const problem = "problem" in permission ? permission.problem : await tryCancel(lichessTournamentId, permission, deadline.signal);
      if (problem)
        await db.query(`update "tournamentCancellation" set "problem" = $2 where "lichessTournamentId" = $1`, [
          lichessTournamentId,
          `${sentence(problem)}.`,
        ]);
      else await forgetTournamentCancellation(lichessTournamentId);
      cancelled.push({ date, lichessTournamentId, problem });
    }
    return cancelled;
  } finally {
    deadline.clear();
  }
}

// Null once Lichess has cancelled it, or has no such tournament; otherwise why not.
async function tryCancel(lichessTournamentId: string, permission: { token: string; lichessId: string }, signal: AbortSignal) {
  try {
    await cancelSwiss(permission.token, lichessTournamentId, signal);
    return null;
  } catch (error) {
    return refusedPermission(error, permission.lichessId) ?? (error instanceof Error ? error.message : "unknown error");
  }
}
