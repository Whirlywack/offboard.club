-- The tournaments the site created on Lichess for a Sunday that is no longer a Matchday, because the Organiser skipped it
-- or moved a Season's start, and could not cancel there (#16), for the Organiser to cancel by hand: the tournament, the
-- Sunday it was for, and why, as a sentence for the Organiser. The Organiser page lists them, and the Organiser deletes
-- each row once it is done on Lichess; a row whose Sunday becomes a Matchday again goes by itself, its tournament wanted.
create table "tournamentCancellation" (
  "lichessTournamentId" text not null primary key,
  "date" date not null,
  "problem" text not null
);
