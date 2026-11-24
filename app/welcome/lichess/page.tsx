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
        <h1>Connect your Lichess account</h1>
        <p className={ui.lede}>Matchdays are played on Lichess, so connect the account you&apos;ll play with.</p>
      </div>
      <div className={ui.prose}>
        <p>
          Lichess will ask you to approve Offboard. Once you do, Offboard adds your account to the Club&apos;s private
          Lichess team, so there&apos;s no team password to type. It asks Lichess for permission to join a team and
          nothing else, and gives that permission back as soon as you&apos;re in.
        </p>
        <p>
          Each Lichess account can belong to one Member. You can switch to a different account later from your Profile,
          and your results stay with you.
        </p>
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
        No Lichess account yet? <a href="https://lichess.org/signup">Make one on Lichess</a> (it&apos;s free), then come
        back here and connect it.
      </p>
    </div>
  );
}
