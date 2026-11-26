import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ui from "../ui.module.css";
import { ConsentForm } from "./consent-form";
import { SignUpSteps } from "./steps";
import styles from "./welcome.module.css";
import { getSession } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";
import { organiserName } from "@/lib/organiser";

export const metadata: Metadata = { title: "Welcome" };

export default function Welcome() {
  return (
    <main id="main" className={`${styles.page} ${ui.grain}`}>
      <div className={styles.head}>
        <SignUpSteps current={1} />
        <div className={styles.heading}>
          <h1 className={`${styles.title} ${ui.display}`}>
            <em>Welcome</em> to Offboard
          </h1>
        </div>
      </div>
      <Suspense>
        <Consent />
      </Suspense>
    </main>
  );
}

// Signed-out visitors and people who have already agreed have nothing to do here. Anyone else is told who runs the
// Club, by name once there is an Organiser, before they agree to anything.
async function Consent() {
  const session = await getSession();
  if (!session || !mustWelcome(session.user)) redirect("/");
  const organiser = await organiserName();
  return (
    <div className={styles.body}>
      <p className={styles.text}>
        Offboard is run by one volunteer, {organiser ? `${organiser}, the Organiser` : "the Organiser"}, who is
        responsible for what the site keeps about you. See <Link href="/privacy">Privacy and terms</Link>.
      </p>
      <ConsentForm name={session.user.name} />
      <p className={`${styles.note} ${styles.leave}`}>
        Rather not join? <Link href="/welcome/leave">Delete your account</Link>.
      </p>
    </div>
  );
}
