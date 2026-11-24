import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileForm } from "../../profile/profile-form";
import ui from "../../ui.module.css";
import { SignUpSteps } from "../steps";
import { getProfile, requireSignedUp } from "@/lib/auth";

export const metadata: Metadata = { title: "Your Profile" };

// The optional step after the welcome step. Skipping it leaves the person fully signed up.
export default function WelcomeProfile() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <SignUpSteps current={3} />
        <h1>You&apos;re a Member</h1>
        <p className={ui.lede}>
          If you like, tell other Members a little about yourself. Every field is optional, only signed-in Members see
          your Profile, and you can change any of it later from the home page.
        </p>
      </div>
      <Suspense>
        <Step />
      </Suspense>
    </main>
  );
}

async function Step() {
  const { id } = await requireSignedUp();
  return <ProfileForm saved={await getProfile(id)} welcome />;
}
