-- The Lichess account a person has connected, which together with the welcome step makes them a Member. Null until
-- they connect one. "lichessId" is Lichess's own id (the username in lower case); one Lichess account can belong to one
-- person at a time. The rating is the blitz rating when the account was connected. No Lichess token is kept.

alter table "user"
  add column "lichessId" text unique,
  add column "lichessUsername" text,
  add column "lichessBlitzRating" integer,
  add column "lichessConnectedAt" timestamptz;
