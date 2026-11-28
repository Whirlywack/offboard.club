// Companies as stored, and which one a person belongs to. lib/company.ts says what a Company's domain is and fetches
// its name and logo from its website; this file keeps them in the database.

import { companyDomain, fetchCompanyMeta } from "./company";
import { db } from "./db";

export type Company = { domain: string; name: string; logoUrl: string | null };

// Creating a Company makes the server fetch a website the person chose, so one person may create at most this many in
// a UTC calendar day. Giving the website of a Company that already exists costs nothing.
export const NEW_COMPANIES_PER_DAY = 5;

// fetchCompanyMeta stops waiting for the website after 5 s, but not for a DNS lookup that never answers.
const FETCH_WAIT_MS = 8000;

// How many times in all, the first included, a Company's website is fetched before its domain stays its name. Without
// a limit, Companies whose websites never answer would make the site contact more and more domains every minute.
export const FETCH_ATTEMPTS = 3;

// How a page names a Company: by its name, with the domain beside it, since any website can claim any name. A Company
// whose website gave no name is named by its domain alone.
export const companyLabel = ({ domain, name }: Pick<Company, "domain" | "name">) =>
  name === domain ? domain : `${name} (${domain})`;

// The Company a person belongs to now, or null if they have not given one. Matchday ingestion (#7) copies the same
// domain into each result as it stores it, so a later change of Company leaves past Matchdays as they were.
export async function currentCompany(personId: string): Promise<Pick<Company, "domain" | "name"> | null> {
  const { rows } = await db.query<Pick<Company, "domain" | "name">>(
    `select c."domain", c."name" from "user" u join "company" c on c."domain" = u."companyDomain" where u.id = $1`,
    [personId],
  );
  return rows[0] ?? null;
}

// The Company for the domain of a website typed on a person's Profile form (companyDomain gives it): its domain, after
// creating the Company if nobody has given that website before. A null domain, for no website, clears the person's
// Company. The person is not linked here: the caller saves the domain with the rest of their Profile, so a refused
// form changes nothing. At most one fetch of the website happens per call.
export async function companyForDomain(
  personId: string,
  domain: string | null,
): Promise<{ domain: string | null } | { problem: string }> {
  if (!domain) return { domain: null };

  if ((await db.query(`select 1 from "company" where "domain" = $1`, [domain])).rowCount) {
    // A Company whose website gave nothing but the domain is tried again, at most once a minute and FETCH_ATTEMPTS
    // times in all, by whoever claims the attempt first. That costs nobody a new Company for the day.
    const retry = await db.query(
      `update "company" set "fetchTriedAt" = now(), "fetchAttempts" = "fetchAttempts" + 1
       where "domain" = $1 and "fetchedAt" is null and "fetchAttempts" < $2 and "fetchTriedAt" < now() - interval '1 minute'`,
      [domain, FETCH_ATTEMPTS],
    );
    if (retry.rowCount) await nameFromWebsite(domain);
    return { domain };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!(await takeNewCompanySlot(personId, today)))
    return {
      problem: `Nobody has given this website before, and you've already added ${NEW_COMPANIES_PER_DAY} new Companies today, which is the daily limit. Please try again tomorrow.`,
    };
  // The row goes in before the website is fetched, so two people giving the same new website at once make one
  // Company and one fetch: whoever loses the insert simply joins it and has their new Company for the day back.
  const inserted = await db.query(
    `insert into "company" ("domain", "name", "fetchAttempts") values ($1, $1, 1) on conflict ("domain") do nothing`,
    [domain],
  );
  if (inserted.rowCount) await nameFromWebsite(domain);
  else await giveBackNewCompanySlot(personId, today);
  return { domain };
}

// Names the Company from its website and marks it fetched, unless the fetch gave only the domain and no logo, which is
// what fetchCompanyMeta returns when the website fails; then the Company keeps the domain as its name until a retry.
// Never replaces a result already fetched.
async function nameFromWebsite(domain: string) {
  const { name, logoUrl } = await withinWait(fetchCompanyMeta(domain), { name: domain, logoUrl: null });
  if (name === domain && !logoUrl) return;
  await db.query(
    `update "company" set "name" = $2, "logoUrl" = $3, "fetchedAt" = now() where "domain" = $1 and "fetchedAt" is null`,
    [domain, name, logoUrl],
  );
}

// Counts one new Company against the person's day, if they have any left. A single statement on their own row, so
// saves sent at the same moment take turns and cannot both take the last one.
async function takeNewCompanySlot(personId: string, today: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `update "user" set
       "companiesCreatedThatDay" = case when "companiesCreatedOn" = $2 then "companiesCreatedThatDay" + 1 else 1 end,
       "companiesCreatedOn" = $2
     where id = $1 and ("companiesCreatedOn" is distinct from $2 or "companiesCreatedThatDay" < $3)`,
    [personId, today, NEW_COMPANIES_PER_DAY],
  );
  return rowCount === 1;
}

// Undoes takeNewCompanySlot after someone else created the Company first. Until then the slot was held, so the count
// can only ever be too high for a moment, never too low.
async function giveBackNewCompanySlot(personId: string, today: string) {
  await db.query(
    `update "user" set "companiesCreatedThatDay" = "companiesCreatedThatDay" - 1
     where id = $1 and "companiesCreatedOn" = $2 and "companiesCreatedThatDay" > 0`,
    [personId, today],
  );
}

// A slow or broken website must not hold up or fail the save, so after FETCH_WAIT_MS, or on any error, the fallback.
function withinWait<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => (timer = setTimeout(resolve, FETCH_WAIT_MS, fallback)));
  return Promise.race([work.catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

// The logo address to put in a page: only https on the Company's own domain, without credentials. fetchCompanyMeta
// stores nothing else, and this keeps any other address out of a page whatever the database holds.
export function shownLogoUrl(domain: string, logoUrl: string | null): string | null {
  const url = logoUrl ? URL.parse(logoUrl) : null;
  return url && url.protocol === "https:" && !url.username && !url.password && companyDomain(url.hostname) === domain
    ? url.href
    : null;
}
