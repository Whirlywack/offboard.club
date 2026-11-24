import Link from "next/link";
import { Suspense } from "react";
import { connectOrganiserLichess } from "./actions";
import { requireOrganiser } from "@/lib/auth";
import { JOB, OVERDUE_MS } from "@/lib/create-matchdays";
import { cronSecretProblem } from "@/lib/cron";
import { lastFailure, lastRun } from "@/lib/jobs";
import { lichessProfileUrl } from "@/lib/lichess";
import { LICHESS_SECURITY_URL, organiserMessage, organiserPermission, type OrganiserPermission } from "@/lib/organiser-lichess";
import { ZONE } from "@/lib/schedule";

// The Organiser's page (the full one is #16). Anyone else gets the not-found page: a visitor with no session cookie
// with a real 404 (proxy.ts); a signed-in Member who is not the Organiser with noindex under a 200, since the static
// shell is sent before the session can be read. Nothing of the page is in that shell.
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

const Time = ({ at, withTime = false }: { at: Date; withTime?: boolean }) => <time dateTime={at.toISOString()}>{when(at, withTime)}</time>;

async function Organiser({ searchParams }: Pick<PageProps<"/organiser">, "searchParams">) {
  await requireOrganiser();
  const [permission, run, failure] = await Promise.all([organiserPermission(), lastRun(JOB), lastFailure()]);
  const message = organiserMessage((await searchParams).lichess);
  const now = new Date();
  const secretProblem = cronSecretProblem();
  return (
    <main>
      <h1>Organiser</h1>

      <section aria-labelledby="lichess">
        <h2 id="lichess">Lichess permission</h2>
        <Permission permission={permission} now={now} />
        {message && <p role={message.problem ? "alert" : "status"}>{message.text}</p>}
        <p>
          Sign in to Lichess as a leader of the Club&apos;s team first, one with the team&apos;s permission to manage
          tournaments: Lichess lets only such a leader create them. Lichess asks you to let Offboard create
          tournaments, for each Matchday, and manage the teams you lead, so that a Member who leaves can be removed
          from the team.
        </p>
        <form action={connectOrganiserLichess}>
          <button>{permission ? "Connect Lichess again" : "Connect Lichess"}</button>
        </form>
      </section>

      <section aria-labelledby="jobs">
        <h2 id="jobs">Scheduled jobs</h2>
        {secretProblem && <p role="alert">{secretProblem}</p>}
        {run ? (
          <p>
            Creating Matchdays last ran <Time at={run.at} withTime />: {run.outcome}. {run.detail}
          </p>
        ) : (
          <p role="alert">
            Creating Matchdays has never run. Vercel runs it every hour once the site is deployed with CRON_SECRET set;
            until it runs, no Matchday is created.
          </p>
        )}
        {run && now.getTime() - run.at.getTime() > OVERDUE_MS && (
          <p role="alert">
            That was more than two hours ago, though it runs every hour: runs are not getting through. Check that
            CRON_SECRET is set on Vercel and that the project&apos;s cron jobs are enabled.
          </p>
        )}
        {failure ? (
          <p>
            Last failure, from <Time at={failure.at} withTime />: {failure.problem}
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

function Permission({ permission, now }: { permission: OrganiserPermission | null; now: Date }) {
  if (permission === null) return <p>Lichess is not connected, so Matchdays are not being created on Lichess.</p>;
  const account = (
    <a href={lichessProfileUrl(permission.lichessId)} target="_blank" rel="noopener noreferrer">
      {permission.lichessId}
    </a>
  );
  if (!permission.readable)
    return (
      <p role="alert">
        The permission {account} gave on <Time at={permission.connectedAt} /> cannot be read with the current
        LICHESS_TOKEN_KEY, so Matchdays are not being created. It is still valid on Lichess until{" "}
        <Time at={permission.expiresAt} />, and the site can no longer revoke it. First revoke it by hand: signed in to
        Lichess as {permission.lichessId}, open <a href={LICHESS_SECURITY_URL}>Security</a> in your Lichess settings and
        revoke Offboard among the third-party apps. Then connect Lichess again here; revoking afterwards would revoke the
        new permission too.
      </p>
    );
  const expired = permission.expiresAt <= now;
  return (
    <p>
      Connected as {account} on <Time at={permission.connectedAt} />.{" "}
      {expired ? (
        <>
          The permission expired on <Time at={permission.expiresAt} />, so Matchdays are not being created until you
          connect again.
        </>
      ) : (
        <>
          The permission expires on <Time at={permission.expiresAt} />; connect again before then.
        </>
      )}
    </p>
  );
}
