-- Companies, each identified by the registrable domain of the website its Members give ("vinted.com"). The name and
-- logo address are taken from that website when the first person gives it; nobody edits them. A Company with nobody
-- left in it stays.

create table "company" ("domain" text not null primary key, "name" text not null, "logoUrl" text);

-- The Company a person belongs to now, or null for none. Matchday results keep their own copy (#7).
-- Giving a website nobody has given before makes the server fetch it, so each person may create only a few new
-- Companies a day: "companiesCreatedThatDay" counts those created on "companiesCreatedOn", a UTC calendar day.
alter table "user"
  add column "companyDomain" text references "company" ("domain"),
  add column "companiesCreatedOn" date,
  add column "companiesCreatedThatDay" integer not null default 0;
