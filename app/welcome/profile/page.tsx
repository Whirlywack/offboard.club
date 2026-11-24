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
        <h1>Your Profile</h1>
        <p className={ui.lede}>
          You are signed up. If you like, tell other Members a little more about yourself. Only signed-in Members see
          your Profile, every field is optional, and you can change or clear them at any time from the home page.
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
