import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ui from "../ui.module.css";
import { ConsentForm } from "./consent-form";
import { SignUpSteps } from "./steps";
import { getSession } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";
import { organiserName } from "@/lib/organiser";

export const metadata: Metadata = { title: "Welcome" };

export default function Welcome() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <SignUpSteps current={1} />
        <h1>Welcome to Offboard</h1>
        <p className={ui.lede}>Two things to agree to, then connect Lichess and you&apos;re a Member.</p>
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
    <>
      <p>
        Offboard is run by one volunteer, {organiser ? `${organiser}, the Organiser` : "the Organiser"}, who is
        responsible for what the site keeps about you. It&apos;s all in <Link href="/privacy">Privacy and terms</Link>.
      </p>
      <ConsentForm name={session.user.name} />
      <p className={`${ui.small} ${ui.muted}`}>
        Rather not join? <Link href="/welcome/leave">Delete your account</Link>.
      </p>
    </>
  );
}
