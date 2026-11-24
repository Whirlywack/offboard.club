import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile, requireSignedUp } from "@/lib/auth";

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
            <dd>
              {/* Hot-linked: the viewer's browser loads the logo from the Company's own website, which so sees the
                  viewer's IP address, browser and any cookies it set there, but, with no referrer, not which site or
                  Profile asked. getProfile passes only an https address on the Company's own domain. next/image
                  would instead make this server fetch the address. */}
              {profile.company.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.company.logoUrl}
                  alt=""
                  width={32}
                  height={32}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}{" "}
              {profile.company.name}
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
      </dl>
      {viewer.id === profile.id && (
        <p>
          <Link href="/profile">Edit your Profile</Link>
        </p>
      )}
    </article>
  );
}
