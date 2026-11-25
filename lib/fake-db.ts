// For tests only: the database's "user", "company", "matchday", "matchdayResult", "game", "season", "skippedSunday",
// "organiserLichess", "scheduledJob", "jobFailure", "teamRemoval" and "telegramPost" tables in memory, standing
// in for lib/db.ts with vi.mock("@/lib/db", () => import("@/lib/fake-db")). It knows each statement the app sends by its
// full text, written out again below, and throws on any other: a condition dropped from a query in the app fails the
// tests instead of passing unnoticed. Each statement answers a moment later, so callers running at once interleave,
// and then runs whole, as one Postgres statement does, enforcing the keys and foreign keys of migrations/ as Postgres
// would. A transaction (inTransaction) holds every other transaction back until it ends, and a rollback restores every
// table as it was at its start; statements outside a transaction are not held back.
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { Queryable } from "./db";

export type Person = {
  id: string;
  name: string;
  image: string | null;
  position: string | null;
  linkedInUrl: string | null;
  openTo: string | null;
  publicDisplayConsentAt: Date | null;
  houseRulesAcceptedAt: Date | null;
  lichessId: string | null;
  lichessUsername: string | null;
  lichessBlitzRating: number | null;
  lichessConnectedAt: Date | null;
  lichessMarked: boolean;
  lichessClosed: boolean;
  companyDomain: string | null;
  companiesCreatedOn: string | null;
  companiesCreatedThatDay: number;
};
export type CompanyRow = {
  domain: string;
  name: string;
  logoUrl: string | null;
  fetchedAt: Date | null;
  fetchTriedAt: Date;
  fetchAttempts: number;
};
// Dates are "YYYY-MM-DD", as to_char gives them.
export type MatchdayRow = { date: string; lichessTournamentId: string | null; ingestedAt: Date | null };
export type ResultRow = {
  matchdayDate: string;
  userId: string;
  rank: number;
  points: number;
  rating: number;
  companyDomain: string | null;
};
export type GameRow = {
  lichessGameId: string;
  matchdayDate: string;
  whiteId: string | null;
  blackId: string | null;
  winner: "white" | "black" | null;
  status: string;
  plies: number;
  whiteRating: number;
  blackRating: number;
  winnerClockCentis: number | null;
  finishedAt: Date;
};

export type SeasonRow = { number: number; start: string };
export type OrganiserLichessRow = {
  userId: string;
  lichessId: string;
  scopes: string;
  token: string;
  expiresAt: Date;
  connectedAt: Date;
};
export type ScheduledJobRow = {
  job: string;
  lockedBy: string | null;
  lockedUntil: Date | null;
  lastRunAt: Date | null;
  lastOutcome: "done" | "skipped" | "failed" | null;
  lastDetail: string | null;
};
export type JobFailureRow = { id: number; job: string; at: Date; matchdayDate: string | null; problem: string };
export type TeamRemovalRow = { lichessId: string; at: Date; problem: string };
// `order` stands for the moment it was queued: each statement here is its own transaction, and Postgres's now() is
// later in each, even within one millisecond.
export type TelegramPostRow = {
  key: string;
  text: string;
  until: Date;
  createdAt: Date;
  claimedAt: Date | null;
  sentAt: Date | null;
  order: number;
};

export const people = new Map<string, Person>();
export const companies = new Map<string, CompanyRow>();
export const matchdays = new Map<string, MatchdayRow>(); // by date
export const results = new Map<string, ResultRow>(); // by `${matchdayDate} ${userId}`
export const games = new Map<string, GameRow>(); // by lichessGameId
export const seasons = new Map<number, SeasonRow>(); // the "season" table, by number
export const skippedSundays = new Map<string, { date: string }>(); // by date
export const organiserLichess = new Map<string, OrganiserLichessRow>(); // at most one row, by "singleton"
export const scheduledJobs = new Map<string, ScheduledJobRow>(); // by job
export const jobFailures = new Map<string, JobFailureRow>(); // by String(id)
export const teamRemovals = new Map<string, TeamRemovalRow>(); // by lichessId
export const telegramPosts = new Map<string, TelegramPostRow>(); // by key

const welcomedAt = new Date("2026-11-24T18:00:00Z");

// A Member, who has finished the welcome step and connected Lichess, and filled in nothing else, unless told otherwise.
export function addPerson(id: string, details: Partial<Person> = {}): Person {
  const person: Person = {
    id,
    name: `Person ${id}`,
    image: null,
    position: null,
    linkedInUrl: null,
    openTo: null,
    publicDisplayConsentAt: welcomedAt,
    houseRulesAcceptedAt: welcomedAt,
    lichessId: `lichess-${id}`,
    lichessUsername: `Lichess-${id}`,
    lichessBlitzRating: 1500,
    lichessConnectedAt: welcomedAt,
    lichessMarked: false,
    lichessClosed: false,
    companyDomain: null,
    companiesCreatedOn: null,
    companiesCreatedThatDay: 0,
    ...details,
  };
  people.set(id, person);
  return person;
}

// A Company whose website was fetched at the first attempt, unless told otherwise.
export function addCompany(domain: string, name: string, logoUrl: string | null = null, details: Partial<CompanyRow> = {}) {
  const company = { domain, name, logoUrl, fetchedAt: new Date(), fetchTriedAt: new Date(), fetchAttempts: 1, ...details };
  companies.set(domain, company);
  return company;
}

const tables = {
  people,
  companies,
  matchdays,
  results,
  games,
  seasons,
  skippedSundays,
  organiserLichess,
  scheduledJobs,
  jobFailures,
  teamRemovals,
  telegramPosts,
};
let lastFailureId = 0;
let lastPostOrder = 0;

export function resetDb() {
  for (const table of Object.values(tables)) table.clear();
  lastFailureId = 0;
  lastPostOrder = 0;
  ended = Promise.resolve();
  db.query.mockClear();
  db.connect.mockClear();
}

const answer = (rows: object[] = [], rowCount = rows.length) => ({ rows, rowCount });
// lib/members.ts, written out again so that a change to it shows here.
const isMember = (person?: Person): person is Person =>
  !!person && person.publicDisplayConsentAt !== null && person.houseRulesAcceptedAt !== null && person.lichessId !== null;
const aMinuteAgo = () => new Date(Date.now() - 60_000);

// Postgres's errors for a duplicate key and a missing referenced row, by their SQLSTATE codes.
const violation = (code: "23505" | "23503", constraint: string) =>
  Object.assign(new Error(`${code === "23505" ? "duplicate key value violates unique" : "violates foreign key"} constraint "${constraint}"`), { code, constraint });

type Params = [string, string, unknown, unknown, unknown, ...unknown[]];
// A statement's parameters as the app sends them, for statements that take arrays.
const given = <T extends unknown[]>(params: unknown[]) => params as T;

// registerTournament and the ingestion's claim: insert into "matchday", or on a conflict on "date" update the row only
// when `may` allows. The tournament id is unique across rows, as its unique constraint makes it.
function upsertMatchday(date: string, lichessTournamentId: string, ingestedAt: Date | null, may: (row: MatchdayRow) => boolean) {
  const row = matchdays.get(date);
  const unique = () => {
    if ([...matchdays.values()].some((m) => m.date !== date && m.lichessTournamentId === lichessTournamentId))
      throw violation("23505", "matchday_lichessTournamentId_key");
  };
  if (!row) {
    unique();
    matchdays.set(date, { date, lichessTournamentId, ingestedAt });
    return answer([], 1);
  }
  if (!may(row)) return answer([], 0);
  unique();
  Object.assign(row, { lichessTournamentId, ...(ingestedAt && { ingestedAt }) });
  return answer([], 1);
}

const sameTournamentOrNone = (row: MatchdayRow, id: string) => row.lichessTournamentId === null || row.lichessTournamentId === id;

// A post queued for the Telegram group, unless its key is taken, as the primary key has it.
function addPost(key: string, text: unknown, until: unknown) {
  if (telegramPosts.has(key)) return answer([], 0);
  const row = { key, text: String(text), until: new Date(until as Date), createdAt: new Date(), claimedAt: null, sentAt: null, order: ++lastPostOrder };
  telegramPosts.set(key, row);
  return answer([], 1);
}

// A change's notice, queued under "notice:" and a random id unless the notice is null.
const notice = (text: unknown, until: unknown) => (text === null ? answer([], 0) : addPost(`notice:${randomUUID()}`, text, until));

// A string's match for a LIKE pattern whose only wildcard is a "%" at its end, as the app's are.
const likePrefix = (value: string, pattern: string) => value.startsWith(pattern.replace(/%$/, ""));
const statements: Record<string, (...params: Params) => ReturnType<typeof answer>> = {
  // getProfile
  [`select u.id, u.name, u.image, u."position", u."linkedInUrl", u."openTo", u."lichessUsername", u."lichessBlitzRating", c."domain" as "companyDomain", c."name" as "companyName", c."logoUrl" as "companyLogoUrl" from "user" u left join "company" c on c."domain" = u."companyDomain" where u.id = $1 and "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null`]:
    (id) => {
      const person = people.get(id);
      if (!isMember(person)) return answer();
      const { name, image, position, linkedInUrl, openTo, lichessUsername, lichessBlitzRating, companyDomain } = person;
      const company = companyDomain ? companies.get(companyDomain) : undefined;
      return answer([
        {
          id,
          name,
          image,
          position,
          linkedInUrl,
          openTo,
          lichessUsername,
          lichessBlitzRating,
          companyDomain: company?.domain ?? null,
          companyName: company?.name ?? null,
          companyLogoUrl: company?.logoUrl ?? null,
        },
      ]);
    },

  // --- A Profile's history (lib/history.ts) ---

  // matchdaysOf: every ingested Matchday, oldest first, with the Member's points if they played it.
  [`select r."points" from "matchday" m left join "matchdayResult" r on r."matchdayDate" = m."date" and r."userId" = $1 where m."ingestedAt" is not null order by m."date"`]:
    (memberId) =>
      answer(
        [...matchdays.values()]
          .filter((m) => m.ingestedAt !== null)
          .sort((a, b) => (a.date < b.date ? -1 : 1))
          .map((m) => ({ points: results.get(`${m.date} ${memberId}`)?.points ?? null })),
      ),

  // gamesOf: the Member's latest Games, $2 of them, Matchday by Matchday, each with the opponent if they are a Member, and
  // how many there are in all. A side whose player has left is null, so it joins nobody.
  [`select g."lichessGameId", to_char(g."matchdayDate", 'YYYY-MM-DD') as "date", g."whiteId", g."blackId", g."winner", o.id as "opponentId", o.name as "opponentName", (count(*) over ())::int as "total" from "game" g left join "user" o on o.id = case when g."whiteId" = $1 then g."blackId" else g."whiteId" end and "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null where g."whiteId" = $1 or g."blackId" = $1 order by g."matchdayDate" desc, g."finishedAt" desc, g."lichessGameId" desc limit $2`]:
    (memberId, limit) => {
      const descending = (a: string | number, b: string | number) => (a < b ? 1 : a > b ? -1 : 0);
      const theirs = [...games.values()]
        .filter((g) => g.whiteId === memberId || g.blackId === memberId)
        .sort(
          (a, b) =>
            descending(a.matchdayDate, b.matchdayDate) ||
            descending(a.finishedAt.getTime(), b.finishedAt.getTime()) ||
            descending(a.lichessGameId, b.lichessGameId),
        );
      return answer(
        theirs.slice(0, Number(limit)).map((g) => {
          const opponentId = g.whiteId === memberId ? g.blackId : g.whiteId;
          const opponent = opponentId === null ? undefined : people.get(opponentId);
          return {
            lichessGameId: g.lichessGameId,
            date: g.matchdayDate,
            whiteId: g.whiteId,
            blackId: g.blackId,
            winner: g.winner,
            opponentId: isMember(opponent) ? opponent.id : null,
            opponentName: isMember(opponent) ? opponent.name : null,
            total: theirs.length,
          };
        }),
      );
    },

  // gamesBetween: every Game between two Members, either way round, with its sides and winner.
  [`select "whiteId", "blackId", "winner" from "game" where ("whiteId" = $1 and "blackId" = $2) or ("whiteId" = $2 and "blackId" = $1)`]:
    (one, other) =>
      answer(
        [...games.values()]
          .filter((g) => (g.whiteId === one && g.blackId === other) || (g.whiteId === other && g.blackId === one))
          .map(({ whiteId, blackId, winner }) => ({ whiteId, blackId, winner })),
      ),

  // countSignUps
  [`select count(*)::int as n from "user" where "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null`]:
    () => answer([{ n: [...people.values()].filter(isMember).length }]),

  // currentCompany
  [`select c."domain", c."name" from "user" u join "company" c on c."domain" = u."companyDomain" where u.id = $1`]: (id) => {
    const domain = people.get(id)?.companyDomain;
    const company = domain ? companies.get(domain) : undefined;
    return answer(company ? [{ domain: company.domain, name: company.name }] : []);
  },

  [`select 1 from "company" where "domain" = $1`]: (domain) => answer(companies.has(domain) ? [{}] : []),

  // The retry of a Company whose website gave nothing; $2 is the most attempts in all.
  [`update "company" set "fetchTriedAt" = now(), "fetchAttempts" = "fetchAttempts" + 1 where "domain" = $1 and "fetchedAt" is null and "fetchAttempts" < $2 and "fetchTriedAt" < now() - interval '1 minute'`]:
    (domain, most) => {
      const company = companies.get(domain);
      if (!company || company.fetchedAt !== null || !(company.fetchAttempts < Number(most))) return answer();
      if (!(company.fetchTriedAt < aMinuteAgo())) return answer();
      company.fetchTriedAt = new Date();
      company.fetchAttempts++;
      return answer([], 1);
    },

  // takeNewCompanySlot
  [`update "user" set "companiesCreatedThatDay" = case when "companiesCreatedOn" = $2 then "companiesCreatedThatDay" + 1 else 1 end, "companiesCreatedOn" = $2 where id = $1 and ("companiesCreatedOn" is distinct from $2 or "companiesCreatedThatDay" < $3)`]:
    (id, today, most) => {
      const person = people.get(id);
      if (!person || !(person.companiesCreatedOn !== today || person.companiesCreatedThatDay < Number(most))) return answer();
      person.companiesCreatedThatDay = person.companiesCreatedOn === today ? person.companiesCreatedThatDay + 1 : 1;
      person.companiesCreatedOn = today;
      return answer([], 1);
    },

  // giveBackNewCompanySlot
  [`update "user" set "companiesCreatedThatDay" = "companiesCreatedThatDay" - 1 where id = $1 and "companiesCreatedOn" = $2 and "companiesCreatedThatDay" > 0`]:
    (id, today) => {
      const person = people.get(id);
      if (!person || person.companiesCreatedOn !== today || !(person.companiesCreatedThatDay > 0)) return answer();
      person.companiesCreatedThatDay--;
      return answer([], 1);
    },

  [`insert into "company" ("domain", "name", "fetchAttempts") values ($1, $1, 1) on conflict ("domain") do nothing`]: (domain) => {
    if (companies.has(domain)) return answer([], 0);
    companies.set(domain, { domain, name: domain, logoUrl: null, fetchedAt: null, fetchTriedAt: new Date(), fetchAttempts: 1 });
    return answer([], 1);
  },

  // nameFromWebsite
  [`update "company" set "name" = $2, "logoUrl" = $3, "fetchedAt" = now() where "domain" = $1 and "fetchedAt" is null`]:
    (domain, name, logoUrl) => {
      const company = companies.get(domain);
      if (!company || company.fetchedAt !== null) return answer();
      Object.assign(company, { name, logoUrl, fetchedAt: new Date() });
      return answer([], 1);
    },

  // saveProfile. The person's Company must exist, as the foreign key requires.
  [`update "user" set "companyDomain" = $2, "position" = $3, "linkedInUrl" = $4, "openTo" = $5, "updatedAt" = now() where id = $1`]:
    (id, companyDomain, position, linkedInUrl, openTo) => {
      if (companyDomain !== null && !companies.has(companyDomain))
        throw new Error(`no Company ${companyDomain}: foreign key violated`);
      const person = people.get(id);
      if (!person) return answer();
      Object.assign(person, { companyDomain, position, linkedInUrl, openTo });
      return answer([], 1);
    },

  // --- Matchdays (lib/matchdays.ts) ---

  // registerTournament
  [`insert into "matchday" ("date", "lichessTournamentId") values ($1, $2) on conflict ("date") do update set "lichessTournamentId" = excluded."lichessTournamentId" where "matchday"."lichessTournamentId" is null or "matchday"."lichessTournamentId" = excluded."lichessTournamentId"`]:
    (date, id) => upsertMatchday(date, id, null, (row) => sameTournamentOrNone(row, id)),

  // The ingestion's claim on its Matchday.
  [`insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values ($1, $2, now()) on conflict ("date") do update set "lichessTournamentId" = excluded."lichessTournamentId", "ingestedAt" = excluded."ingestedAt" where "matchday"."ingestedAt" is null and ("matchday"."lichessTournamentId" is null or "matchday"."lichessTournamentId" = excluded."lichessTournamentId")`]:
    (date, id) => upsertMatchday(date, id, new Date(), (row) => row.ingestedAt === null && sameTournamentOrNone(row, id)),

  // A redo's claim on its Matchday.
  [`update "matchday" set "ingestedAt" = now() where "date" = $1 and "lichessTournamentId" = $2 and "ingestedAt" is not null`]: (date, id) => {
    const row = matchdays.get(date);
    if (!row || row.lichessTournamentId !== id || row.ingestedAt === null) return answer();
    row.ingestedAt = new Date();
    return answer([], 1);
  },

  // A redo clearing its Matchday, keeping each result's Company first.
  [`select "userId", "companyDomain" from "matchdayResult" where "matchdayDate" = $1`]: (date) =>
    answer([...results.values()].filter((r) => r.matchdayDate === date).map(({ userId, companyDomain }) => ({ userId, companyDomain }))),
  [`delete from "game" where "matchdayDate" = $1 and "whiteId" is not null and "blackId" is not null`]: (date) => {
    const gone = [...games.values()].filter((g) => g.matchdayDate === date && g.whiteId !== null && g.blackId !== null);
    for (const game of gone) games.delete(game.lichessGameId);
    return answer([], gone.length);
  },
  [`delete from "matchdayResult" where "matchdayDate" = $1`]: (date) => {
    const gone = [...results.values()].filter((r) => r.matchdayDate === date);
    for (const result of gone) results.delete(`${date} ${result.userId}`);
    return answer([], gone.length);
  },

  // keepCompanies
  [`update "matchdayResult" r set "companyDomain" = k."companyDomain" from unnest($2::text[], $3::text[]) as k ("userId", "companyDomain") where r."matchdayDate" = $1 and r."userId" = k."userId"`]:
    (...params) => {
      const [date, userIds, domains] = given<[string, string[], (string | null)[]]>(params);
      let changed = 0;
      userIds.forEach((userId, i) => {
        const result = results.get(`${date} ${userId}`);
        if (!result) return;
        result.companyDomain = domains[i];
        changed++;
      });
      return answer([], changed);
    },

  // matchdayOf
  [`select to_char("date", 'YYYY-MM-DD') as "date", "ingestedAt" is not null as "ingested" from "matchday" where "lichessTournamentId" = $1`]:
    (id) => answer([...matchdays.values()].filter((m) => m.lichessTournamentId === id).map((m) => ({ date: m.date, ingested: m.ingestedAt !== null }))),

  // matchdayOn
  [`select "lichessTournamentId", "ingestedAt" is not null as "ingested" from "matchday" where "date" = $1`]: (date) => {
    const row = matchdays.get(date);
    return answer(row ? [{ lichessTournamentId: row.lichessTournamentId, ingested: row.ingestedAt !== null }] : []);
  },

  // The skipped Sundays (lib/seasons.ts, postgresStore)
  [`select to_char("date", 'YYYY-MM-DD') as "date" from "skippedSunday"`]: () => answer([...skippedSundays.values()]),

  // allMembers
  [`select id as "memberId", "lichessId" from "user" where "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null`]:
    () => answer([...people.values()].filter(isMember).map((p) => ({ memberId: p.id, lichessId: p.lichessId }))),

  // storeResults: each Member's Company is read from their row by the same statement.
  [`insert into "matchdayResult" ("matchdayDate", "userId", "rank", "points", "rating", "companyDomain") select $1::date, r."userId", r."rank", r."points", r."rating", (select u."companyDomain" from "user" u where u.id = r."userId") from unnest($2::text[], $3::integer[], $4::double precision[], $5::integer[]) as r ("userId", "rank", "points", "rating")`]:
    (...params) => {
      const [date, userIds, ranks, points, ratings] = given<[string, string[], number[], number[], number[]]>(params);
      if (!matchdays.has(date)) throw violation("23503", "matchdayResult_matchdayDate_fkey");
      const rows = userIds.map((userId, i) => ({
        matchdayDate: date,
        userId,
        rank: ranks[i],
        points: points[i],
        rating: ratings[i],
        companyDomain: people.get(userId)?.companyDomain ?? null,
      }));
      const existing = [...results.values()].filter((r) => r.matchdayDate === date);
      for (const [i, row] of rows.entries()) {
        if (!people.has(row.userId)) throw violation("23503", "matchdayResult_userId_fkey");
        if ([...existing, ...rows.slice(0, i)].some((r) => r.userId === row.userId)) throw violation("23505", "matchdayResult_pkey");
        if ([...existing, ...rows.slice(0, i)].some((r) => r.rank === row.rank)) throw violation("23505", "matchdayResult_matchdayDate_rank_key");
      }
      for (const row of rows) results.set(`${date} ${row.userId}`, row);
      return answer([], rows.length);
    },

  // storeGames: a Game already stored under the same id is left as it is.
  [`insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt") select g."lichessGameId", $1::date, g."whiteId", g."blackId", g."winner", g."status", g."plies", g."whiteRating", g."blackRating", g."winnerClockCentis", g."finishedAt" from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::integer[], $8::integer[], $9::integer[], $10::integer[], $11::timestamptz[]) as g ("lichessGameId", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt") on conflict ("lichessGameId") do nothing`]:
    (...params) => {
      const [date, ids, whiteIds, blackIds, winners, statuses, plies, whiteRatings, blackRatings, clocks, finishedAt] =
        given<[string, string[], string[], string[], GameRow["winner"][], string[], number[], number[], number[], (number | null)[], string[]]>(params);
      if (!matchdays.has(date)) throw violation("23503", "game_matchdayDate_fkey");
      const proposed: GameRow[] = ids.map((lichessGameId, i) => ({
        lichessGameId,
        matchdayDate: date,
        whiteId: whiteIds[i],
        blackId: blackIds[i],
        winner: winners[i],
        status: statuses[i],
        plies: plies[i],
        whiteRating: whiteRatings[i],
        blackRating: blackRatings[i],
        winnerClockCentis: clocks[i],
        finishedAt: new Date(finishedAt[i]),
      }));
      // A row whose id is stored already, or comes earlier in the same statement, is not inserted.
      const rows = proposed.filter((row, i) => !games.has(row.lichessGameId) && !proposed.slice(0, i).some((r) => r.lichessGameId === row.lichessGameId));
      for (const row of rows) {
        if (row.whiteId !== null && !people.has(row.whiteId)) throw violation("23503", "game_whiteId_fkey");
        if (row.blackId !== null && !people.has(row.blackId)) throw violation("23503", "game_blackId_fkey");
        if (row.winner === null && row.winnerClockCentis !== null) throw new Error('violates check constraint on "game"');
      }
      for (const row of rows) games.set(row.lichessGameId, row);
      return answer([], rows.length);
    },

  // refreshAccounts: only rows still connected to the same Lichess account.
  [`update "user" u set "lichessBlitzRating" = coalesce(a."blitzRating", u."lichessBlitzRating"), "lichessMarked" = a."marked", "lichessClosed" = a."closed" from unnest($1::text[], $2::integer[], $3::boolean[], $4::boolean[]) as a ("lichessId", "blitzRating", "marked", "closed") where u."lichessId" = a."lichessId"`]:
    (...params) => {
      const [lichessIds, ratings, marked, closed] = given<[string[], (number | null)[], boolean[], boolean[]]>(params);
      let changed = 0;
      for (const person of people.values()) {
        const i = lichessIds.indexOf(person.lichessId ?? "");
        if (person.lichessId === null || i < 0) continue;
        Object.assign(person, {
          lichessBlitzRating: ratings[i] ?? person.lichessBlitzRating,
          lichessMarked: marked[i],
          lichessClosed: closed[i],
        });
        changed++;
      }
      return answer([], changed);
    },

  // --- Recaps (lib/recaps.ts) ---

  // getRecap: the Members' results in Lichess's order, with the Company each was at that night.
  [`select r."userId" as "memberId", r."rank", r."points", r."rating", u.name, c."domain" as "companyDomain", c."name" as "companyName", u."lichessMarked" or u."lichessClosed" as "excluded" from "matchdayResult" r join "user" u on u.id = r."userId" left join "company" c on c."domain" = r."companyDomain" where r."matchdayDate" = $1 and "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null order by r."rank"`]:
    (date) =>
      answer(
        [...results.values()]
          .filter((r) => r.matchdayDate === date && isMember(people.get(r.userId)))
          .sort((a, b) => a.rank - b.rank)
          .map((r) => {
            const person = people.get(r.userId)!;
            const company = r.companyDomain ? companies.get(r.companyDomain) : undefined;
            return {
              memberId: r.userId,
              rank: r.rank,
              points: r.points,
              rating: r.rating,
              name: person.name,
              companyDomain: company?.domain ?? null,
              companyName: company?.name ?? null,
              excluded: person.lichessMarked || person.lichessClosed,
            };
          }),
      ),

  // getRecap: the Matchday's decisive Games, for its Awards, in the order they finished.
  [`select "lichessGameId", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt" from "game" where "matchdayDate" = $1 and "winner" is not null order by "finishedAt", "lichessGameId"`]:
    (date) =>
      answer(
        [...games.values()]
          .filter((g) => g.matchdayDate === date && g.winner !== null)
          .sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime() || (a.lichessGameId < b.lichessGameId ? -1 : 1))
          .map((g) => ({
            lichessGameId: g.lichessGameId,
            whiteId: g.whiteId,
            blackId: g.blackId,
            winner: g.winner,
            status: g.status,
            plies: g.plies,
            whiteRating: g.whiteRating,
            blackRating: g.blackRating,
            winnerClockCentis: g.winnerClockCentis,
            finishedAt: new Date(g.finishedAt),
          })),
      ),

  // uncollected (lib/collect-results.ts): the Matchdays between two dates with a tournament and no results, latest first.
  [`select to_char("date", 'YYYY-MM-DD') as "date", "lichessTournamentId" from "matchday" where "ingestedAt" is null and "lichessTournamentId" is not null and "date" between $1 and $2 order by "date" desc`]:
    (from, to) =>
      answer(
        [...matchdays.values()]
          .filter((m) => m.ingestedAt === null && m.lichessTournamentId !== null && m.date >= from && m.date <= to)
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .map(({ date, lichessTournamentId }) => ({ date, lichessTournamentId })),
      ),

  // recapDates
  [`select to_char("date", 'YYYY-MM-DD') as "date" from "matchday" where "ingestedAt" is not null order by "date" desc`]: () =>
    answer(
      [...matchdays.values()]
        .filter((m) => m.ingestedAt !== null)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((m) => ({ date: m.date })),
    ),

  // --- The schedule (lib/seasons.ts, lib/signups.ts), which the Leaderboards are also read against ---

  [`select "number", to_char("start", 'YYYY-MM-DD') as "start" from "season"`]: () => answer([...seasons.values()].map((s) => ({ ...s }))),

  // signUpTimes
  [`select "lichessConnectedAt" as at from "user" where "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null`]:
    () => answer([...people.values()].filter(isMember).map((p) => ({ at: p.lichessConnectedAt }))),

  // --- Changes to the schedule, each queueing its notice for the Telegram group when it changes something ---

  // addSeason
  [`with changed as (insert into "season" ("number", "start") values ($1, $2) on conflict ("number") do nothing returning 1) insert into "telegramPost" ("key", "text", "until") select 'notice:' || gen_random_uuid()::text, $3, $4 from changed where $3::text is not null`]:
    (number, start, text, until) => {
      if (seasons.has(Number(number))) return answer([], 0);
      seasons.set(Number(number), { number: Number(number), start });
      return notice(text, until);
    },

  // setStart: a Season's row is changed only when its start is another.
  [`with changed as (insert into "season" ("number", "start") values ($1, $2) on conflict ("number") do update set "start" = excluded."start" where "season"."start" is distinct from excluded."start" returning 1) insert into "telegramPost" ("key", "text", "until") select 'notice:' || gen_random_uuid()::text, $3, $4 from changed where $3::text is not null`]:
    (number, start, text, until) => {
      if (seasons.get(Number(number))?.start === start) return answer([], 0);
      seasons.set(Number(number), { number: Number(number), start });
      return notice(text, until);
    },

  // setSkipped: skipping also deletes the Sunday's reminders that no delivery has claimed, whether or not it was skipped.
  [`with reminders as (delete from "telegramPost" where "key" like 'reminder:' || to_char($1::date, 'YYYY-MM-DD') || ':%' and "claimedAt" is null), changed as (insert into "skippedSunday" ("date") values ($1) on conflict do nothing returning 1) insert into "telegramPost" ("key", "text", "until") select 'notice:' || gen_random_uuid()::text, $2, $3 from changed where $2::text is not null`]:
    (date, text, until) => {
      for (const post of [...telegramPosts.values()])
        if (likePrefix(post.key, `reminder:${date}:%`) && post.claimedAt === null) telegramPosts.delete(post.key);
      if (skippedSundays.has(date)) return answer([], 0);
      skippedSundays.set(date, { date });
      return notice(text, until);
    },
  [`with changed as (delete from "skippedSunday" where "date" = $1 returning 1) insert into "telegramPost" ("key", "text", "until") select 'notice:' || gen_random_uuid()::text, $2, $3 from changed where $2::text is not null`]:
    (date, text, until) => {
      if (!skippedSundays.delete(date)) return answer([], 0);
      return notice(text, until);
    },

  // --- Posts to the Telegram group (lib/telegram.ts) ---

  // queuePost: queued again, a post takes the new text while no delivery has claimed it.
  [`insert into "telegramPost" ("key", "text", "until") values ($1, $2, $3) on conflict ("key") do update set "text" = excluded."text" where "telegramPost"."claimedAt" is null`]:
    (key, text, until) => {
      const post = telegramPosts.get(key);
      if (!post) return addPost(key, text, until);
      if (post.claimedAt !== null) return answer([], 0);
      post.text = String(text);
      return answer([], 1);
    },

  // stuckPost: the oldest post claimed at or before $1 and never sent.
  [`select "text" from "telegramPost" where "sentAt" is null and "claimedAt" <= $1 order by "claimedAt", "key" limit 1`]: (before) => {
    const post = [...telegramPosts.values()]
      .filter((p) => p.sentAt === null && p.claimedAt !== null && p.claimedAt <= new Date(before as unknown as Date))
      .sort((a, b) => a.claimedAt!.getTime() - b.claimedAt!.getTime() || (a.key < b.key ? -1 : 1))[0];
    return answer(post ? [{ text: post.text }] : []);
  },

  // forgetPastPosts
  [`delete from "telegramPost" where "until" <= $1`]: (now) => {
    const gone = [...telegramPosts.values()].filter((p) => p.until <= new Date(now as unknown as Date));
    for (const post of gone) telegramPosts.delete(post.key);
    return answer([], gone.length);
  },

  // A delivery's claim: the oldest post nobody has claimed whose "until" is after $1 and whose key is like $2. Each
  // statement here runs whole, so none can take a post another is claiming: lib/telegram.postgres.test.ts shows that of
  // Postgres, with two connections.
  [`update "telegramPost" set "claimedAt" = now() where "key" = (select "key" from "telegramPost" where "claimedAt" is null and "until" > $1 and "key" like $2 order by "createdAt", "key" limit 1 for update skip locked) returning "key", "text"`]:
    (now, pattern) => {
      const post = [...telegramPosts.values()]
        .filter((p) => p.claimedAt === null && p.until > new Date(now as unknown as Date) && likePrefix(p.key, pattern))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.order - b.order)[0];
      if (!post) return answer();
      post.claimedAt = new Date();
      return answer([{ key: post.key, text: post.text }]);
    },

  // deliverPosts, once Telegram has posted it. Only a claimed post can be sent, as the table's check has it.
  [`update "telegramPost" set "sentAt" = now() where "key" = $1`]: (key) => {
    const post = telegramPosts.get(key);
    if (!post) return answer();
    if (post.claimedAt === null) throw new Error('new row for relation "telegramPost" violates check constraint "telegramPost_check"');
    post.sentAt = new Date();
    return answer([], 1);
  },

  // deliverPosts, giving back a post Telegram did not post
  [`update "telegramPost" set "claimedAt" = null where "key" = $1`]: (key) => {
    const post = telegramPosts.get(key);
    if (!post) return answer();
    post.claimedAt = null;
    return answer([], 1);
  },

  // --- The Organiser's Lichess permission (lib/organiser-lichess.ts) ---

  // storedRow
  [`select "userId", "lichessId", "scopes", "token", "expiresAt", "connectedAt" from "organiserLichess"`]: () =>
    answer([...organiserLichess.values()].map((row) => ({ ...row }))),

  // finishOrganiserConnection. The person must exist, as the foreign key requires.
  [`insert into "organiserLichess" ("singleton", "userId", "lichessId", "scopes", "token", "expiresAt", "connectedAt") values (true, $1, $2, $3, $4, $5, now()) on conflict ("singleton") do update set "userId" = excluded."userId", "lichessId" = excluded."lichessId", "scopes" = excluded."scopes", "token" = excluded."token", "expiresAt" = excluded."expiresAt", "connectedAt" = excluded."connectedAt"`]:
    (userId, lichessId, scopes, token, expiresAt) => {
      if (!people.has(userId)) throw violation("23503", "organiserLichess_userId_fkey");
      organiserLichess.set("singleton", { userId, lichessId, scopes: String(scopes), token: String(token), expiresAt: new Date(expiresAt as Date), connectedAt: new Date() });
      return answer([], 1);
    },

  // organiserName
  [`select name from "user" where id = $1 and "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null`]:
    (id) => {
      const person = people.get(id);
      return answer(isMember(person) ? [{ name: person.name }] : []);
    },

  // --- Scheduled jobs (lib/jobs.ts) ---

  // runJob's hold: taken only if nobody holds the job, or their hold has lapsed. Returns the previous run's outcome.
  [`insert into "scheduledJob" ("job", "lockedBy", "lockedUntil") values ($1, $2, now() + interval '15 minutes') on conflict ("job") do update set "lockedBy" = excluded."lockedBy", "lockedUntil" = excluded."lockedUntil" where "scheduledJob"."lockedUntil" is null or "scheduledJob"."lockedUntil" <= now() returning "lastOutcome", "lastDetail"`]:
    (job, lockedBy) => {
      const lockedUntil = new Date(Date.now() + 15 * 60_000);
      const row = scheduledJobs.get(job);
      if (!row) {
        scheduledJobs.set(job, { job, lockedBy, lockedUntil, lastRunAt: null, lastOutcome: null, lastDetail: null });
        return answer([{ lastOutcome: null, lastDetail: null }]);
      }
      if (row.lockedUntil !== null && row.lockedUntil > new Date()) return answer([], 0);
      Object.assign(row, { lockedBy, lockedUntil });
      return answer([{ lastOutcome: row.lastOutcome, lastDetail: row.lastDetail }]);
    },

  // lastRun
  [`select "lastRunAt" as "at", "lastOutcome" as "outcome", "lastDetail" as "detail" from "scheduledJob" where "job" = $1 and "lastRunAt" is not null`]:
    (job) => {
      const row = scheduledJobs.get(job);
      return answer(row?.lastRunAt ? [{ at: row.lastRunAt, outcome: row.lastOutcome, detail: row.lastDetail }] : []);
    },

  [`insert into "jobFailure" ("job", "matchdayDate", "problem") values ($1, $2, $3)`]: (job, matchdayDate, problem) => {
    const id = ++lastFailureId;
    jobFailures.set(String(id), { id, job, at: new Date(), matchdayDate: (matchdayDate as string | null) ?? null, problem: String(problem) });
    return answer([], 1);
  },

  // runJob's record of the run, which lets go of the job: only while the run still holds it.
  [`update "scheduledJob" set "lastRunAt" = now(), "lastOutcome" = $3, "lastDetail" = $4, "lockedBy" = null, "lockedUntil" = null where "job" = $1 and "lockedBy" = $2`]:
    (job, lockedBy, outcome, detail) => {
      const row = scheduledJobs.get(job);
      if (!row || row.lockedBy !== lockedBy) return answer([], 0);
      Object.assign(row, { lastRunAt: new Date(), lastOutcome: outcome, lastDetail: detail, lockedBy: null, lockedUntil: null });
      return answer([], 1);
    },

  // lastFailure
  [`select "job", "at", to_char("matchdayDate", 'YYYY-MM-DD') as "matchdayDate", "problem" from "jobFailure" order by "at" desc, "id" desc limit 1`]:
    () => {
      const latest = [...jobFailures.values()].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)[0];
      return answer(latest ? [{ job: latest.job, at: latest.at, matchdayDate: latest.matchdayDate, problem: latest.problem }] : []);
    },

  // --- Connecting Lichess (lib/connect-lichess.ts) ---

  // connectedToSomeoneElse
  [`select 1 from "user" where "lichessId" = $1 and id <> $2`]: (lichessId, id) =>
    answer([...people.values()].filter((p) => p.lichessId === lichessId && p.id !== id).map(() => ({}))),

  // saveConnection: refused, changing nothing, when someone else has the account, as its unique constraint makes it;
  // otherwise, if the person is there, the account they had before, and the new one is no longer kept for the Organiser
  // to remove from the team by hand. Each statement runs whole, as the row lock makes two saves of one person do.
  [`with saved as ( update "user" u set "lichessId" = $2, "lichessUsername" = $3, "lichessBlitzRating" = $4, "lichessMarked" = false, "lichessClosed" = false, "lichessConnectedAt" = coalesce("lichessConnectedAt", now()), "updatedAt" = now() from (select id, "lichessId" from "user" where id = $1 for update) before where u.id = before.id returning before."lichessId" as "replaced" ), forgotten as (delete from "teamRemoval" where "lichessId" = $2 and exists (select 1 from saved)) select "replaced" from saved`]:
    (id, lichessId, lichessUsername, lichessBlitzRating) => {
      if ([...people.values()].some((p) => p.lichessId === lichessId && p.id !== id)) throw violation("23505", "user_lichessId_key");
      const person = people.get(id);
      if (!person) return answer();
      const replaced = person.lichessId;
      teamRemovals.delete(lichessId);
      Object.assign(person, {
        lichessId,
        lichessUsername: lichessUsername as string,
        lichessBlitzRating: lichessBlitzRating as number | null,
        lichessMarked: false,
        lichessClosed: false,
        lichessConnectedAt: person.lichessConnectedAt ?? new Date(),
      });
      return answer([{ replaced }]);
    },

  // --- Leaving the Club (lib/leaving.ts) ---

  // removeSwitchedFrom: whether anyone has the account.
  [`select 1 from "user" where "lichessId" = $1`]: (lichessId) =>
    answer([...people.values()].filter((p) => p.lichessId === lichessId).map(() => ({}))),

  // removeMember: the person's Lichess account, if they are there at all.
  [`select "lichessId" from "user" where id = $1`]: (id) => {
    const person = people.get(id);
    return answer(person ? [{ lichessId: person.lichessId }] : []);
  },

  // removeMember, with what Postgres does by the foreign keys onto "user": their results and the Organiser's permission
  // they connected go with them (on delete cascade), and their side of each Game empties (on delete set null). Their
  // sessions and account rows would go too; there are none here.
  [`delete from "user" where id = $1`]: (id) => {
    if (!people.delete(id)) return answer([], 0);
    for (const [key, result] of results) if (result.userId === id) results.delete(key);
    for (const game of games.values()) {
      if (game.whiteId === id) game.whiteId = null;
      if (game.blackId === id) game.blackId = null;
    }
    for (const [key, row] of organiserLichess) if (row.userId === id) organiserLichess.delete(key);
    return answer([], 1);
  },

  // keepForOrganiser, and saveConnection when nobody was there: an account the site could not remove from the Lichess
  // team, kept once however often it is recorded, and not while anyone has it.
  [`insert into "teamRemoval" ("lichessId", "problem") select $1, $2 where not exists (select 1 from "user" where "lichessId" = $1) on conflict ("lichessId") do update set "at" = now(), "problem" = excluded."problem"`]:
    (lichessId, problem) => {
      if ([...people.values()].some((p) => p.lichessId === lichessId)) return answer([], 0);
      teamRemovals.set(lichessId, { lichessId, at: new Date(), problem: String(problem) });
      return answer([], 1);
    },

  // teamRemovals: the oldest first.
  [`select "lichessId", "problem" from "teamRemoval" order by "at", "lichessId"`]: () =>
    answer(
      [...teamRemovals.values()]
        .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.lichessId < b.lichessId ? -1 : 1))
        .map(({ lichessId, problem }) => ({ lichessId, problem })),
    ),

  // teamRemovalDone
  [`delete from "teamRemoval" where "lichessId" = $1`]: (lichessId) => answer([], teamRemovals.delete(lichessId) ? 1 : 0),

  // --- Season and all-time Leaderboards (lib/leaderboards.ts) ---

  // getSeason: the Members' results on the Season's dates, oldest first, each with the Company of that night. $1 is an
  // array of dates.
  [`select to_char(r."matchdayDate", 'YYYY-MM-DD') as "date", r."userId" as "memberId", r."points", u.name, c."domain" as "companyDomain", c."name" as "companyName", u."lichessMarked" or u."lichessClosed" as "excluded" from "matchdayResult" r join "user" u on u.id = r."userId" left join "company" c on c."domain" = r."companyDomain" where r."matchdayDate" = any($1::date[]) and "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null order by r."matchdayDate"`]:
    (...params) => {
      const [dates] = given<[string[]]>(params);
      return answer(
        [...results.values()]
          .filter((r) => dates.includes(r.matchdayDate) && isMember(people.get(r.userId)))
          .sort((a, b) => (a.matchdayDate < b.matchdayDate ? -1 : a.matchdayDate > b.matchdayDate ? 1 : 0))
          .map((r) => {
            const person = people.get(r.userId)!;
            const company = r.companyDomain ? companies.get(r.companyDomain) : undefined;
            return {
              date: r.matchdayDate,
              memberId: r.userId,
              points: r.points,
              name: person.name,
              companyDomain: company?.domain ?? null,
              companyName: company?.name ?? null,
              excluded: person.lichessMarked || person.lichessClosed,
            };
          }),
      );
    },

  // getAllTime: how many Matchdays each Member has played, with the Company they are at now. Postgres gives no order
  // without "order by", so neither does this: Members in the reverse of the order their first result was stored.
  [`select u.id as "memberId", u.name, c."domain" as "companyDomain", c."name" as "companyName", u."lichessMarked" or u."lichessClosed" as "excluded", count(*)::int as "played" from "matchdayResult" r join "user" u on u.id = r."userId" left join "company" c on c."domain" = u."companyDomain" where "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null group by u.id, c."domain"`]:
    () => {
      const played = new Map<string, number>();
      for (const r of results.values()) if (isMember(people.get(r.userId))) played.set(r.userId, (played.get(r.userId) ?? 0) + 1);
      return answer(
        [...played]
          .reverse()
          .map(([memberId, count]) => {
            const person = people.get(memberId)!;
            const company = person.companyDomain ? companies.get(person.companyDomain) : undefined;
            return {
              memberId,
              name: person.name,
              companyDomain: company?.domain ?? null,
              companyName: company?.name ?? null,
              excluded: person.lichessMarked || person.lichessClosed,
              played: count,
            };
          }),
      );
    },
};

async function run(sql: string, params: unknown[] = []) {
  await null;
  const statement = sql.replace(/\s+/g, " ").trim();
  const handler = statements[statement];
  if (!handler) throw new Error(`The fake database does not know this statement: ${statement}`);
  return handler(...(params as Params));
}

// --- Transactions ---

// Settles when the transaction in progress, if any, has ended.
let ended: Promise<void> = Promise.resolve();

const copyOf = () =>
  Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, [...table].map(([key, row]) => [key, { ...row }])]));

function restore(copy: ReturnType<typeof copyOf>) {
  for (const [name, rows] of Object.entries(copy)) {
    const table = tables[name as keyof typeof tables] as Map<string, object>;
    table.clear();
    for (const [key, row] of rows as [string, object][]) table.set(key, row);
  }
}

// One connection from the pool, as pg's PoolClient: "begin", "commit" and "rollback" as Postgres treats them. A
// connection released inside a transaction rolls it back, as Postgres does when a connection closes.
function connection(): Queryable & { release: (error?: Error) => void } {
  let copy: ReturnType<typeof copyOf> | null = null;
  let end = () => {};
  const finish = (rollBack: boolean) => {
    if (copy && rollBack) restore(copy);
    copy = null;
    end();
  };
  const query = async (sql: string, params: unknown[] = []) => {
    switch (sql) {
      case "begin": {
        const previous = ended;
        ended = new Promise((resolve) => (end = resolve));
        await previous;
        copy = copyOf();
        return answer();
      }
      case "commit":
        finish(false);
        return answer();
      case "rollback":
        finish(true);
        return answer();
      default:
        return run(sql, params);
    }
  };
  return { query: query as Queryable["query"], release: () => finish(true) };
}

export const db = { query: vi.fn(run), connect: vi.fn(async () => connection()) };
