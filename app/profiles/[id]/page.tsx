import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "../../avatar";
import { ExternalLink } from "../../external-link";
import ui from "../../ui.module.css";
import styles from "./profile.module.css";
import { getProfile, requireSignedUp } from "@/lib/auth";
import { companyLabel } from "@/lib/companies";
import { lichessProfileUrl } from "@/lib/lichess";

export const metadata: Metadata = { title: "Member Profile" };

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
  const own = viewer.id === profile.id;
  const nothingAdded = !profile.company && !profile.position && !profile.openTo && !profile.linkedInUrl;
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
              <ExternalLink href={profile.linkedInUrl}>
                LinkedIn profile
              </ExternalLink>
            </dd>
          </div>
        )}
        <div>
          <dt>Lichess</dt>
          <dd>
            <ExternalLink href={lichessProfileUrl(profile.lichessUsername)}>
              {profile.lichessUsername}
            </ExternalLink>
          </dd>
        </div>
        {profile.lichessBlitzRating !== null && (
          <div>
            <dt>Blitz rating</dt>
            <dd className={styles.number}>{profile.lichessBlitzRating}</dd>
          </div>
        )}
      </dl>
      {nothingAdded && (
        <p className={ui.muted}>
          {own
            ? "You haven't added where you work, your position or what you're open to yet."
            : `${profile.name.split(" ")[0]} hasn't added anything else yet.`}
        </p>
      )}
      {own && (
        <p>
          <Link className={ui.quiet} href="/profile">
            Edit your Profile
          </Link>
        </p>
      )}
      <p className={`${ui.small} ${ui.muted}`}>Only signed-in Members can see this Profile.</p>
    </article>
  );
}
