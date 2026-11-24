import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ui from "../ui.module.css";
import { ConsentForm } from "./consent-form";
import { SignUpSteps } from "./steps";
import { getSession } from "@/lib/auth";
import { mustWelcome } from "@/lib/consent";

export const metadata: Metadata = { title: "Welcome" };

export default function Welcome() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <SignUpSteps current={1} />
        <h1>Welcome to Offboard</h1>
      </div>
      <Suspense>
        <Consent />
      </Suspense>
    </main>
  );
}

// Signed-out visitors and people who have already agreed have nothing to do here.
async function Consent() {
  const session = await getSession();
  if (!session || !mustWelcome(session.user)) redirect("/");
  return <ConsentForm name={session.user.name} />;
}
