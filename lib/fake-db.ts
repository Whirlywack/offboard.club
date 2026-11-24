// For tests only: the database's "user" and "company" tables in memory, standing in for lib/db.ts with
// vi.mock("@/lib/db", () => import("@/lib/fake-db")). It knows each statement the app sends by its full text, written
// out again below, and throws on any other: a condition dropped from a query in the app fails the tests instead of
// passing unnoticed. Each statement answers a moment later, so callers running at once interleave, and then runs
// whole, as one Postgres statement does.
import { vi } from "vitest";

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
};

export const people = new Map<string, Person>();
export const companies = new Map<string, CompanyRow>();

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
    companyDomain: null,
    companiesCreatedOn: null,
    companiesCreatedThatDay: 0,
    ...details,
  };
  people.set(id, person);
  return person;
}

// A Company whose website was fetched, unless told otherwise.
export function addCompany(domain: string, name: string, logoUrl: string | null = null, details: Partial<CompanyRow> = {}) {
  const company = { domain, name, logoUrl, fetchedAt: new Date(), fetchTriedAt: new Date(), ...details };
  companies.set(domain, company);
  return company;
}

export function resetDb() {
  people.clear();
  companies.clear();
  db.query.mockClear();
}

const answer = (rows: object[] = [], rowCount = rows.length) => ({ rows, rowCount });
// lib/members.ts, written out again so that a change to it shows here.
const isMember = (person?: Person): person is Person =>
  !!person && person.publicDisplayConsentAt !== null && person.houseRulesAcceptedAt !== null && person.lichessId !== null;
const aMinuteAgo = () => new Date(Date.now() - 60_000);

type Params = [string, string, unknown, unknown, unknown];
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

  // The retry of a Company whose website gave nothing.
  [`update "company" set "fetchTriedAt" = now() where "domain" = $1 and "fetchedAt" is null and "fetchTriedAt" < now() - interval '1 minute'`]:
    (domain) => {
      const company = companies.get(domain);
      if (!company || company.fetchedAt !== null || !(company.fetchTriedAt < aMinuteAgo())) return answer();
      company.fetchTriedAt = new Date();
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

  [`insert into "company" ("domain", "name") values ($1, $1) on conflict ("domain") do nothing`]: (domain) => {
    if (companies.has(domain)) return answer([], 0);
    companies.set(domain, { domain, name: domain, logoUrl: null, fetchedAt: null, fetchTriedAt: new Date() });
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
};

async function run(sql: string, params: unknown[] = []) {
  await null;
  const statement = sql.replace(/\s+/g, " ").trim();
  const handler = statements[statement];
  if (!handler) throw new Error(`The fake database does not know this statement: ${statement}`);
  return handler(...(params as Params));
}

export const db = { query: vi.fn(run) };
