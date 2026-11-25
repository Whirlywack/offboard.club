import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink } from "../external-link";
import ui from "../ui.module.css";
import styles from "./awards.module.css";
import { Replay } from "./replay";
import { awardGameEmbedUrl, awardGameUrl, type RecapAward } from "@/lib/awards";

const TITLES: Record<RecapAward["kind"], string> = {
  biggestUpset: "Biggest upset",
  leastTimeLeft: "Closest call",
  fastestCheckmate: "Fastest checkmate",
};

// An Award's name as running text has it: "biggest upset".
const inText = (award: RecapAward) => TITLES[award.kind].toLowerCase();

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// Seconds as the clock showed them: to a tenth, never rounded up, so 2.78 seconds left is 2.7.
const seconds = (centis: number) => (Math.floor(centis / 10) / 10).toFixed(1);

// What the winner did, with the Award's number in it.
function feat({ kind, value }: RecapAward): ReactNode {
  const n = <strong>{kind === "leastTimeLeft" ? seconds(value) : value}</strong>;
  if (kind === "biggestUpset") return <>Beat someone rated {n} {plural(value, "point", "points")} higher.</>;
  if (kind === "leastTimeLeft") return <>Won with {n} seconds left on the clock.</>;
  return <>Checkmated their opponent in {n} {plural(value, "move", "moves")}.</>;
}

// A Recap's Awards: what each was for, who won it and the number that won it, and, when `showGames`, the Game on
// Lichess's own board. Nothing about a Game reaches a visitor who is not shown it: not its board, its link or its id.
// Nothing at all is shown when no Game won anything.
export function Awards({ awards, showGames }: { awards: RecapAward[]; showGames: boolean }) {
  if (awards.length === 0) return null;
  return (
    <section aria-labelledby="awards" className={styles.awards}>
      <div className={styles.heading}>
        <h2 id="awards">Awards</h2>
        <p className={`${ui.small} ${ui.muted}`}>Any Member can win one of these, whatever their rating.</p>
      </div>
      <ul className={styles.list} role="list">
        {awards.map((award) => (
          <li key={award.kind} className={styles.award}>
            <h3 className={styles.title}>{TITLES[award.kind]}</h3>
            <p className={styles.winner}>
              <Link href={`/profiles/${award.memberId}`}>{award.name}</Link>
            </p>
            <p className={styles.feat}>{feat(award)}</p>
            {showGames && (
              <Replay label={`of the ${inText(award)}`} board={<GameBoard award={award} />}>
                <p className={styles.source}>
                  This is Lichess&apos;s own board, loaded from lichess.org.{" "}
                  <ExternalLink href={awardGameUrl(award)}>Open the Game on Lichess</ExternalLink>
                </p>
              </Replay>
            )}
          </li>
        ))}
      </ul>
      {!showGames && <p className={`${ui.small} ${ui.muted}`}>Signed-in Members can replay each Game.</p>}
    </section>
  );
}

// Scripts, new tabs from its links (out of the sandbox, so that Lichess opens as itself) and its PGN download are all
// Lichess's board needs. Without allow-same-origin it runs as an anonymous origin, so it cannot read Lichess's cookies or
// storage from inside this page, and it cannot navigate this page.
const SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";

// The Game on Lichess's board, opened on its last move from the winner's side. Lazy as well, for a board opened far
// down a long page.
export function GameBoard({ award }: { award: RecapAward }) {
  return (
    <div className={styles.board}>
      <iframe
        src={awardGameEmbedUrl(award)}
        title={`Replay of ${award.name}'s ${inText(award)}, on Lichess`}
        loading="lazy"
        sandbox={SANDBOX}
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
