-- Matchdays, their results and their Games. Dates are Vilnius calendar days.
--
-- A Matchday is one Lichess Swiss tournament on the Club's team, and has a row from when the tournament is known:
-- when the site creates it ahead of the day (#11), or at ingestion for a tournament made by hand. "ingestedAt" stays
-- null until its results and Games are stored, all in one transaction, and a Recap exists only after that.
create table "matchday" (
  "date" date not null primary key,
  "lichessTournamentId" text unique,
  "ingestedAt" timestamptz,
  check ("ingestedAt" is null or "lichessTournamentId" is not null)
);

-- Each Member who appears in an ingested Matchday's results, which is what having played it means. "points" are their
-- Lichess points, byes and late-join points included, in halves, which double precision holds exactly. "rank" is their
-- place in Lichess's final order among the Members who played, "rating" their rating in the tournament, and
-- "companyDomain" the Company they belonged to when it was ingested, or null for none, kept when they change Company
-- later. A person's results go when their account is deleted (#15), so they leave every Leaderboard and Recap.
create table "matchdayResult" (
  "matchdayDate" date not null references "matchday" ("date"),
  "userId" text not null references "user" ("id") on delete cascade,
  "rank" integer not null check ("rank" >= 1),
  "points" double precision not null check ("points" >= 0),
  "rating" integer not null,
  "companyDomain" text references "company" ("domain"),
  primary key ("matchdayDate", "userId"),
  unique ("matchdayDate", "rank")
);

create index "matchdayResult_userId_idx" on "matchdayResult" ("userId");

-- Every Game between two Members in an ingested Matchday, as Lichess exported it: who had which colour, the winner's
-- colour or null for a draw, Lichess's status ("mate", "resign", "outoftime", "draw", ...), half-moves played, both
-- ratings, the winner's remaining clock in centiseconds (null for a draw or without clock times) and when the last move
-- was made. When a player's account is deleted (#15) their side becomes null, and the Game stays in the opponent's
-- history against a former member.
create table "game" (
  "lichessGameId" text not null primary key,
  "matchdayDate" date not null references "matchday" ("date"),
  "whiteId" text references "user" ("id") on delete set null,
  "blackId" text references "user" ("id") on delete set null,
  "winner" text check ("winner" in ('white', 'black')),
  "status" text not null,
  "plies" integer not null check ("plies" >= 0),
  "whiteRating" integer not null,
  "blackRating" integer not null,
  "winnerClockCentis" integer check ("winnerClockCentis" >= 0),
  "finishedAt" timestamptz not null,
  check ("winner" is not null or "winnerClockCentis" is null)
);

create index "game_matchdayDate_idx" on "game" ("matchdayDate");
create index "game_whiteId_idx" on "game" ("whiteId");
create index "game_blackId_idx" on "game" ("blackId");

-- Whether Lichess showed the connected account as marked for breaking its terms of service, or as closed, when it was
-- last looked at. Neither can be true on connecting, since such an account cannot be connected; both are looked at
-- again, with the blitz rating, at each Matchday ingested that the Member played. Such Members are left out of
-- Leaderboards while it lasts (#9).
alter table "user"
  add column "lichessMarked" boolean not null default false,
  add column "lichessClosed" boolean not null default false;
