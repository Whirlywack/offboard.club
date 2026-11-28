// Turns a finished Lichess Swiss export into a Matchday's scores, Games and Awards.
// Pure: no network, no database. Input is the two ndjson exports as text.

export type Colour = "white" | "black";

export type MemberRef = { memberId: string; lichessId: string };

export type Score = {
  memberId: string;
  rank: number; // Lichess's final order, renumbered among Members
  points: number; // byes and late-join points included
  rating: number;
};

export type Game = {
  lichessGameId: string;
  white: string; // memberId
  black: string; // memberId
  winner: Colour | null; // null = draw
  status: string; // Lichess status: mate, resign, outoftime, draw, ...
  plies: number; // half-moves played
  ratings: Record<Colour, number>;
  winnerClockCentis: number | null; // winner's remaining time at the end
  finishedAt: number; // Lichess lastMoveAt, ms since epoch
};

// A Game as ingestion stores it, with its moves as Lichess sent them, or null when they are not text of their shape
// and length (MOVES).
export type IngestedGame = Game & { moves: string | null };

export type Award = { kind: "biggestUpset" | "leastTimeLeft" | "fastestCheckmate"; memberId: string; lichessGameId: string; value: number };

const parseNdjson = (text: string) =>
  text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const other = (c: Colour): Colour => (c === "white" ? "black" : "white");

// Lichess sends a Game's moves as its half-moves in SAN with one space between each, "e4 e5 Nf3", or as "" when
// nobody moved (lila: GameApiV2 and scalachess's Dumper). A half-move is at most 7 characters ("exd8=Q+", "Qa1xb2#"),
// and Lichess ends a Game at its 600th (lila: Game.maxPlies), so no Game it sends is longer than MOVES_MAX.
const SAN = String.raw`(?:[NBRQK][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[NBRQ])?|O-O(?:-O)?)[+#]?`;
const MOVES = new RegExp(`^(?:${SAN}(?: ${SAN})*)?$`);
const MOVES_MAX = 600 * 8 - 1;

export function ingestMatchday(resultsNdjson: string, gamesNdjson: string, members: MemberRef[]) {
  const byLichess = new Map(members.map((m) => [m.lichessId.toLowerCase(), m.memberId]));

  // Participants who are not Members are ignored.
  const scores: Score[] = parseNdjson(resultsNdjson)
    .sort((a, b) => a.rank - b.rank)
    .flatMap((r) => {
      const memberId = byLichess.get(String(r.username).toLowerCase());
      return memberId ? [{ memberId, points: r.points, rating: r.rating }] : [];
    })
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const games: IngestedGame[] = parseNdjson(gamesNdjson).flatMap((g) => {
    const white = byLichess.get(g.players.white.user?.id);
    const black = byLichess.get(g.players.black.user?.id);
    if (!white || !black) return [];
    const winner: Colour | null = g.winner ?? null;
    const clocks: number[] = g.clocks ?? [];
    // Moves that are not text count as none. Text too long or not of their shape is counted, but not kept.
    const sent: string | null = typeof g.moves === "string" ? g.moves : null;
    // Clocks alternate white, black, one per half-move, plus a final entry for the side to move
    // when the Game ends without a move (resignation, time, agreed draw). Either way the
    // winner's last entry is their time left.
    const parity = winner === "black" ? 1 : 0;
    const winnerClocks = clocks.filter((_, i) => i % 2 === parity);
    return [{
      lichessGameId: g.id,
      white,
      black,
      winner,
      status: g.status,
      plies: sent ? sent.split(" ").length : 0,
      ratings: { white: g.players.white.rating, black: g.players.black.rating },
      winnerClockCentis: winner && winnerClocks.length ? winnerClocks[winnerClocks.length - 1] : null,
      finishedAt: g.lastMoveAt,
      moves: sent !== null && sent.length <= MOVES_MAX && MOVES.test(sent) ? sent : null,
    }];
  });

  return { scores, games, awards: awards(games) };
}

// White makes the odd half-moves, Black the even ones.
const movesBy = (g: Game, c: Colour) => (c === "white" ? Math.ceil(g.plies / 2) : Math.floor(g.plies / 2));

// An Award with no qualifying Game is omitted. Ties go to the Game that finished first.
export function awards(games: Game[]): Award[] {
  // A win over an opponent who never moved is a no-show, not an achievement.
  const won = games
    .filter((g) => g.winner && movesBy(g, other(g.winner)) > 0)
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const best = (pool: Game[], value: (g: Game) => number) =>
    pool.reduce<Game | null>((b, g) => (b === null || value(g) < value(b) ? g : b), null);
  const out: Award[] = [];
  const add = (kind: Award["kind"], g: Game | null, value: (g: Game) => number) => {
    if (g) out.push({ kind, memberId: g[g.winner!], lichessGameId: g.lichessGameId, value: value(g) });
  };

  const gap = (g: Game) => g.ratings[other(g.winner!)] - g.ratings[g.winner!];
  add("biggestUpset", best(won.filter((g) => gap(g) > 0), (g) => -gap(g)), gap);

  const timed = won.filter((g) => g.winnerClockCentis !== null);
  add("leastTimeLeft", best(timed, (g) => g.winnerClockCentis!), (g) => g.winnerClockCentis!);

  // Ranked by half-moves, so White's mate on move 18 beats Black's; shown in moves.
  add("fastestCheckmate", best(won.filter((g) => g.status === "mate"), (g) => g.plies), (g) => movesBy(g, g.winner!));

  return out;
}
