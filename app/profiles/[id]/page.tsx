import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "../../avatar";
import { ExternalLink } from "../../external-link";
import ui from "../../ui.module.css";
import { Attendance, Games } from "./history";
import styles from "./profile.module.css";
import { getProfile, requireSignedUp } from "@/lib/auth";
import { companyLabel } from "@/lib/companies";
import { getHistory } from "@/lib/history";
import { lichessProfileUrl } from "@/lib/lichess";

export const metadata: Metadata = { title: "Member Profile" };

export default function ProfilePage({ params, searchParams }: PageProps<"/profiles/[id]">) {
  return (
    <main id="main">
      <Suspense>
        <Profile params={params} searchParams={searchParams} />
      </Suspense>
      <nav aria-label="More" className={`${ui.backLinks} ${styles.more}`}>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}

type Search = Promise<Record<string, string | string[] | undefined>>;

// The person on a black plate, their photograph and name first; their record below it on the grey.
async function Profile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  // Signed-out visitors, and anyone part-way through signing up, go elsewhere before anything about the person is
  // looked up, their Games and record included.
  const viewer = await requireSignedUp();
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const own = viewer.id === profile.id;
  // ?games=all lists every Game, up to GAMES_MOST, instead of the latest few.
  const showingAll = (await searchParams).games === "all";
  const history = await getHistory(profile.id, viewer.id, { all: showingAll });
  const firstName = profile.name.split(" ")[0];
  const nothingAdded = !profile.company && !profile.position && !profile.openTo && !profile.linkedInUrl;
  return (
    <article>
      <header className={`${styles.person} ${ui.black}`}>
        <div className={styles.who}>
          <div className={styles.portrait}>
            <Avatar name={profile.name} src={profile.image} size="large" />
          </div>
          <h1 className={`${styles.name} ${ui.display}`}>
            <em>{firstName}</em>
            {profile.name.slice(firstName.length)}
          </h1>
          {profile.position && <p className={styles.position}>{profile.position}</p>}
        </div>
        <div className={styles.about}>
          <dl className={styles.facts}>
            {/* What they would welcome is what starts a conversation, so it comes first, in the serif */}
            {profile.openTo && (
              <div className={styles.openTo}>
                <dt>Open to</dt>
                <dd>{profile.openTo}</dd>
              </div>
            )}
            {profile.company && (
              <div>
                <dt>Company</dt>
                {/* ponytail: logos are shown once they are served from our own storage, not hot-linked from the Company. */}
                <dd>{companyLabel(profile.company)}</dd>
              </div>
            )}
            {profile.linkedInUrl && (
              <div>
                <dt>LinkedIn</dt>
                <dd>
                  <ExternalLink href={profile.linkedInUrl}>LinkedIn profile</ExternalLink>
                </dd>
              </div>
            )}
            <div>
              <dt>Lichess</dt>
              <dd>
                <ExternalLink href={lichessProfileUrl(profile.lichessUsername)}>{profile.lichessUsername}</ExternalLink>
              </dd>
            </div>
            {profile.lichessBlitzRating !== null && (
              <div className={styles.figure}>
                <dt>Blitz rating</dt>
                <dd>{profile.lichessBlitzRating}</dd>
              </div>
            )}
            <Attendance history={history} />
          </dl>
          {nothingAdded && (
            <p className={styles.nothing}>
              {own ? "You haven't added anything else yet." : `${firstName} hasn't added anything else yet.`}
            </p>
          )}
          {own && (
            <p className={styles.edit}>
              <Link className={ui.button} href="/profile">
                Edit your Profile
              </Link>
            </p>
          )}
        </div>
      </header>
      <Games memberId={profile.id} firstName={firstName} own={own} history={history} showingAll={showingAll} />
    </article>
  );
}
