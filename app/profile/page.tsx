import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConnectLichess } from "../connect-lichess";
import { ExternalLink } from "../external-link";
import ui from "../ui.module.css";
import styles from "./profile.module.css";
import { ProfileForm } from "./profile-form";
import { getProfile, requireSignedUp } from "@/lib/auth";
import { lichessProblem } from "@/lib/connect-lichess";
import { lichessProfileUrl } from "@/lib/lichess";

export const metadata: Metadata = { title: "Edit your Profile" };

export default function EditProfile({ searchParams }: PageProps<"/profile">) {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>Edit your Profile</h1>
        <p className={ui.lede}>Other Members see your name and photo from LinkedIn, plus anything you add here.</p>
      </div>
      <Suspense>
        <Edit searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Edit({ searchParams }: Pick<PageProps<"/profile">, "searchParams">) {
  const { id } = await requireSignedUp();
  const profile = await getProfile(id);
  const problem = lichessProblem((await searchParams).lichess);
  return (
    <>
      <ProfileForm saved={profile} />

      <section aria-labelledby="lichess" className={`${styles.section} ${ui.arrive}`}>
        <h2 id="lichess">Your Lichess account</h2>
        {profile && (
          <p>
            You play as{" "}
            <ExternalLink href={lichessProfileUrl(profile.lichessUsername)}>
              {profile.lichessUsername}
            </ExternalLink>{" "}
            on Lichess.
          </p>
        )}
        <p className={ui.muted}>
          To play with a different account, sign in to Lichess with it first, then switch here. Your results and Games
          stay with you.
        </p>
        {problem && (
          <p role="alert" className={ui.alert}>
            {problem}
          </p>
        )}
        <ConnectLichess label="Switch Lichess account" quiet />
      </section>

      <section aria-labelledby="leave" className={`${styles.section} ${ui.arrive}`}>
        <h2 id="leave">Leave the Club</h2>
        <div className={ui.actions}>
          <Link className={ui.quiet} href="/profile/leave">
            Delete your account
          </Link>
        </div>
      </section>

      <nav aria-label="More" className={ui.backLinks}>
        <Link href={`/profiles/${id}`}>See your Profile as Members see it</Link>
        <Link href="/">Home</Link>
      </nav>
    </>
  );
}
