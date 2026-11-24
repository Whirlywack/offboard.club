-- The Organiser's Lichess permission (#11), and the bookkeeping of scheduled jobs.
--
-- The permission is the token the Organiser approved on Lichess, kept so that the site can create each Matchday's
-- tournament on the Club's team (scope tournament:write) and, in later tickets, remove a Member from the team (team:lead).
-- There is at most one row. "token" holds the token sealed with AES-256-GCM under LICHESS_TOKEN_KEY, which is not in the
-- database (lib/token-box.ts), bound to "userId" and "lichessId". "expiresAt" is when Lichess said the token lapses,
-- about a year after it was approved; the Organiser must then approve it again by hand. The row goes if the person who
-- connected it deletes their account.
create table "organiserLichess" (
  "singleton" boolean not null primary key default true check ("singleton"),
  "userId" text not null references "user" ("id") on delete cascade,
  "lichessId" text not null,
  "scopes" text not null,
  "token" text not null,
  "expiresAt" timestamptz not null,
  "connectedAt" timestamptz not null default now()
);

-- Each scheduled job's latest run, by name ("create-matchdays"), with why it did what it did. While a run is working it
-- holds the job for a few minutes ("lockedBy", "lockedUntil"), so that a second run started at the same time does
-- nothing; a run that dies leaves the hold to lapse by itself.
create table "scheduledJob" (
  "job" text not null primary key,
  "lockedBy" text,
  "lockedUntil" timestamptz,
  "lastRunAt" timestamptz,
  "lastOutcome" text check ("lastOutcome" in ('done', 'skipped', 'failed')),
  "lastDetail" text,
  check (("lockedBy" is null) = ("lockedUntil" is null))
);

-- Every failure of a scheduled job: which job, when, for which Matchday (null if it concerned none) and what went wrong,
-- as a plain sentence for the Organiser. The Organiser page shows the latest (#16); alerts are sent from here (#17).
create table "jobFailure" (
  "id" bigint generated always as identity primary key,
  "job" text not null,
  "at" timestamptz not null default now(),
  "matchdayDate" date,
  "problem" text not null
);

create index "jobFailure_at_idx" on "jobFailure" ("at");
