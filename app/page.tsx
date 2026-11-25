import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { signOut } from "./actions";
import { SignIn } from "./sign-in";
import { getSession } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";
import { mustConnectLichess } from "@/lib/members";
import { signUpsNeeded, ZONE } from "@/lib/schedule";
import { upcomingMatchday } from "@/lib/seasons";
import { countSignUps } from "@/lib/signups";

export default function Home() {
  return (
    <>
      <header>
        <h1>Offboard</h1>
        <p>A free chess Club for people working in tech in and around Vilnius.</p>
        <Suspense>
          <NextMatchday />
        </Suspense>
        <p>
          <Link href="/recaps">Recaps of past Matchdays</Link>
        </p>
        <Suspense>
          <You />
        </Suspense>
      </header>

      <main>
        <section aria-labelledby="why">
          <h2 id="why">Why</h2>
          <p>
            Chess is the recurring reason to show up; meeting people is the point. There is no fee, no team to put
            together and no company budget to ask for. Whether you play casually, work at a ten-person startup or are
            new to the city, you can join on your own.
          </p>
        </section>

        <section aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol>
            <li>Sign in with LinkedIn and connect your Lichess account. That makes you a Member.</li>
            <li>
              Every Sunday at 20:00 Vilnius time there is a Matchday: five quick Games on Lichess against other
              Members.
            </li>
            <li>
              After each Matchday a Recap shows that night&apos;s Leaderboard and three Awards that a beginner can win
              as easily as a strong player.
            </li>
            <li>
              Six Matchdays make a Season, scored on your best four, so missing two Sundays costs you nothing.
            </li>
          </ol>
        </section>

        <section aria-labelledby="people">
          <h2 id="people">Meeting people</h2>
          <p>
            Members talk in one Telegram group. Profiles show who people are, where they work and what they are open
            to, so the chess leads to conversations.
          </p>
        </section>
      </main>
    </>
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
      <p>
        Next Matchday: <time dateTime={next.start.toISOString()}>{when}</time> Vilnius time.
      </p>
    );
  }
  const signUps = next === null ? await countSignUps().catch(unreadable) : undefined;
  const needed = signUps === undefined ? null : signUpsNeeded(signUps);
  if (needed === null) return null;
  return (
    <p>
      Season 1 starts once sixteen people have signed up: {needed} more {needed === 1 ? "sign-up" : "sign-ups"} to
      go.
    </p>
  );
}

async function You() {
  const session = await getSession().catch(() => null);
  if (!session) return <SignIn />;
  const { name, image } = session.user;
  return (
    <section aria-label="You">
      <p>
        {/* LinkedIn serves the photo at a small fixed size already. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="" width={48} height={48} />} Signed in as {name}
      </p>
      {mustWelcome(session.user) || mustConnectLichess(session.user) ? (
        <p>
          <Link href={mustWelcome(session.user) ? "/welcome" : "/welcome/lichess"}>Finish signing up</Link>
        </p>
      ) : (
        <ul>
          <li>
            <Link href={`/profiles/${session.user.id}`}>Your Profile</Link>
          </li>
          <li>
            <Link href="/profile">Edit your Profile</Link>
          </li>
        </ul>
      )}
      <form action={signOut}>
        <button>Sign out</button>
      </form>
    </section>
  );
}
