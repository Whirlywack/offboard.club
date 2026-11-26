import type { Metadata } from "next";
import Link from "next/link";
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
        <p className={ui.lede}>Use the account you&apos;ll play Matchdays with.</p>
      </div>
      <div className={ui.prose}>
        <p>
          Lichess will ask you to approve Offboard. Offboard asks only for permission to join a team, adds your account to
          the Club&apos;s private team, then gives the permission back.
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
    <>
      <div className={`${ui.panel} ${ui.prose} ${ui.arrive}`}>
        {problem && (
          <p role="alert" className={ui.alert}>
            {problem}
          </p>
        )}
        <ConnectLichess label="Connect Lichess" />
        <p className={`${ui.small} ${ui.muted}`}>
          No Lichess account yet? <a href="https://lichess.org/signup">Make one on Lichess</a> (it&apos;s free) and come
          back.
        </p>
      </div>
      <p className={`${ui.small} ${ui.muted}`}>
        Rather not join? <Link href="/welcome/leave">Delete your account</Link>.
      </p>
    </>
  );
}
