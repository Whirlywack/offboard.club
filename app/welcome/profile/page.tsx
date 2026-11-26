import type { Metadata } from "next";
import { Suspense } from "react";
import { ExternalLink } from "../../external-link";
import { ProfileForm } from "../../profile/profile-form";
import ui from "../../ui.module.css";
import { SignUpSteps } from "../steps";
import styles from "../welcome.module.css";
import { getProfile, requireSignedUp } from "@/lib/auth";
import { inviteLink, postingSetUp } from "@/lib/telegram";

export const metadata: Metadata = { title: "Your Profile" };

// The optional step after the welcome step. Skipping it leaves the person fully signed up.
export default function WelcomeProfile() {
  return (
    <main id="main" className={`${styles.page} ${ui.grain}`}>
      <div className={styles.head}>
        <SignUpSteps current={3} />
        <div className={styles.heading}>
          <h1 className={`${styles.title} ${ui.display}`}>
            <em>You&apos;re</em> a Member
          </h1>
          <p className={styles.lede}>If you like, tell other Members a little about yourself.</p>
        </div>
      </div>
      <Suspense>
        <Step />
      </Suspense>
    </main>
  );
}

// For Members only, like the Telegram group's invite link in it. Exported for app/home.test.ts.
export async function Step() {
  const { id } = await requireSignedUp();
  const invite = inviteLink();
  return (
    <div className={styles.body}>
      {invite && (
        <p className={styles.text}>
          {postingSetUp()
            ? "Members talk in the Club's Telegram group, where the bot also posts Matchday reminders and Recaps."
            : "Members talk in the Club's Telegram group."}{" "}
          <ExternalLink href={invite}>Join the Telegram group</ExternalLink>
        </p>
      )}
      <ProfileForm saved={await getProfile(id)} welcome />
    </div>
  );
}
