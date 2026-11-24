import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConnectLichess } from "../connect-lichess";
import { ProfileForm } from "./profile-form";
import { getProfile, requireSignedUp } from "@/lib/auth";
import { lichessProblem } from "@/lib/connect-lichess";
import { lichessProfileUrl } from "@/lib/lichess";

export const metadata: Metadata = { title: "Edit your Profile" };

export default function EditProfile({ searchParams }: PageProps<"/profile">) {
  return (
    <main>
      <h1>Edit your Profile</h1>
      <p>
        Members see your name and photo from LinkedIn and whatever you fill in here. Every field is optional: empty one
        and save to clear it.
      </p>
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

      <section aria-labelledby="lichess">
        <h2 id="lichess">Lichess</h2>
        {profile && (
          <p>
            You play as{" "}
            <a href={lichessProfileUrl(profile.lichessUsername)} target="_blank" rel="noopener noreferrer">
              {profile.lichessUsername}
            </a>{" "}
            on Lichess.
          </p>
        )}
        <p>
          To play with a different Lichess account, sign in to Lichess with it, then connect it here. Your Matchdays,
          Games and Profile stay yours.
        </p>
        {problem && <p role="alert">{problem}</p>}
        <ConnectLichess label="Connect a different Lichess account" />
      </section>

      <p>
        <Link href={`/profiles/${id}`}>See your Profile</Link>
      </p>
      <p>
        <Link href="/">Home</Link>
      </p>
    </>
  );
}
