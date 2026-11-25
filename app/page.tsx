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
import { newChampions } from "@/lib/leaderboards";
import { lichessSwissUrl } from "@/lib/lichess";
import { matchdayOn } from "@/lib/matchdays";
import { mustConnectLichess } from "@/lib/members";
import { signUpsNeeded, ZONE } from "@/lib/schedule";
import { nextMatchdayIn, readSchedule, type Schedule } from "@/lib/seasons";
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
            Five quick Games on Lichess every Sunday at 20:00, against other people who work in tech in and around
            Vilnius. Chess is the weekly excuse to show up; meeting people is the point.
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

      <section className={styles.section} aria-labelledby="who">
        <h2 id="who">Who it&apos;s for</h2>
        <div className={styles.sectionText}>
          <p>
            Engineers, designers, founders and operators in and around Vilnius who&apos;d like to meet more people in
            tech. It&apos;s meant for people who play casually: a rating of 900 is as welcome as one of 1900. You join on
            your own and it&apos;s free, so you don&apos;t need colleagues to join with or a company budget.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className={styles.steps} role="list">
          <li>
            <h3>Join</h3>
            <p>
              Sign in with LinkedIn, agree to the house rules and to your name appearing on public Leaderboards, then
              connect your Lichess account. That makes you a Member.
            </p>
          </li>
          <li>
            <h3>Play on Sunday</h3>
            <p>
              Every Sunday at 20:00 Vilnius time there&apos;s a Matchday on Lichess: five Games against other Members,
              each with 5 minutes a side plus 3 seconds a move.
            </p>
          </li>
          <li>
            <h3>Read the Recap</h3>
            <p>
              Afterwards the Matchday gets a Recap that anyone can read. It has that night&apos;s Leaderboard and Awards
              for things any Member can pull off at any rating, such as the biggest upset.
            </p>
          </li>
          <li>
            <h3>Keep your best four</h3>
            <p>
              Six Matchdays make a Season, and your Season score adds up your best four, so missing two Sundays costs
              you nothing.
            </p>
          </li>
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="people">
        <h2 id="people">Meeting people</h2>
        <div className={styles.sectionText}>
          <p>
            Profiles are there so the chess leads to conversations. Each has a Member&apos;s name and photo, plus
            whatever they choose to add: where they work, their position, and what they&apos;re open to, like a coffee
            or hearing about jobs. Only signed-in Members can see Profiles; Leaderboards and Recaps are public and show
            names and Companies.
          </p>
          <p className={styles.plans}>Still to come: a Telegram group for Members.</p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="rules">
        <h2 id="rules">House rules</h2>
        <div className={styles.sectionText}>
          <p>
            There are two: no outside help during Games, and no sales or recruiting pitches unless the other
            person&apos;s &ldquo;open to&rdquo; line invites it.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="leaderboards">
        <h2 id="leaderboards">Leaderboards</h2>
        <div className={styles.sectionText}>
          <Suspense>
            <SeasonChampions />
          </Suspense>
          <p>
            The Season Leaderboard adds up each Member&apos;s best four Matchdays. The all-time one counts only how many
            Sundays you&apos;ve played, so anyone can top it by showing up.
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

// Lichess lets a Member join a Matchday late, until its third round starts. The site does not know the round, so a
// Member is shown the Matchday under way for this long after its start.
const LATE_JOIN_MS = 90 * 60_000;

// The next Matchday once Season 1 is scheduled; until then, how many more sign-ups it is waiting for. A Member also gets
// the link to its Lichess tournament once the site has created it, and the Matchday under way in its place while they
// may still join that one. Only the Club's team can join it, and each Member is in the team, so anyone else gets the
// next Matchday's time alone. Left out, and logged, if the database cannot be read. Exported for app/home.test.ts.
export async function NextMatchday() {
  await connection();
  const unreadable = (error: Error) => void console.error("Home page could not read the schedule:", error.message);
  const now = new Date();
  const schedule = await readSchedule(now).catch(unreadable);
  const next = schedule && nextMatchdayIn(schedule, now);
  if (next) {
    const member = await viewerIsMember();
    const underWay = member ? await lateToJoin(schedule!, now).catch(unreadable) : null;
    const shown = underWay ?? next;
    const tournament =
      underWay?.tournament ?? (member ? (await matchdayOn(next.date).catch(unreadable))?.lichessTournamentId : null);
    const when = shown.start.toLocaleString("en-GB", {
      timeZone: ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <div className={`${styles.status} ${ui.arrive}`}>
        <p className={styles.statusLabel}>
          <span className={ui.marker} aria-hidden="true" /> {underWay ? "Matchday under way" : "Next Matchday"}
        </p>
        <p className={styles.statusValue}>
          <time dateTime={shown.start.toISOString()}>{when}</time>
        </p>
        <p className={styles.statusNote}>
          {underWay
            ? "Lichess lets you join until round 3 starts."
            : "Vilnius time, on Lichess. Five Games, 5 minutes a side plus 3 seconds a move."}
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
      <p className={styles.statusNote}>
        Season 1 starts once sixteen Members have joined, on the first Sunday at least a week later.
      </p>
    </div>
  );
}

// The Matchday under way that a Member is still shown, with its tournament: until 90 minutes after its start, while
// Lichess may still let them join it late, as long as its tournament is recorded and its results are not in. Null at
// any other time.
async function lateToJoin(schedule: Schedule, now: Date) {
  const late = nextMatchdayIn(schedule, new Date(now.getTime() - LATE_JOIN_MS));
  if (!late || late.start > now) return null;
  const row = await matchdayOn(late.date);
  return row?.lichessTournamentId && !row.ingested ? { ...late, tournament: row.lichessTournamentId } : null;
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
  const season = <Link href={`/seasons/${named.season}`}>Season {named.season}</Link>;
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
  if (!session) return <SignIn />;
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
