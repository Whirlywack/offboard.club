import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { signOut } from "./actions";
import { Avatar } from "./avatar";
import { ExternalLink } from "./external-link";
import styles from "./home.module.css";
import king from "./photos/king.webp";
import knights from "./photos/knights.webp";
import pawnEmpty from "./photos/pawn-empty.webp";
import pawnLong from "./photos/pawn-long.webp";
import pawn from "./photos/pawn.webp";
import queenKing from "./photos/queen-king.webp";
import queenPhone from "./photos/queen-phone.webp";
import queen from "./photos/queen.webp";
import row from "./photos/row.webp";
import { RuledLinks } from "./ruled-links";
import { SignIn } from "./sign-in";
import { Masthead, Strip } from "./site";
import site from "./site.module.css";
import ui from "./ui.module.css";
import { getSession, SIGN_IN_FAILED, viewerIsMember } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";
import { newChampions } from "@/lib/leaderboards";
import { lichessSwissUrl } from "@/lib/lichess";
import { matchdayOn } from "@/lib/matchdays";
import { mustConnectLichess } from "@/lib/members";
import { noticeLater } from "@/lib/request-failures";
import { MEMBERS_TO_START, signUpsNeeded, ZONE } from "@/lib/schedule";
import { nextMatchdayIn, readSchedule, type Schedule } from "@/lib/seasons";
import { countSignUps } from "@/lib/signups";
import { inviteLink } from "@/lib/telegram";

// The home page draws its own header: the strip above it says what is next, and on a desktop a visitor can sign in from
// it as well.
export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <>
      <Masthead
        strip={
          <Suspense fallback={<div className={styles.stripSpace} />}>
            <WhatIsNextStrip />
          </Suspense>
        }
      >
        <Suspense>
          <HeaderSignIn />
        </Suspense>
      </Masthead>
      <main id="main">
        <section className={`${styles.hero} ${ui.grain}`} aria-labelledby="title">
          <div className={`${styles.stage} ${ui.grain}`}>
            <Queen />
            <h1 id="title" className={`${styles.title} ${ui.display}`}>
              <em>Sunday</em>
              <br className={styles.phoneOnly} /> chess
              <br className={styles.desktopOnly} /> for
              <br className={styles.phoneOnly} /> people
              <br /> in tech
            </h1>
            <p className={`${styles.credit} ${ui.caps}`}>Free chess Club · Vilnius</p>
          </div>

          <div className={styles.lonely}>
            <div className={styles.pair}>
              <p className={`${styles.lonelyLine} ${ui.display}`}>Working in tech keeps you busy, and busy gets lonely.</p>
              <Image className={styles.pawnLong} src={pawnLong} alt="" sizes="(min-width: 900px) 730px, 292px" />
            </div>
            <p className={styles.intro}>
              We think that&apos;s worth fixing. So every Sunday evening we play chess online, five Games against other
              people in tech. With luck some of us become friends, and end up across a real board.
            </p>
          </div>

          <div className={styles.season} id="season">
            <Suspense>
              <NextMatchday />
            </Suspense>
            <div className={styles.join}>
              <Suspense>
                <You searchParams={searchParams} />
              </Suspense>
            </div>
          </div>
        </section>

        <section className={`${styles.chess} ${ui.black}`} aria-labelledby="chess">
          <h2 id="chess" className={`${styles.chessTitle} ${ui.display}`}>
            <em>The</em> <span>chess</span>
          </h2>
          <div className={styles.figure}>
            <Image
              className={styles.king}
              src={king}
              alt=""
              sizes="(min-width: 1438px) 1024px, (min-width: 900px) 72vw, 512px"
              quality={90}
            />
          </div>
          <p className={styles.chessText}>
            Matchdays start at 20:00 Vilnius time, on Lichess. Games are 5 minutes a side plus 3 seconds a move. Knowing
            how the pieces move is enough. A Season is six Matchdays and your best four count, so you can miss two.
          </p>
        </section>

        <section className={`${styles.meet} ${ui.grain}`} aria-labelledby="people">
          <div className={styles.meetStage}>
            <Image className={styles.knights} src={knights} alt="" sizes="(min-width: 900px) 720px, 360px" />
            <h2 id="people" className={`${styles.meetTitle} ${ui.display}`}>
              <span className={styles.w1}>
                <em>Meeting</em>
              </span>{" "}
              <span className={styles.w2}>people</span>
            </h2>
            <p className={styles.meetText}>
              Profiles can say where Members work and what they&apos;re open to, like a coffee or hearing about jobs.{" "}
              {inviteLink() ? "There's a Telegram group to talk in." : "A Telegram group to talk in is still to come."}{" "}
              Nobody may sell to you or recruit you unless your Profile invites it.
            </p>
          </div>
        </section>

        <section className={`${styles.boards} ${ui.black}`} aria-labelledby="leaderboards">
          <div className={styles.boardsInner}>
            <div>
              <h2 id="leaderboards" className={`${styles.boardsTitle} ${ui.display}`}>
                <em>Leaderboards</em> <span>and Recaps</span>
              </h2>
              <p className={styles.boardsLede}>Both are public and show your name.</p>
              <Suspense>
                <SeasonChampions />
              </Suspense>
            </div>
            <RuledLinks
              className={styles.boardsLinks}
              links={[
                ["/seasons", "This Season's Leaderboard"],
                ["/all-time", "All-time Leaderboard"],
                ["/recaps", "Recaps"],
              ]}
            />
          </div>
        </section>
        <div className={`${styles.closing} ${ui.grain}`}>
          <Image className={styles.fallen} src={queenKing} alt="" sizes="(min-width: 900px) 720px, 360px" />
        </div>
      </main>
    </>
  );
}

// The queen, as much of her photograph as the screen shows. On a phone under 441px wide a third of it is in sight, so a
// phone is sent that part alone, cut at the same scale (queen-phone.webp, 846 x 1512 from x 396 of the 1800px
// photograph), which home.module.css places where it falls. Each `sizes` is the width the photograph is drawn at there.
function Queen() {
  const shared = { alt: "", loading: "eager", fetchPriority: "high" } as const;
  const phone = getImageProps({ ...shared, src: queenPhone, sizes: "(max-width: 315px) 363px, (max-width: 398px) 115vw, 459px" });
  const { props } = getImageProps({
    ...shared,
    src: queen,
    sizes: "(min-width: 1559px) 1482px, (min-width: 1292px) 95vw, (min-width: 900px) 1229px, 975px",
  });
  return (
    <picture>
      <source media="(max-width: 440px)" srcSet={phone.props.srcSet} sizes={phone.props.sizes} />
      {/* next/image's own props, through getImageProps, as next/image draws no <picture> */}
      <img {...props} alt="" className={styles.queen} />
    </picture>
  );
}

// Lichess lets a Member join a Matchday late, until its third round starts. The site does not know the round, so a
// Member is shown the Matchday under way for this long after its start.
const LATE_JOIN_MS = 90 * 60_000;

// `pawns` is how many of the sixteen pawns stand: the Members Season 1 has, until its first Matchday; null after it, when
// the six pieces of a Season stand in their place.
type WhatIsNext =
  | { label: "Season 1"; needed: number; pawns: number }
  | { label: "Next Matchday" | "Matchday under way"; start: Date; tournament: string | null; pawns: number | null };

// What is next, read once for each request for the strip and the Season block alike (React's cache): the next Matchday
// once Season 1 is scheduled; until then, how many more sign-ups it is waiting for. A Member also gets the link to its
// Lichess tournament once the site has created it, and the Matchday under way in its place while they may still join
// that one. Only the Club's team can join it, and each Member is in the team, so anyone else gets the next Matchday's
// time alone. Null, and logged, if the database cannot be read.
const whatIsNext = cache(async (): Promise<WhatIsNext | null> => {
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
    const tournament =
      underWay?.tournament ?? (member ? (await matchdayOn(next.date).catch(unreadable))?.lichessTournamentId : null);
    const first = next.season === 1 && next.number === 1;
    return {
      label: underWay ? "Matchday under way" : "Next Matchday",
      start: (underWay ?? next).start,
      tournament: tournament ?? null,
      pawns: first ? MEMBERS_TO_START : null,
    };
  }
  const signUps = next === null ? await countSignUps().catch(unreadable) : undefined;
  const needed = signUps === undefined ? null : signUpsNeeded(signUps);
  return needed === null ? null : { label: "Season 1", needed, pawns: signUps! };
});

// What is next, in the words the strip and the Season block both use.
function Value({ next }: { next: WhatIsNext }) {
  if ("needed" in next) return <>{next.needed} more {next.needed === 1 ? "Member" : "Members"} to go</>;
  const when = next.start.toLocaleString("en-GB", {
    timeZone: ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  return <time dateTime={next.start.toISOString()}>{when}</time>;
}

// The strip at the top of the page: what the Season block says, in its words, leading down to it. A Matchday's time is
// too long for one line on a phone, so it goes under its label there.
async function WhatIsNextStrip() {
  const next = await whatIsNext();
  return (
    next && (
      <Strip href="#season" label={next.label} stacked={"start" in next}>
        <Value next={next} />
      </Strip>
    )
  );
}

// The Season block: what is next, and its picture. Until Season 1's first Matchday, sixteen pawns: one standing for each
// Member it has and an outline for each it waits for, all standing once it is scheduled. After it, the six pieces of a
// Season, tallest to shortest. A pawn's file is smaller than any screen asks for, so it goes without `sizes`, and each of
// the two is fetched once. On a phone the picture comes between the time and what follows it. Exported for
// app/home.test.ts.
export async function NextMatchday() {
  const next = await whatIsNext();
  if (!next) return null;
  const standing = next.pawns;
  return (
    <>
      <div className={styles.left}>
        <p className={`${ui.caps} ${styles.label}`}>{next.label}</p>
        <p className={`${styles.count} ${ui.display}`}>
          <Value next={next} />
        </p>
        {"needed" in next ? (
          <p className={styles.starts}>It starts once there are sixteen of us, on the first Sunday at least a week later.</p>
        ) : next.label === "Matchday under way" ? (
          <p className={styles.starts}>Lichess lets you join until round 3 starts.</p>
        ) : null}
        {"tournament" in next && next.tournament && (
          <p className={styles.statusLink}>
            <ExternalLink href={lichessSwissUrl(next.tournament)}>Join this Matchday on Lichess</ExternalLink>
          </p>
        )}
      </div>
      {standing === null ? (
        <Image className={styles.row} src={row} alt="" sizes="(min-width: 900px) 44vw, calc(100vw - 32px)" />
      ) : (
        <ol className={styles.pawns} aria-hidden="true">
          {Array.from({ length: MEMBERS_TO_START }, (_, place) => (
            <li key={place}>
              <Image src={place < standing ? pawn : pawnEmpty} alt="" />
            </li>
          ))}
        </ol>
      )}
    </>
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
    <p className={styles.champion}>
      <span className={styles.mark} aria-hidden="true" />
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

// Who is looking, read once for each request for the header and the Season block alike (React's cache). When the session
// cannot be read, someone with a session cookie is signed in all the same (`unknown`); anyone else is a visitor, since
// Better Auth reads the database for them too until it has checked its tables there once.
const viewer = cache(async () => {
  const session = await getSession().catch((error: unknown) => noticeLater(error, "/"));
  return { session, unknown: session === undefined && Boolean(getSessionCookie(await headers())) };
});

// On a desktop, a visitor's second way to sign in: it sends the form beside the note in the Season block.
async function HeaderSignIn() {
  const { session, unknown } = await viewer();
  if (session || unknown) return null;
  return (
    <button form="sign-in" className={site.signIn} aria-describedby="linkedin-notice">
      Sign in with LinkedIn
    </button>
  );
}

// Who is signed in, or the way to sign in. A Member also gets the Telegram group's invite link, which nobody else is
// given. Someone whose sign-in cannot be checked is told so rather than shown as signed out. Someone sent here because
// signing in failed coming back from LinkedIn (?signin=failed, from app/api/auth/[...all]/route.ts) is told so beside
// the button. Exported for app/home.test.ts.
export async function You({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const { session, unknown } = await viewer();
  if (unknown) return <p className={ui.alert}>Your sign-in can&apos;t be checked right now. Please try again in a minute.</p>;
  if (!session) return <SignIn problem={(await searchParams).signin === "failed" ? SIGN_IN_FAILED : ""} />;
  const { name, image } = session.user;
  const unfinished = mustWelcome(session.user) || mustConnectLichess(session.user);
  const invite = unfinished ? null : inviteLink();
  return (
    <section aria-label="You" className={styles.you}>
      <div className={styles.who}>
        <Avatar name={name} src={image ?? null} size="small" />
        <p>
          <span className={`${ui.caps} ${styles.whoLabel}`}>Signed in as</span>
          <span className={styles.whoName}>{name}</span>
        </p>
        <form action={signOut} className={styles.signOut}>
          <button>Sign out</button>
        </form>
      </div>
      <div className={styles.actions}>
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
        <p className={styles.telegram}>
          <ExternalLink href={invite}>Telegram group</ExternalLink>
        </p>
      )}
    </section>
  );
}
