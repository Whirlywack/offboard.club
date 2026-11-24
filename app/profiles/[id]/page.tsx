import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "../../avatar";
import ui from "../../ui.module.css";
import styles from "./profile.module.css";
import { getProfile, requireSignedUp } from "@/lib/auth";
import { companyLabel } from "@/lib/companies";
import { lichessProfileUrl } from "@/lib/lichess";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage({ params }: PageProps<"/profiles/[id]">) {
  return (
    <main id="main" className={ui.page}>
      <Suspense>
        <Profile params={params} />
      </Suspense>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
      </nav>
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
    <article className={`${styles.profile} ${ui.arrive}`}>
      <header className={styles.header}>
        <Avatar name={profile.name} src={profile.image} size="large" />
        <div className={styles.names}>
          <h1>{profile.name}</h1>
          {profile.position && <p className={styles.position}>{profile.position}</p>}
        </div>
      </header>
      <dl className={styles.facts}>
        {profile.company && (
          <div>
            <dt>Company</dt>
            {/* ponytail: logos are shown once they are served from our own storage, not hot-linked from the Company. */}
            <dd>{companyLabel(profile.company)}</dd>
          </div>
        )}
        {profile.openTo && (
          <div className={styles.openTo}>
            <dt>Open to</dt>
            <dd>{profile.openTo}</dd>
          </div>
        )}
        {profile.linkedInUrl && (
          <div>
            <dt>LinkedIn</dt>
            <dd>
              <a href={profile.linkedInUrl} target="_blank" rel="noopener noreferrer">
                LinkedIn profile
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt>Lichess</dt>
          <dd>
            <a href={lichessProfileUrl(profile.lichessUsername)} target="_blank" rel="noopener noreferrer">
              {profile.lichessUsername}
            </a>
          </dd>
        </div>
        {profile.lichessBlitzRating !== null && (
          <div>
            <dt>Blitz rating</dt>
            <dd className={styles.number}>{profile.lichessBlitzRating}</dd>
          </div>
        )}
      </dl>
      {viewer.id === profile.id && (
        <p>
          <Link className={ui.quiet} href="/profile">
            Edit your Profile
          </Link>
        </p>
      )}
    </article>
  );
}
