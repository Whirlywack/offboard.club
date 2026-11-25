// A Recap's Awards (#8). They are worked out each time a Recap is read, by lib/matchday.ts's awards(), from the
// Matchday's Games as stored, so they always follow the Games and the people in them: nothing about an Award is kept of
// its own.

import { awards, type Award, type Colour, type Game } from "./matchday";

// An Award's name, value and winner are public, like the rest of a Recap. Its Game, replayed on Lichess's board, shows
// both players' Lichess usernames, which the site shows to Members only, so only signed-in Members are shown it: the
// Organiser's decision of 2026-11-25 (docs/adr/0002). Making the Games public would be this one line.
export const AWARD_GAMES_ARE_PUBLIC = false;

// A decisive Game of the Matchday as stored. A side is null once that player has left the Club (#15).
export type StoredGame = {
  lichessGameId: string;
  whiteId: string | null;
  blackId: string | null;
  winner: Colour;
  status: string;
  plies: number;
  whiteRating: number;
  blackRating: number;
  winnerClockCentis: number | null;
  finishedAt: Date;
};

// Someone in the Matchday's results, who is a Member: their name, and whether their Lichess account is marked or closed.
export type Player = { name: string; excluded: boolean };

// An Award with what the Recap shows of it: the winner's name, the side they played, and how many half-moves the Game
// lasted, so that its board opens on the last move, from the winner's side. `opponentLeft` when the loser has since
// left the Club: the Game is then shown to nobody, as Lichess's board and page for it still name their account, which
// is how a Profile's Games treat someone who has left (docs/adr/0002).
export type RecapAward = Award & { name: string; colour: Colour; plies: number; opponentLeft: boolean };

// The Awards of a Matchday from its decisive Games and the Members in its results, by id. A Game can win an Award only
// if its winner is still a Member in good standing: neither player's Lichess account may be marked or closed, and the
// winner must not have left. A loser who has left since does not take the Award from the winner; a loser who is neither
// in the results nor gone is unknown, and the Game is passed over.
export function recapAwards(stored: StoredGame[], players: Map<string, Player>): RecapAward[] {
  const fair = new Map<string, StoredGame>();
  const games: Game[] = [];
  for (const g of stored) {
    const [winnerId, loserId] = g.winner === "white" ? [g.whiteId, g.blackId] : [g.blackId, g.whiteId];
    const winner = winnerId === null ? undefined : players.get(winnerId);
    const loserExcluded = loserId !== null && (players.get(loserId)?.excluded ?? true);
    if (!winner || winner.excluded || loserExcluded) continue;
    fair.set(g.lichessGameId, g);
    games.push({
      lichessGameId: g.lichessGameId,
      // awards() reads only the winner's side, so a departed loser's empty side never matters.
      white: g.whiteId ?? "",
      black: g.blackId ?? "",
      winner: g.winner,
      status: g.status,
      plies: g.plies,
      ratings: { white: g.whiteRating, black: g.blackRating },
      winnerClockCentis: g.winnerClockCentis,
      finishedAt: g.finishedAt.getTime(),
    });
  }
  return awards(games).map((award) => {
    const game = fair.get(award.lichessGameId)!;
    const loserId = game.winner === "white" ? game.blackId : game.whiteId;
    const name = players.get(award.memberId)!.name;
    return { ...award, name, colour: game.winner, plies: game.plies, opponentLeft: loserId === null };
  });
}

// Lichess's own board for a Game, as its page for webmasters gives it (lichess.org/developers#embed-game, made by
// modules/web/src/main/ui/SitePages.scala in lichess-org/lila): /embed/game/<id>, then /white or /black for the side
// at the bottom; ?theme= picks the board's colours (blue, brown, green, ic or purple) and &bg= its background (light,
// dark or system, which follows the viewer's setting, as this site does). #<n> opens it after n half-moves
// (ui/site/src/site.lpvEmbed.ts). The board is a page of Lichess's own, so this site loads no script from Lichess.
export const awardGameEmbedUrl = ({ lichessGameId, colour, plies }: RecapAward) =>
  `https://lichess.org/embed/game/${encodeURIComponent(lichessGameId)}/${colour}?theme=brown&bg=system#${plies}`;

// The Game's own page on Lichess, from the winner's side.
export const awardGameUrl = ({ lichessGameId, colour }: RecapAward) =>
  `https://lichess.org/${encodeURIComponent(lichessGameId)}/${colour}`;
