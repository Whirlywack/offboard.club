// For tests only: the database's "user", "company", "matchday", "matchdayResult", "game" and "skippedSunday" tables in memory, standing
// in for lib/db.ts with vi.mock("@/lib/db", () => import("@/lib/fake-db")). It knows each statement the app sends by its
// full text, written out again below, and throws on any other: a condition dropped from a query in the app fails the
// tests instead of passing unnoticed. Each statement answers a moment later, so callers running at once interleave,
// and then runs whole, as one Postgres statement does, enforcing the keys and foreign keys of migrations/ as Postgres
// would. A transaction (inTransaction) holds every other transaction back until it ends, and a rollback restores every
// table as it was at its start; statements outside a transaction are not held back.
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

export const people = new Map<string, Person>();
export const companies = new Map<string, CompanyRow>();
export const matchdays = new Map<string, MatchdayRow>(); // by date
export const results = new Map<string, ResultRow>(); // by `${matchdayDate} ${userId}`
export const games = new Map<string, GameRow>(); // by lichessGameId
export const skippedSundays = new Map<string, { date: string }>(); // by date

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

const tables = { people, companies, matchdays, results, games, skippedSundays };

export function resetDb() {
  for (const table of Object.values(tables)) table.clear();
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
  [`delete from "game" where "matchdayDate" = $1`]: (date) => {
    const gone = [...games.values()].filter((g) => g.matchdayDate === date);
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

  // storeGames
  [`insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt") select g."lichessGameId", $1::date, g."whiteId", g."blackId", g."winner", g."status", g."plies", g."whiteRating", g."blackRating", g."winnerClockCentis", g."finishedAt" from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::integer[], $8::integer[], $9::integer[], $10::integer[], $11::timestamptz[]) as g ("lichessGameId", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt")`]:
    (...params) => {
      const [date, ids, whiteIds, blackIds, winners, statuses, plies, whiteRatings, blackRatings, clocks, finishedAt] =
        given<[string, string[], string[], string[], GameRow["winner"][], string[], number[], number[], number[], (number | null)[], string[]]>(params);
      if (!matchdays.has(date)) throw violation("23503", "game_matchdayDate_fkey");
      const rows: GameRow[] = ids.map((lichessGameId, i) => ({
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
      for (const [i, row] of rows.entries()) {
        if (row.whiteId !== null && !people.has(row.whiteId)) throw violation("23503", "game_whiteId_fkey");
        if (row.blackId !== null && !people.has(row.blackId)) throw violation("23503", "game_blackId_fkey");
        if (games.has(row.lichessGameId) || rows.slice(0, i).some((r) => r.lichessGameId === row.lichessGameId))
          throw violation("23505", "game_pkey");
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

  // recapDates
  [`select to_char("date", 'YYYY-MM-DD') as "date" from "matchday" where "ingestedAt" is not null order by "date" desc`]: () =>
    answer(
      [...matchdays.values()]
        .filter((m) => m.ingestedAt !== null)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((m) => ({ date: m.date })),
    ),
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
