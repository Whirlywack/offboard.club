import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
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
import { getSession, SIGN_IN_FAILED, viewerIsMember } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";
import { newChampions } from "@/lib/leaderboards";
import { lichessSwissUrl } from "@/lib/lichess";
import { matchdayOn } from "@/lib/matchdays";
import { mustConnectLichess } from "@/lib/members";
import { noticeLater } from "@/lib/request-failures";
import { signUpsNeeded, ZONE } from "@/lib/schedule";
import { nextMatchdayIn, readSchedule, type Schedule } from "@/lib/seasons";
import { countSignUps } from "@/lib/signups";
import { inviteLink } from "@/lib/telegram";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main id="main" className={`${ui.wide} ${styles.home}`}>
      <section className={styles.hero} aria-labelledby="title">
        <div className={styles.heroText}>
          <p className={ui.eyebrow}>Free chess Club · Vilnius</p>
          <h1 id="title" className={styles.title}>
            Sunday chess for people in tech
          </h1>
          <p className={styles.lede}>
            Working in tech keeps you busy, and busy gets lonely. We think that&apos;s worth fixing. So every Sunday
            evening we play chess online, five Games against other people in tech. With luck some of us become friends,
            and end up across a real board.
          </p>
        </div>
        <div className={styles.heroSide}>
          <Suspense>
            <NextMatchday />
          </Suspense>
          <Suspense>
            <You searchParams={searchParams} />
          </Suspense>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="chess">
        <h2 id="chess">The chess</h2>
        <div className={styles.sectionText}>
          <p>
            Matchdays start at 20:00 Vilnius time, on Lichess. Games are 5 minutes a side plus 3 seconds a move.
            Knowing how the pieces move is enough. A Season is six Matchdays and your best four count, so you can miss
            two.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="people">
        <h2 id="people">Meeting people</h2>
        <div className={styles.sectionText}>
          <p>
            Profiles can say where Members work and what they&apos;re open to, like a coffee or hearing about jobs.{" "}
            {inviteLink() ? "There's a Telegram group to talk in." : "A Telegram group to talk in is still to come."}{" "}
            Nobody may sell to you or recruit you unless your Profile invites it.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="leaderboards">
        <h2 id="leaderboards">Leaderboards and Recaps</h2>
        <div className={styles.sectionText}>
          <p>Both are public and show your name.</p>
          <Suspense>
            <SeasonChampions />
          </Suspense>
          <p className={leaderboards.links}>
            <Link href="/seasons">This Season&apos;s Leaderboard</Link>
            <Link href="/all-time">All-time Leaderboard</Link>
            <Link href="/recaps">Recaps</Link>
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
  const unreadable = (error: Error) => {
    console.error("Home page could not read the schedule:", error.message);
    noticeLater(error, "/");
  };
  const now = new Date();
  const schedule = await readSchedule(now).catch(unreadable);
  const next = schedule && nextMatchdayIn(schedule, now);
  if (next) {
    const member = await viewerIsMember("/");
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
        {underWay ? <p className={styles.statusNote}>Lichess lets you join until round 3 starts.</p> : null}
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
      <p className={styles.statusNote}>It starts once there are sixteen of us, on the first Sunday at least a week later.</p>
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
// logged, if the database cannot be read. Exported for app/home.test.ts.
export async function SeasonChampions() {
  await connection();
  const named = await newChampions(new Date()).catch((error: Error) => {
    console.error("Home page could not read the Season champion:", error.message);
    noticeLater(error, "/");
  });
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

// Who is signed in, or the way to sign in. A Member also gets the Telegram group's invite link, which nobody else is
// given. When the session cannot be read, someone with a session cookie is told so rather than shown as signed out;
// anyone else is offered to sign in, since Better Auth reads the database for them too until it has checked its
// tables there once. Someone sent here because signing in failed coming back from LinkedIn (?signin=failed, from
// app/api/auth/[...all]/route.ts) is told so beside the button. Exported for app/home.test.ts.
export async function You({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const session = await getSession().catch((error: unknown) => noticeLater(error, "/"));
  if (session === undefined && getSessionCookie(await headers()))
    return <p className={ui.alert}>Your sign-in can&apos;t be checked right now. Please try again in a minute.</p>;
  if (!session) return <SignIn problem={(await searchParams).signin === "failed" ? SIGN_IN_FAILED : ""} />;
  const { name, image } = session.user;
  const unfinished = mustWelcome(session.user) || mustConnectLichess(session.user);
  const invite = unfinished ? null : inviteLink();
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
      {invite && (
        <p className={ui.small}>
          <ExternalLink href={invite}>Telegram group</ExternalLink>
        </p>
      )}
    </section>
  );
}
