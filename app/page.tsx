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
import { mustConnectLichess } from "@/lib/members";
import { signUpsNeeded, ZONE } from "@/lib/schedule";
import { upcomingMatchday } from "@/lib/seasons";
import { countSignUps } from "@/lib/signups";

export default function Home() {
  return (
    <main id="main" className={`${ui.wide} ${styles.home}`}>
      <section className={styles.hero} aria-labelledby="title">
        <div className={styles.heroText}>
          <p className={ui.eyebrow}>Chess Club · Vilnius · Free</p>
          <h1 id="title" className={styles.title}>
            Offboard
          </h1>
          <p className={styles.lede}>A free chess Club for people working in tech in and around Vilnius.</p>
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

      <section className={styles.section} aria-labelledby="why">
        <h2 id="why">Why</h2>
        <p className={styles.sectionText}>
          Chess is the recurring reason to show up; meeting people is the point. There is no fee, no team to put
          together and no company budget to ask for. Whether you play casually, work at a ten-person startup or are new
          to the city, you can join on your own.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className={styles.steps}>
          <li>Sign in with LinkedIn and connect your Lichess account. That makes you a Member.</li>
          <li>
            Every Sunday at 20:00 Vilnius time there is a Matchday: five quick Games on Lichess against other Members.
          </li>
          <li>After each Matchday a Recap shows that night&apos;s Leaderboard.</li>
          <li>Six Matchdays make a Season, scored on your best four, so missing two Sundays costs you nothing.</li>
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="people">
        <h2 id="people">Meeting people</h2>
        <p className={styles.sectionText}>
          Profiles show who people are, where they work and what they are open to, so the chess leads to conversations.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="recaps">
        <h2 id="recaps">Recaps</h2>
        <p className={styles.sectionText}>
          <Link href="/recaps">Recaps of past Matchdays</Link>
        </p>
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
        <p className={styles.statusNote}>Vilnius time, on Lichess.</p>
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
        <span className={styles.count}>{needed}</span> more {needed === 1 ? "sign-up" : "sign-ups"} to go
      </p>
      <p className={styles.statusNote}>Season 1 starts once sixteen people have signed up.</p>
    </div>
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
        <form action={signOut} className={styles.signOut}>
          <button className={ui.quiet}>Sign out</button>
        </form>
      </div>
    </section>
  );
}
