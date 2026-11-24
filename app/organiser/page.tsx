import Link from "next/link";
import { Suspense } from "react";
import { connectOrganiserLichess } from "./actions";
import { requireOrganiser } from "@/lib/auth";
import { lastFailure } from "@/lib/jobs";
import { lichessProfileUrl } from "@/lib/lichess";
import { organiserMessage, organiserPermission } from "@/lib/organiser-lichess";
import { ZONE } from "@/lib/schedule";

// The Organiser's page (the full one is #16). Nothing of it is in the static shell: to anyone but the Organiser it is
// not found.
export default function OrganiserPage({ searchParams }: PageProps<"/organiser">) {
  return (
    <Suspense>
      <Organiser searchParams={searchParams} />
    </Suspense>
  );
}

const when = (instant: Date, withTime = false) =>
  instant.toLocaleString("en-GB", {
    timeZone: ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime && { hour: "2-digit", minute: "2-digit" }),
  });

async function Organiser({ searchParams }: Pick<PageProps<"/organiser">, "searchParams">) {
  await requireOrganiser();
  const [permission, failure] = await Promise.all([organiserPermission(), lastFailure()]);
  const message = organiserMessage((await searchParams).lichess);
  const expired = permission !== null && permission.expiresAt <= new Date();
  return (
    <main>
      <h1>Organiser</h1>

      <section aria-labelledby="lichess">
        <h2 id="lichess">Lichess permission</h2>
        {permission === null ? (
          <p>Lichess is not connected, so Matchdays are not being created on Lichess.</p>
        ) : (
          <p>
            Connected as{" "}
            <a href={lichessProfileUrl(permission.lichessId)} target="_blank" rel="noopener noreferrer">
              {permission.lichessId}
            </a>{" "}
            on <time dateTime={permission.connectedAt.toISOString()}>{when(permission.connectedAt)}</time>.{" "}
            {expired ? "The permission expired on " : "The permission expires on "}
            <time dateTime={permission.expiresAt.toISOString()}>{when(permission.expiresAt)}</time>
            {expired ? ", so Matchdays are not being created until you connect again." : "; connect again before then."}
          </p>
        )}
        {message && <p role={message.problem ? "alert" : "status"}>{message.text}</p>}
        <p>
          Sign in to Lichess as a leader of the Club&apos;s team first. Lichess asks you to let Offboard create
          tournaments, for each Matchday, and manage the teams you lead, so that a Member who leaves can be removed
          from the team.
        </p>
        <form action={connectOrganiserLichess}>
          <button>{permission ? "Connect Lichess again" : "Connect Lichess"}</button>
        </form>
      </section>

      <section aria-labelledby="jobs">
        <h2 id="jobs">Scheduled jobs</h2>
        {failure ? (
          <p>
            Last failure, <time dateTime={failure.at.toISOString()}>{when(failure.at, true)}</time>: {failure.problem}
          </p>
        ) : (
          <p>No scheduled job has failed.</p>
        )}
      </section>

      <p>
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
