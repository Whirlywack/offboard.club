-- Each Game's moves as Lichess sent them (#105), so that a later ticket can replay an Award's Game on a board of the
-- site's own; nothing shows them yet. They are the Game's half-moves in SAN, one space between each ("e4 e5 Nf3"), or
-- an empty string when nobody moved. Null for a Game stored before this, and for one whose moves Lichess did not send
-- in that shape (lib/matchday.ts). When a player's account is deleted (#15) the moves stay with the Game, as its
-- Lichess id and ratings do.
alter table "game" add column "moves" text;
