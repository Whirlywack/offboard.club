import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Fragment, type ReactNode } from "react";
import { MemberCell, MoreLinks, ProfilesNote, ScoreCell } from "../leaderboard";
import board from "../leaderboards.module.css";
import pieces from "../photos/row.webp";
import { longDate } from "../recaps/dates";
import ui from "../ui.module.css";
import styles from "./seasons.module.css";
import { viewerIsMember } from "@/lib/auth";
import { getSeason, readLeaderboards, seasonsSoFar, type Member, type Season } from "@/lib/leaderboards";
import { SEASON_LENGTH } from "@/lib/leaderboard";
import { noticeLater } from "@/lib/request-failures";
import { matchdayStart } from "@/lib/schedule";

// "6 Dec": a Matchday's date in the list of a Season's six, which all fall within a couple of months, so without the
// year; the markup carries the whole date.
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

// Where to go from a Season's page, at the foot of its Leaderboard.
const MORE: [string, string][] = [
  ["/all-time", "All-time Leaderboard"],
  ["/recaps", "Recaps"],
  ["/", "Home"],
];

// The Season Leaderboard of a Season by number, or of the current one, for the two Season pages to put inside their
// <Suspense>. A number with no Season, or one too far off to have a page, is not found; a database that cannot be read
// is said plainly, and logged. The schedule and the ingested Matchdays are read once, then the Season's results.
export async function seasonLeaderboard(which: number | "current"): Promise<ReactNode> {
  await connection();
  const now = new Date();
  const route = which === "current" ? "/seasons" : "/seasons/[number]";
  const [read, member] = await Promise.all([
    readLeaderboards(now)
      .then(async (reading) => {
        const { played, current } = seasonsSoFar(reading);
        return { played, season: await getSeason(which === "current" ? current : which, reading) };
      })
      .catch((error: Error) => {
        console.error("A Season Leaderboard could not be read:", error.message);
        noticeLater(error, route);
        return undefined;
      }),
    viewerIsMember(route),
  ]);
  if (read === undefined)
    return (
      <div className={board.down}>
        <p className={ui.alert}>This Leaderboard can&apos;t be shown right now. Please try again in a minute.</p>
        <MoreLinks links={MORE} />
      </div>
    );
  if (!read.season) notFound();
  return <SeasonView season={read.season} played={read.played} member={member} now={now} />;
}

// The Season's number beside the six pieces, tallest to shortest, with where it stands and its champion; its
// Leaderboard; then, in black, its six Matchdays and the other Seasons.
function SeasonView({ season, played, member, now }: { season: Season; played: number[]; member: boolean; now: Date }) {
  const { number, matchdays, leaderboard, over, champions } = season;
  // How far the Season has gone: the latest of its Matchdays to have been ingested.
  const done = matchdays ? matchdays.findLastIndex((m) => m.ingested) + 1 : 0;
  const others = played.some((n) => n !== number);
  return (
    <article>
      <div className={`${styles.head} ${ui.grain}`}>
        <h1 className={`${styles.title} ${ui.display}`}>
          <em>Season</em> <span className={styles.number}>{number}</span>
        </h1>
        <div className={styles.row}>
          <Image src={pieces} alt="" sizes="(min-width: 900px) min(80vw, 1376px), calc(121vw - 39px)" preload />
        </div>
        <div className={styles.standing}>
          <p className={`${ui.caps} ${styles.label}`}>Season Leaderboard</p>
          <p className={styles.lede}>{progress(season, done, now)}</p>
        </div>
        {over && champions.length > 0 && <Champions champions={champions} score={leaderboard[0].score} />}
      </div>

      <section aria-labelledby="leaderboard" className={board.board}>
        <h2 id="leaderboard" className={ui.display}>
          Leaderboard
        </h2>
        {leaderboard.length === 0 ? (
          <p className={board.empty}>
            {done === 0 ? "It fills in after the first Matchday." : "Nobody is on this Season's Leaderboard."}
          </p>
        ) : (
          <table className={board.table}>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Name</th>
                <th scope="col" className={board.score}>
                  Score
                </th>
                <th scope="col" className={board.number}>
                  Played
                </th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row) => (
                <tr key={row.memberId}>
                  <td>{row.rank}</td>
                  <MemberCell member={row} />
                  <ScoreCell value={row.score} />
                  <td className={board.number}>{row.played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={`${ui.small} ${ui.muted}`}>
          Your score adds up your best four Matchdays. A tie goes to whoever played more Matchdays; if that&apos;s level
          too, they share the rank.
        </p>
        {!member && leaderboard.length > 0 && <ProfilesNote />}
        <MoreLinks links={MORE} />
      </section>

      {(matchdays || others) && (
        <div className={`${styles.time} ${ui.black}`}>
          {matchdays && (
            <section aria-labelledby="matchdays" className={styles.matchdaysSection}>
              <h2 id="matchdays" className={ui.display}>
                <em>The</em> six Matchdays
              </h2>
              <ol className={styles.matchdays} role="list">
                {matchdays.map(({ date, ingested, missed }, i) => {
                  const ordinal = (
                    <span className={styles.ordinal}>
                      Matchday <span className={styles.numeral}>{i + 1}</span>
                    </span>
                  );
                  const when = (
                    <time dateTime={date} className={styles.date}>
                      {shortDate(date)}
                    </time>
                  );
                  return (
                    <li key={date}>
                      {ingested ? (
                        <Link href={`/recaps/${date}`} className={styles.played}>
                          {ordinal}
                          <span className={styles.go}>
                            {when}
                            <span className="visually-hidden">, Recap</span>
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                              <path d="M2 8h11M9 4l4 4-4 4" />
                            </svg>
                          </span>
                        </Link>
                      ) : (
                        <span className={styles.toCome}>
                          {ordinal}
                          {when}
                          {missed && <span className={styles.missed}>Not played</span>}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          {others && (
            <nav aria-label="Seasons" className={styles.seasons}>
              <span className={ui.caps} aria-hidden="true">
                Seasons
              </span>
              {played.map((n) => (
                <Link key={n} href={`/seasons/${n}`} aria-current={n === number ? "page" : undefined}>
                  Season {n}
                </Link>
              ))}
            </nav>
          )}
        </div>
      )}
    </article>
  );
}

// A Sunday's date, kept on one line.
const onSunday = (date: string) => longDate(date).replaceAll(" ", "\u00a0");

const inWords = ["no", "one", "two", "three", "four", "five", "six"];

// Where the Season stands, in a sentence. A Season can end with fewer than six Matchdays played, when one was never
// ingested (lib/leaderboards.ts).
function progress({ number, matchdays, over }: Season, done: number, now: Date): string {
  if (!matchdays) return "Its dates are set once there are sixteen of us.";
  if (over) {
    const played = matchdays.filter((m) => m.ingested).length;
    if (played === SEASON_LENGTH) return "This Season is over.";
    return played === 0
      ? "This Season is over. None of its Matchdays was played."
      : `This Season is over, with ${inWords[played]} of its six Matchdays played.`;
  }
  const first = matchdays[0].date;
  if (done === 0)
    return matchdayStart(first) > now
      ? `Season ${number} starts on ${onSunday(first)}.`
      : `Season ${number} started on ${onSunday(first)}. Its first results aren't in yet.`;
  const next = matchdays[done].date;
  return `Matchday ${done} of ${SEASON_LENGTH} is done. ${
    matchdayStart(next) > now ? `The next one is on ${onSunday(next)}.` : `Results from ${onSunday(next)} aren't in yet.`
  }`;
}

function Champions({ champions, score }: { champions: Member[]; score: number }) {
  const shared = champions.length > 1;
  return (
    <section aria-labelledby="champion" className={styles.champion}>
      <h2 id="champion" className={ui.caps}>
        {shared ? "Season champions" : "Season champion"}
      </h2>
      <p className={`${styles.championNames} ${ui.display}`}>
        {champions.map((c, i) => (
          <Fragment key={c.memberId}>
            {i > 0 && (i === champions.length - 1 ? " and " : ", ")}
            <Link href={`/profiles/${c.memberId}`}>{c.name}</Link>
          </Fragment>
        ))}
      </p>
      <p className={styles.championNote}>
        {shared
          ? `They finished level on ${score} points and on Matchdays played.`
          : `${score} points.`}
      </p>
    </section>
  );
}
