import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ConnectLichess } from "../../connect-lichess";
import { requireWelcomed } from "@/lib/auth";
import { lichessProblem } from "@/lib/connect-lichess";
import { mustConnectLichess } from "@/lib/members";

export const metadata: Metadata = { title: "Connect Lichess" };

// The step after the welcome step. Until it is done, the person is not a Member.
export default function ConnectStep({ searchParams }: PageProps<"/welcome/lichess">) {
  return (
    <main>
      <h1>Connect Lichess</h1>
      <p>
        Matchdays are played on Lichess, so you connect the Lichess account you will play with. Lichess asks you to
        approve Offboard, which then adds that account to the Club&apos;s private Lichess team for you. Offboard asks
        Lichess only for permission to join a team, and hands that permission back as soon as you are in.
      </p>
      <p>One Lichess account can belong to one Member only. You can swap to a different one later.</p>
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
      {problem && <p role="alert">{problem}</p>}
      <ConnectLichess label="Connect Lichess" />
      <p>
        No Lichess account yet? <a href="https://lichess.org/signup">Create one on Lichess</a>, which is free, then come
        back here to connect it.
      </p>
    </>
  );
}
