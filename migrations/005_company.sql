-- Companies, each identified by the registrable domain of the website its Members give ("vinted.com"). The name and
-- logo address are taken from that website when the first person gives it; nobody edits them. Until a fetch gives
-- more than the domain, "fetchedAt" stays null and the name is the domain, and the next person to give the website
-- at least a minute after "fetchTriedAt" tries it again, up to three attempts in all ("fetchAttempts"), after which
-- the domain stays the name. A Company with nobody left in it stays.

create table "company" (
  "domain" text not null primary key,
  "name" text not null,
  "logoUrl" text,
  "fetchedAt" timestamptz,
  "fetchTriedAt" timestamptz not null default now(),
  "fetchAttempts" integer not null default 0
);

-- The Company a person belongs to now, or null for none. Matchday results keep their own copy (#7).
-- Giving a website nobody has given before makes the server fetch it, so each person may create only a few new
-- Companies a day: "companiesCreatedThatDay" counts those created on "companiesCreatedOn", a UTC calendar day.
alter table "user"
  add column "companyDomain" text references "company" ("domain"),
  add column "companiesCreatedOn" date,
  add column "companiesCreatedThatDay" integer not null default 0;
