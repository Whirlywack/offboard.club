import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ConnectLichess } from "../../connect-lichess";
import ui from "../../ui.module.css";
import { SignUpSteps } from "../steps";
import { requireWelcomed } from "@/lib/auth";
import { lichessProblem } from "@/lib/connect-lichess";
import { mustConnectLichess } from "@/lib/members";

export const metadata: Metadata = { title: "Connect Lichess" };

// The step after the welcome step. Until it is done, the person is not a Member.
export default function ConnectStep({ searchParams }: PageProps<"/welcome/lichess">) {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <SignUpSteps current={2} />
        <h1>Connect Lichess</h1>
      </div>
      <div className={ui.prose}>
        <p>
          Matchdays are played on Lichess, so you connect the Lichess account you will play with. Lichess asks you to
          approve Offboard, which then adds that account to the Club&apos;s private Lichess team for you. Offboard asks
          Lichess only for permission to join a team, and hands that permission back as soon as you are in.
        </p>
        <p>One Lichess account can belong to one Member only. You can swap to a different one later.</p>
      </div>
      <Suspense>
        <Step searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Signed-out visitors and Members have nothing to do here; a Member swaps accounts from the Profile edit page.
async function Step({ searchParams }: Pick<PageProps<"/welcome/lichess">, "searchParams">) {
  const person = await requireWelcomed();
  if (!mustConnectLichess(person)) redirect("/");
  const problem = lichessProblem((await searchParams).lichess);
  return (
    <div className={`${ui.panel} ${ui.prose} ${ui.arrive}`}>
      {problem && (
        <p role="alert" className={ui.alert}>
          {problem}
        </p>
      )}
      <ConnectLichess label="Connect Lichess" />
      <p className={`${ui.small} ${ui.muted}`}>
        No Lichess account yet? <a href="https://lichess.org/signup">Create one on Lichess</a>, which is free, then come
        back here to connect it.
      </p>
    </div>
  );
}
