import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { signOut } from "./actions";
import { Avatar } from "./avatar";
import { ExternalLink } from "./external-link";
import styles from "./home.module.css";
import leaderboards from "./leaderboards.module.css";
import { SignIn } from "./sign-in";
import ui from "./ui.module.css";
import { getSession, viewerIsMember } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";
import { organiserEmail } from "@/lib/contact";
import { newChampions } from "@/lib/leaderboards";
import { lichessSwissUrl } from "@/lib/lichess";
import { matchdayOn } from "@/lib/matchdays";
import { mustConnectLichess } from "@/lib/members";
import { signUpsNeeded, ZONE } from "@/lib/schedule";
import { upcomingMatchday } from "@/lib/seasons";
import { countSignUps } from "@/lib/signups";

export default function Home() {
  return (
    <main id="main" className={`${ui.wide} ${styles.home}`}>
      <section className={styles.hero} aria-labelledby="title">
        <div className={styles.heroText}>
          <p className={ui.eyebrow}>Free chess Club · Vilnius</p>
          <h1 id="title" className={styles.title}>
            Sunday chess for people in tech
          </h1>
          <p className={styles.lede}>
            Five Games on Lichess every Sunday at 20:00, against other people who work in tech in and around Vilnius.
            Each Game is 5 minutes on the clock plus 3 seconds a move.
          </p>
        </div>
        <div className={styles.heroSide}>
          <Suspense>
            <NextMatchday />
          </Suspense>
          <Suspense>
            <You />
          </Suspense>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="leaderboards">
        <h2 id="leaderboards">Leaderboards</h2>
        <div className={styles.sectionText}>
          <Suspense>
            <SeasonChampions />
          </Suspense>
          <p>
            A Season is six Matchdays, and your best four count. Leaderboards are public and show your real name from
            LinkedIn.
          </p>
          <p className={leaderboards.links}>
            <Link href="/seasons">This Season&apos;s Leaderboard</Link>
            <Link href="/all-time">All-time Leaderboard</Link>
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="recaps">
        <h2 id="recaps">Recaps</h2>
        <div className={styles.sectionText}>
          <p>
            <Link href="/recaps">Read the Recaps of past Matchdays</Link>
          </p>
        </div>
      </section>
    </main>
  );
}

// The next Matchday once Season 1 is scheduled; until then, how many more sign-ups it is waiting for.
// Left out, and logged, if the database cannot be read. Exported for app/home.test.ts.
export async function NextMatchday() {
  await connection();
  const unreadable = (error: Error) => void console.error("Home page could not read the schedule:", error.message);
  const next = await upcomingMatchday(new Date()).catch(unreadable);
  if (next) {
    const when = next.start.toLocaleString("en-GB", {
      timeZone: ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    const tournament = await tournamentForMembers(next.date).catch(unreadable);
    return (
      <div className={`${styles.status} ${ui.arrive}`}>
        <p className={styles.statusLabel}>
          <span className={ui.marker} aria-hidden="true" /> Next Matchday
        </p>
        <p className={styles.statusValue}>
          <time dateTime={next.start.toISOString()}>{when}</time>
        </p>
        {tournament && (
          <p className={styles.statusLink}>
            <ExternalLink href={lichessSwissUrl(tournament)}>Join this Matchday on Lichess</ExternalLink>
          </p>
        )}
      </div>
    );
  }
  const signUps = next === null ? await countSignUps().catch(unreadable) : undefined;
  const needed = signUps === undefined ? null : signUpsNeeded(signUps);
  if (needed === null) return null;
  return (
    <div className={`${styles.status} ${ui.arrive}`}>
      <p className={styles.statusLabel}>
        <span className={ui.marker} aria-hidden="true" /> Season 1
      </p>
      <p className={styles.statusValue}>
        <span className={styles.count}>{needed}</span> more {needed === 1 ? "Member" : "Members"} to go
      </p>
      <p className={styles.statusNote}>It starts on the first Sunday at least a week after the sixteenth joins.</p>
    </div>
  );
}

// The Lichess tournament of the Matchday of `date`, once the site has created it, for a Member to join; null for anyone
// else. Only the Club's team can join it, and each Member is in the team, so a visitor gets the time alone.
async function tournamentForMembers(date: string): Promise<string | null> {
  if (!(await viewerIsMember())) return null;
  return (await matchdayOn(date))?.lichessTournamentId ?? null;
}

// The champion of the Season that has just ended, from its sixth Matchday until the next Season's first. Left out, and
// logged, if the database cannot be read.
async function SeasonChampions() {
  await connection();
  const named = await newChampions(new Date()).catch(
    (error: Error) => void console.error("Home page could not read the Season champion:", error.message),
  );
  if (!named) return null;
  const names = new Intl.ListFormat("en-GB", { type: "conjunction" }).format(named.champions.map((c) => c.name));
  // "Season 1" kept on one line.
  const season = <Link href={`/seasons/${named.season}`}>{`Season ${named.season}`}</Link>;
  return (
    <p className={`${leaderboards.homeChampion} ${ui.arrive}`}>
      <span className={ui.marker} aria-hidden="true" />
      <span>
        {named.champions.length > 1 ? (
          <>
            <strong>{names}</strong> share the {season} title.
          </>
        ) : (
          <>
            <strong>{names}</strong> is the {season} champion.
          </>
        )}
      </span>
    </p>
  );
}

async function You() {
  const session = await getSession().catch(() => null);
  if (!session) return <SignIn contactable={organiserEmail() !== null} />;
  const { name, image } = session.user;
  const unfinished = mustWelcome(session.user) || mustConnectLichess(session.user);
  return (
    <section aria-label="You" className={`${styles.you} ${ui.arrive}`}>
      <div className={styles.who}>
        <Avatar name={name} src={image ?? null} size="small" />
        <p>
          <span className={styles.whoLabel}>Signed in as</span>
          <span className={styles.whoName}>{name}</span>
        </p>
        <form action={signOut} className={styles.signOut}>
          <button>Sign out</button>
        </form>
      </div>
      <div className={ui.actions}>
        {unfinished ? (
          <Link className={ui.button} href={mustWelcome(session.user) ? "/welcome" : "/welcome/lichess"}>
            Finish signing up
          </Link>
        ) : (
          <>
            <Link className={ui.button} href={`/profiles/${session.user.id}`}>
              Your Profile
            </Link>
            <Link className={ui.quiet} href="/profile">
              Edit your Profile
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
