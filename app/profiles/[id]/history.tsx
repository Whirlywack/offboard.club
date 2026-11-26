import Link from "next/link";
import { ExternalLink } from "../../external-link";
import { longDate } from "../../recaps/dates";
import ui from "../../ui.module.css";
import styles from "./profile.module.css";
import { GAMES_MOST, GAMES_SHOWN, type HeadToHead, type History, type HistoryGame } from "@/lib/history";
import { lichessGameUrl } from "@/lib/lichess";

// A Streak shows from two Matchdays in a row: one is not a run yet, and after a gap a "1" would read as a reset.
export const STREAK_SHOWN_FROM = 2;

// Matchdays played and the Streak, as rows of the Profile's facts: Matchdays played from the first, the Streak from
// STREAK_SHOWN_FROM. A Streak of zero shows nothing at all, so missing a Sunday is never written on anyone's Profile.
export function Attendance({ history }: { history: History }) {
  return (
    <>
      {history.played > 0 && (
        <div className={styles.figure}>
          <dt>Matchdays played</dt>
          <dd>{history.played}</dd>
        </div>
      )}
      {history.streak >= STREAK_SHOWN_FROM && (
        <div className={styles.figure}>
          <dt>Streak</dt>
          <dd>
            {history.streak} <span>Matchdays in a row</span>
          </dd>
        </div>
      )}
    </>
  );
}

// The Games, newest first, under the date of the Matchday each was played in.
function byMatchday(games: HistoryGame[]) {
  const evenings: { date: string; games: HistoryGame[] }[] = [];
  for (const game of games) {
    const last = evenings.at(-1);
    if (last?.date === game.date) last.games.push(game);
    else evenings.push({ date: game.date, games: [game] });
  }
  return evenings;
}

// "won 5, drew 2 and lost 1"
const list = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]);

// The viewer's record against the Member as a sentence, said the way people say it: counts of none are left out, so
// "You won 1 and lost 7", not "You won 1, drew 0 and lost 7". A number never ends a line apart from its word.
export function together(firstName: string, { wins, draws, losses }: HeadToHead) {
  const nb = " ";
  const total = wins + draws + losses;
  const parts = (
    [
      [wins, "won"],
      [draws, "drew"],
      [losses, "lost"],
    ] as const
  ).filter(([n]) => n > 0);
  if (total === 1) return `You and ${firstName} have played one Game, which you ${parts[0][1]}.`;
  const record =
    parts.length === 1
      ? `${parts[0][1]} ${total === 2 ? "both" : `all${nb}${total}`}`
      : list(parts.map(([n, verb]) => `${verb}${nb}${n}`));
  return `You and ${firstName} have played ${total}${nb}Games. You ${record}.`;
}

const said = { won: "Won", drew: "Drew", lost: "Lost" } as const;
const joining = { won: "against", drew: "with", lost: "to" } as const;

function Opponent({ game }: { game: HistoryGame }) {
  if (!game.opponent) return <>a former member</>;
  return <Link href={`/profiles/${game.opponent.id}`}>{game.opponent.name}</Link>;
}

// `firstName` names the Member to others; `own` is true on the viewer's own Profile. `showingAll` once the viewer asked
// for every Game.
export function Games({
  memberId,
  firstName,
  own,
  history,
  showingAll,
}: {
  memberId: string;
  firstName: string;
  own: boolean;
  history: History;
  showingAll: boolean;
}) {
  const { games, total, headToHead, played } = history;
  const hidden = total - games.length;
  // Once every Game is listed, the first of those that were not shown before, where "Show all" takes the reader.
  const firstMore = showingAll ? games[GAMES_SHOWN]?.lichessGameId : undefined;
  return (
    <section aria-labelledby="games" className={styles.games}>
      <div>
        <h2 id="games" className={`${styles.gamesTitle} ${ui.display}`}>
          <em>Games</em>
        </h2>
        {headToHead && <p className={styles.together}>{together(firstName, headToHead)}</p>}
      </div>
      <div className={styles.record}>
        {games.length === 0 ? (
          <p className={styles.none}>
            {played > 0
              ? "No Games against other Members yet."
              : own
                ? "Your Games appear here after your first Matchday."
                : `${firstName} hasn't played a Matchday yet.`}
          </p>
        ) : (
          <ol className={styles.evenings} role="list">
            {byMatchday(games).map((evening) => (
              <li key={evening.date}>
                <h3 className={styles.evening}>
                  <Link href={`/recaps/${evening.date}`}>
                    <span className="visually-hidden">Recap of </span>
                    <time dateTime={evening.date}>{longDate(evening.date)}</time>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                      <path d="M3 12h17M14 6l6 6-6 6" />
                    </svg>
                  </Link>
                </h3>
                <ol className={styles.played} role="list">
                  {evening.games.map((game) => (
                    <li key={game.lichessGameId} id={game.lichessGameId === firstMore ? "more" : undefined}>
                      <p>
                        {said[game.result]} {joining[game.result]} <Opponent game={game} />
                      </p>
                      {/* Lichess's page for a Game names both accounts, and someone who has left asked to be removed. */}
                      {game.opponent && (
                        <ExternalLink href={lichessGameUrl(game.lichessGameId, game.colour)}>
                          <span className="visually-hidden">Game against {game.opponent.name} on </span>
                          Lichess
                        </ExternalLink>
                      )}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
        {hidden > 0 && !showingAll && (
          <p className={styles.all}>
            {/* To the first Game not shown before, so the next Tab carries on from there. */}
            <Link className={ui.quiet} href={`/profiles/${memberId}?games=all#more`}>
              Show all {total} Games
            </Link>
          </p>
        )}
        {hidden > 0 && showingAll && (
          <p className={styles.note}>
            {/* Not "on their Lichess profile": after a swap of account, the older Games are on the old one. */}
            Showing the latest {GAMES_MOST} of {total} Games. Older ones are on Lichess.
          </p>
        )}
      </div>
    </section>
  );
}
