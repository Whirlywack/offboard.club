import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile, requireSignedUp } from "@/lib/auth";
import { lichessProfileUrl } from "@/lib/lichess";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage({ params }: PageProps<"/profiles/[id]">) {
  return (
    <main>
      <Suspense>
        <Profile params={params} />
      </Suspense>
      <p>
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}

async function Profile({ params }: { params: Promise<{ id: string }> }) {
  // Signed-out visitors go home before anything about the person is looked up.
  const viewer = await requireSignedUp();
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  return (
    <article>
      <h1>{profile.name}</h1>
      {/* LinkedIn serves the photo at a small fixed size already. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {profile.image && <img src={profile.image} alt="" width={96} height={96} />}
      <dl>
        {profile.company && (
          <>
            <dt>Company</dt>
            {/* ponytail: logos are shown once they are served from our own storage, not hot-linked from the Company. */}
            {/* The domain goes beside the name, which any website can claim. */}
            <dd>
              {profile.company.name === profile.company.domain
                ? profile.company.domain
                : `${profile.company.name} (${profile.company.domain})`}
            </dd>
          </>
        )}
        {profile.position && (
          <>
            <dt>Position</dt>
            <dd>{profile.position}</dd>
          </>
        )}
        {profile.openTo && (
          <>
            <dt>Open to</dt>
            <dd>{profile.openTo}</dd>
          </>
        )}
        {profile.linkedInUrl && (
          <>
            <dt>LinkedIn</dt>
            <dd>
              <a href={profile.linkedInUrl} target="_blank" rel="noopener noreferrer">
                LinkedIn profile
              </a>
            </dd>
          </>
        )}
        <dt>Lichess</dt>
        <dd>
          <a href={lichessProfileUrl(profile.lichessUsername)} target="_blank" rel="noopener noreferrer">
            {profile.lichessUsername}
          </a>
        </dd>
        {profile.lichessBlitzRating !== null && (
          <>
            <dt>Blitz rating</dt>
            <dd>{profile.lichessBlitzRating}</dd>
          </>
        )}
      </dl>
      {viewer.id === profile.id && (
        <p>
          <Link href="/profile">Edit your Profile</Link>
        </p>
      )}
    </article>
  );
}
