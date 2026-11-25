import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Fragment, type ReactNode } from "react";
import { MemberCell, ProfilesNote } from "../leaderboard";
import board from "../leaderboards.module.css";
import { longDate } from "../recaps/dates";
import ui from "../ui.module.css";
import styles from "./seasons.module.css";
import { viewerIsMember } from "@/lib/auth";
import { getSeason, seasonsSoFar, type Member, type Season } from "@/lib/leaderboards";
import { SEASON_LENGTH } from "@/lib/leaderboard";
import { matchdayStart } from "@/lib/schedule";

// "6 Dec": a Matchday's date in the list of a Season's six, which all fall within a couple of months, so without the
// year; the markup carries the whole date.
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

// The Season Leaderboard of a Season by number, or of the current one, for the two Season pages to put inside their
// <Suspense>. A number with no Season is not found; a database that cannot be read is said plainly, and logged.
export async function seasonLeaderboard(which: number | "current"): Promise<ReactNode> {
  await connection();
  const now = new Date();
  const [read, member] = await Promise.all([
    seasonsSoFar(now)
      .then(async ({ played, current }) => ({ played, season: await getSeason(which === "current" ? current : which, now) }))
      .catch((error: Error) => {
        console.error("A Season Leaderboard could not be read:", error.message);
        return undefined;
      }),
    viewerIsMember(),
  ]);
  if (read === undefined)
    return <p className={ui.alert}>This Leaderboard can&apos;t be shown right now. Please try again in a minute.</p>;
  if (!read.season) notFound();
  return <SeasonView season={read.season} played={read.played} member={member} now={now} />;
}

function SeasonView({ season, played, member, now }: { season: Season; played: number[]; member: boolean; now: Date }) {
  const { number, matchdays, leaderboard, over, champions } = season;
  // How far the Season has gone: the latest of its Matchdays to have been ingested.
  const done = matchdays ? matchdays.findLastIndex((m) => m.ingested) + 1 : 0;
  return (
    <article className={styles.season}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Season Leaderboard</p>
        <h1>Season {number}</h1>
        <p className={ui.lede}>{progress(season, done, now)}</p>
      </div>

      {over && champions.length > 0 && <Champions champions={champions} score={leaderboard[0].score} />}

      <section aria-labelledby="leaderboard" className={board.board}>
        <h2 id="leaderboard">Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p className={`${board.empty} ${ui.arrive}`}>
            {done === 0
              ? "The Leaderboard fills in after the Season's first Matchday. Everyone who plays is on it."
              : "Nobody is on this Season's Leaderboard."}
          </p>
        ) : (
          <table className={board.table}>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Name</th>
                <th scope="col" className={board.number}>
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
                  <td className={`${board.number} ${board.score}`}>{row.score}</td>
                  <td className={board.number}>{row.played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={`${ui.small} ${ui.muted}`}>
          Your Season score adds up your best four Matchdays, so missing two Sundays costs you nothing. When two scores
          are level, whoever played more Matchdays goes higher; if that&apos;s level too, they share the rank.
        </p>
        {!member && leaderboard.length > 0 && <ProfilesNote />}
      </section>

      {matchdays && (
        <section aria-labelledby="matchdays" className={styles.matchdaysSection}>
          <h2 id="matchdays">The six Matchdays</h2>
          <ol className={styles.matchdays} role="list">
            {matchdays.map(({ date, ingested }, i) => {
              const inside = (
                <>
                  <span className={styles.ordinal}>Matchday {i + 1}</span>
                  <time dateTime={date} className={styles.date}>
                    {shortDate(date)}
                  </time>
                </>
              );
              return (
                <li key={date}>
                  {ingested ? (
                    <Link href={`/recaps/${date}`} className={styles.played}>
                      {inside}
                      <span className="visually-hidden">, Recap</span>
                    </Link>
                  ) : (
                    <span className={styles.toCome}>{inside}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {played.some((n) => n !== number) && (
        <nav aria-label="Seasons" className={styles.seasonsNav}>
          <span className={styles.seasonsLabel} aria-hidden="true">
            Seasons
          </span>
          {played.map((n) => (
            <Link key={n} href={`/seasons/${n}`} aria-current={n === number ? "page" : undefined}>
              Season {n}
            </Link>
          ))}
        </nav>
      )}
    </article>
  );
}

// A Sunday's date, kept on one line.
const onSunday = (date: string) => longDate(date).replaceAll(" ", "\u00a0");

// Where the Season stands, in a sentence.
function progress({ number, matchdays, over }: Season, done: number, now: Date): string {
  if (!matchdays) return "Season 1 starts once sixteen Members have joined, on the first Sunday at least a week later.";
  const first = matchdays[0].date;
  if (done === 0)
    return matchdayStart(first) > now
      ? `Season ${number} starts on ${onSunday(first)}.`
      : `Season ${number} started on ${onSunday(first)}. Its first results aren't in yet.`;
  if (over) return "All six Matchdays are done, so this Season is over.";
  const next = matchdays[done].date;
  return `Matchday ${done} of ${SEASON_LENGTH} is done. ${
    matchdayStart(next) > now ? `The next one is on ${onSunday(next)}.` : `Results from ${onSunday(next)} aren't in yet.`
  }`;
}

function Champions({ champions, score }: { champions: Member[]; score: number }) {
  const shared = champions.length > 1;
  return (
    <section aria-labelledby="champion" className={`${styles.champion} ${ui.arrive}`}>
      <h2 id="champion" className={styles.championLabel}>
        {shared ? "Season champions" : "Season champion"}
      </h2>
      <p className={styles.championNames}>
        {champions.map((c, i) => (
          <Fragment key={c.memberId}>
            {i > 0 && (i === champions.length - 1 ? " and " : ", ")}
            <Link href={`/profiles/${c.memberId}`}>{c.name}</Link>
          </Fragment>
        ))}
      </p>
      <p className={styles.championNote}>
        {shared
          ? `They finished level on ${score} points and on Matchdays played, so they share the title.`
          : `${score} points from their best four Matchdays.`}
      </p>
    </section>
  );
}
