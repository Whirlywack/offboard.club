-- The Lichess accounts of people who left the Club (#15) that the site could not remove from the Club's Lichess team, for
-- the Organiser to remove by hand: the account, when the site gave up, and why, as a sentence for the Organiser. The
-- Organiser page lists them, and the Organiser deletes each row once it is done on Lichess, so that the account of
-- someone who left is not kept for ever. Nothing else about the person is kept here.
create table "teamRemoval" (
  "lichessId" text not null primary key,
  "at" timestamptz not null default now(),
  "problem" text not null
);
