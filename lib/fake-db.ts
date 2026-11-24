// For tests only: the database's "user" and "company" tables in memory, standing in for lib/db.ts with
// vi.mock("@/lib/db", () => import("@/lib/fake-db")). It answers the statements the app sends and throws on any
// other, so a query that changes without this file changing with it fails loudly. Each statement answers a moment
// later, so callers running at once interleave, and then runs whole, as one Postgres statement does.
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
  companyDomain: string | null;
  companiesCreatedOn: string | null;
  companiesCreatedThatDay: number;
};
export type CompanyRow = { domain: string; name: string; logoUrl: string | null };

export const people = new Map<string, Person>();
export const companies = new Map<string, CompanyRow>();

const welcomedAt = new Date("2026-11-24T18:00:00Z");

// Someone who has finished the welcome step and filled in nothing else, unless told otherwise.
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
    companyDomain: null,
    companiesCreatedOn: null,
    companiesCreatedThatDay: 0,
    ...details,
  };
  people.set(id, person);
  return person;
}

export function addCompany(domain: string, name: string, logoUrl: string | null = null): CompanyRow {
  const company = { domain, name, logoUrl };
  companies.set(domain, company);
  return company;
}

export function resetDb() {
  people.clear();
  companies.clear();
  db.query.mockClear();
}

const answer = (rows: object[] = [], rowCount = rows.length) => ({ rows, rowCount });

async function run(sql: string, params: unknown[] = []) {
  await null;
  const statement = sql.replace(/\s+/g, " ").trim();
  const [first, second, third, fourth, fifth] = params as [string, string, unknown, unknown, unknown];

  // getProfile: a person who has finished the welcome step, with their Company if they have one.
  if (statement.startsWith(`select u.id, u.name, u.image, u."position", u."linkedInUrl", u."openTo", c."domain" as`)) {
    const person = people.get(first);
    if (!person?.publicDisplayConsentAt || !person.houseRulesAcceptedAt) return answer();
    const { id, name, image, position, linkedInUrl, openTo, companyDomain } = person;
    const company = companyDomain ? companies.get(companyDomain) : undefined;
    return answer([
      {
        id,
        name,
        image,
        position,
        linkedInUrl,
        openTo,
        companyDomain: company?.domain ?? null,
        companyName: company?.name ?? null,
        companyLogoUrl: company?.logoUrl ?? null,
      },
    ]);
  }

  // currentCompany
  if (statement.startsWith(`select c."domain", c."name" from "user" u join "company" c`)) {
    const domain = people.get(first)?.companyDomain;
    const company = domain ? companies.get(domain) : undefined;
    return answer(company ? [{ domain: company.domain, name: company.name }] : []);
  }

  if (statement === `select 1 from "company" where "domain" = $1`) return answer(companies.has(first) ? [{}] : []);

  // takeNewCompanySlot: $2 is today, $3 the most a day.
  if (statement.startsWith(`update "user" set "companiesCreatedThatDay" = case when "companiesCreatedOn" = $2`)) {
    const person = people.get(first);
    if (!person || (person.companiesCreatedOn === second && person.companiesCreatedThatDay >= Number(third)))
      return answer();
    person.companiesCreatedThatDay = person.companiesCreatedOn === second ? person.companiesCreatedThatDay + 1 : 1;
    person.companiesCreatedOn = second;
    return answer([], 1);
  }

  if (statement === `insert into "company" ("domain", "name") values ($1, $1) on conflict ("domain") do nothing`) {
    if (companies.has(first)) return answer([], 0);
    addCompany(first, first);
    return answer([], 1);
  }

  if (statement === `update "company" set "name" = $2, "logoUrl" = $3 where "domain" = $1`) {
    const company = companies.get(first);
    if (company) Object.assign(company, { name: second, logoUrl: third });
    return answer([], company ? 1 : 0);
  }

  // saveProfile. The person's Company must exist, as the foreign key requires.
  if (
    statement ===
    `update "user" set "companyDomain" = $2, "position" = $3, "linkedInUrl" = $4, "openTo" = $5, "updatedAt" = now() where id = $1`
  ) {
    if (second !== null && !companies.has(second)) throw new Error(`no Company ${second}: foreign key violated`);
    const person = people.get(first);
    if (person) Object.assign(person, { companyDomain: second, position: third, linkedInUrl: fourth, openTo: fifth });
    return answer([], person ? 1 : 0);
  }

  throw new Error(`The fake database does not know this statement: ${statement}`);
}

export const db = { query: vi.fn(run) };
