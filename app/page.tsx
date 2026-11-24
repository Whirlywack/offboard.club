import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { signOut } from "./actions";
import { Avatar } from "./avatar";
import styles from "./home.module.css";
import { SignIn } from "./sign-in";
import ui from "./ui.module.css";
import { getSession } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";
import { organiserEmail } from "@/lib/contact";
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
            your own and it&apos;s free, so there&apos;s no team to put together and no company budget to ask for.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className={styles.steps}>
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
            <p>Afterwards the Matchday gets a Recap with that night&apos;s Leaderboard, open for anyone to read.</p>
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
          <p className={styles.plans}>
            Still to come: Awards in each Recap for things any Member can pull off at any rating, such as the biggest
            upset, and a Telegram group for Members.
          </p>
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
// Left out, and logged, if the database cannot be read.
async function NextMatchday() {
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
    return (
      <div className={`${styles.status} ${ui.arrive}`}>
        <p className={styles.statusLabel}>
          <span className={ui.marker} aria-hidden="true" /> Next Matchday
        </p>
        <p className={styles.statusValue}>
          <time dateTime={next.start.toISOString()}>{when}</time>
        </p>
        <p className={styles.statusNote}>Vilnius time, on Lichess. Five Games, 5 minutes a side plus 3 seconds a move.</p>
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
