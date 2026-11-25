import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ExternalLink } from "../external-link";
import ui from "../ui.module.css";
import { connectOrganiserLichess } from "./actions";
import { ConnectButton } from "./connect-button";
import styles from "./organiser.module.css";
import { getSession, requireOrganiser } from "@/lib/auth";
import { JOB as COLLECT } from "@/lib/collect-results";
import { dueFrom, JOB as CREATE } from "@/lib/create-matchdays";
import { cronSecretProblem } from "@/lib/cron";
import { lastFailure, lastRun, OVERDUE_MS, type Failure, type LastRun, type Outcome } from "@/lib/jobs";
import { lichessProfileUrl, lichessSwissUrl } from "@/lib/lichess";
import { matchdayOn } from "@/lib/matchdays";
import { isOrganiser } from "@/lib/organiser";
import { LICHESS_SECURITY_URL, organiserMessage, organiserPermission, type OrganiserPermission } from "@/lib/organiser-lichess";
import { ZONE } from "@/lib/schedule";
import { upcomingMatchday, type Matchday } from "@/lib/seasons";

// To anyone but the Organiser the page does not exist, so their tab says so, as app/not-found.tsx does.
export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession().catch(() => null);
  return { title: isOrganiser(session?.user) ? "Organiser" : "Page not found" };
}

// The Organiser's page (the full one is #16). Anyone else gets the not-found page: a visitor with no session cookie
// with a real 404 (proxy.ts); a signed-in Member who is not the Organiser with noindex under a 200, since the static
// shell is sent before the session can be read. Nothing of the page is in that shell, not even its <main>.
export default function OrganiserPage({ searchParams }: PageProps<"/organiser">) {
  return (
    <Suspense>
      <Organiser searchParams={searchParams} />
    </Suspense>
  );
}

// Every time is Vilnius time, like the Matchdays'.
const format = (at: Date, options: Intl.DateTimeFormatOptions) => at.toLocaleString("en-GB", { timeZone: ZONE, ...options });
const DATE = { day: "numeric", month: "long", year: "numeric" } as const;
const DATE_TIME = { ...DATE, hour: "2-digit", minute: "2-digit" } as const;
const WEEKDAY = { weekday: "long", day: "numeric", month: "long" } as const;
const MATCHDAY = { ...WEEKDAY, hour: "2-digit", minute: "2-digit" } as const; // as the home page shows it

const Time = ({ at, as = DATE, className }: { at: Date; as?: Intl.DateTimeFormatOptions; className?: string }) => (
  <time dateTime={at.toISOString()} className={className}>
    {format(at, as)}
  </time>
);

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

const Alert = ({ children }: { children: ReactNode }) => (
  <p role="alert" className={ui.alert}>
    {children}
  </p>
);

async function Organiser({ searchParams }: Pick<PageProps<"/organiser">, "searchParams">) {
  await requireOrganiser();
  const now = new Date();
  const [permission, creating, collecting, failure, next] = await Promise.all([
    organiserPermission(),
    lastRun(CREATE),
    lastRun(COLLECT),
    lastFailure(),
    upcomingMatchday(now),
  ]);
  const tournament = next ? ((await matchdayOn(next.date))?.lichessTournamentId ?? null) : null;
  const message = organiserMessage((await searchParams).lichess);
  const secretProblem = cronSecretProblem();
  // What the page can tell stops every run from creating a Matchday, each shown further down: no permission it can use,
  // and a secret every scheduled request is refused with.
  const usable = permission !== null && permission.readable && permission.expiresAt > now;
  const blockers = Number(!usable) + Number(secretProblem !== null);
  return (
    <main id="main" className={`${ui.page} ${ui.arrive}`}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Only you can see this page</p>
        <h1>Organiser</h1>
        <p className={ui.lede}>
          This page shows whether the site is creating Matchdays on Lichess and collecting their results.
        </p>
      </div>

      <NextMatchday next={next} tournament={tournament} blockers={blockers} now={now} />

      <section aria-labelledby="lichess" className={styles.section}>
        <h2 id="lichess">Lichess permission</h2>
        {message && (
          <p role={message.problem ? "alert" : "status"} className={message.problem ? ui.alert : styles.notice}>
            {message.text}
          </p>
        )}
        <Permission permission={permission} now={now} />
        <p className={`${ui.small} ${ui.muted}`}>
          Before you connect, sign in to Lichess as a leader of the Club&apos;s Lichess team who has the team&apos;s
          permission to manage tournaments: Lichess lets only those leaders create them. Lichess then asks you to let
          Offboard create tournaments and manage the teams you lead. The site doesn&apos;t use the second yet. It asks
          now so that you won&apos;t have to connect again once it can remove a Member from the team.
        </p>
        <form action={connectOrganiserLichess} className={ui.actions}>
          <ConnectButton label={permission ? "Connect Lichess again" : "Connect Lichess"} />
        </form>
      </section>

      <section aria-labelledby="jobs" className={styles.section}>
        <h2 id="jobs">Scheduled jobs</h2>
        {secretProblem && <Alert>{secretProblem}</Alert>}
        <JobStatus
          title={JOBS[CREATE]}
          neverRun="It hasn't run yet. Once the site is deployed with CRON_SECRET set, Vercel runs it every hour."
          run={creating}
          now={now}
        />
        <JobStatus
          title={JOBS[COLLECT]}
          neverRun="It hasn't run yet. Once the site is deployed with CRON_SECRET set, Vercel runs it at least once an hour."
          run={collecting}
          now={now}
        />
        <LastFailure failure={failure} />
      </section>

      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}

type Creation = { tournament: string | null; blockers: number; now: Date };

// Whether the next Matchday is on Lichess yet, and if not, when it will be, or what stops it being created.
function NextMatchday({ next, ...creation }: Creation & { next: Matchday | null }) {
  return (
    <section aria-labelledby="next" className={`${ui.panel} ${styles.status}`}>
      <h2 id="next" className={`${ui.eyebrow} ${styles.label}`}>
        <span className={ui.marker} aria-hidden="true" /> Next Matchday
      </h2>
      {next ? (
        <>
          <p className={styles.value}>
            <Time at={next.start} as={MATCHDAY} />
          </p>
          <OnLichess start={next.start} {...creation} />
        </>
      ) : (
        <>
          <p className={styles.value}>Not scheduled yet</p>
          <p className={styles.note}>Season 1 is scheduled once sixteen Members have joined.</p>
        </>
      )}
    </section>
  );
}

function OnLichess({ start, tournament, blockers, now }: Creation & { start: Date }) {
  if (tournament)
    return (
      <>
        <p className={styles.note}>It&apos;s on Lichess, and Members can join it from the home page.</p>
        <p className={styles.link}>
          <ExternalLink href={lichessSwissUrl(tournament)}>Open it on Lichess</ExternalLink>
        </p>
      </>
    );
  const due = dueFrom(start);
  // Promise no creation the page knows cannot happen.
  if (blockers > 0) {
    const fixed = blockers > 1 ? "the problems below are fixed" : "the problem below is fixed";
    return (
      <Alert>
        {now < due ? (
          <>
            The site should create it on Lichess on <Time at={due} as={WEEKDAY} />, but can&apos;t until {fixed}.
          </>
        ) : (
          <>
            It&apos;s due on Lichess now, but the site can&apos;t create it until {fixed}.
          </>
        )}
      </Alert>
    );
  }
  if (now < due)
    return (
      <p className={styles.note}>
        The site creates it on Lichess on <Time at={due} as={WEEKDAY} />, six days ahead.
      </p>
    );
  // A run every hour: give the first two a chance before calling it late.
  if (now.getTime() - due.getTime() <= OVERDUE_MS)
    return <p className={styles.note}>It&apos;s due on Lichess now. The next hourly run should create it.</p>;
  return <Alert>It should be on Lichess by now, but isn&apos;t. Check the scheduled jobs below.</Alert>;
}

// An expired permission is dead on Lichess too, so there is nothing left to revoke, even if it cannot be read.
function Permission({ permission, now }: { permission: OrganiserPermission | null; now: Date }) {
  if (permission === null) return <p>Lichess isn&apos;t connected, so Matchdays aren&apos;t being created on Lichess.</p>;
  const expired = permission.expiresAt <= now;
  return (
    <>
      <dl className={styles.facts}>
        <Fact label="Account">
          <ExternalLink href={lichessProfileUrl(permission.lichessId)}>{permission.lichessId}</ExternalLink>
        </Fact>
        <Fact label="Connected">
          <Time at={permission.connectedAt} />
        </Fact>
        <Fact label={expired ? "Expired" : permission.readable ? "Expires" : "Valid until"}>
          <Time at={permission.expiresAt} />
        </Fact>
      </dl>
      {expired ? (
        <Alert>It has expired, so Matchdays aren&apos;t being created until you connect again.</Alert>
      ) : permission.readable ? (
        <p className={`${ui.small} ${ui.muted}`}>
          Connect again before it expires: a Lichess permission lasts a year and can&apos;t be extended.
        </p>
      ) : (
        <Unreadable lichessId={permission.lichessId} />
      )}
    </>
  );
}

// The stored permission cannot be opened with LICHESS_TOKEN_KEY: still valid on Lichess, and only its account can end it.
function Unreadable({ lichessId }: { lichessId: string }) {
  return (
    <div role="alert" className={`${ui.alert} ${styles.steps}`}>
      <p>
        This permission can&apos;t be read with the current LICHESS_TOKEN_KEY, so Matchdays aren&apos;t being created. It
        stays valid on Lichess until it expires, and the site can no longer revoke it. To end it and connect again:
      </p>
      <ol>
        <li>Sign in to Lichess as {lichessId}.</li>
        <li>
          Open <ExternalLink href={LICHESS_SECURITY_URL}>Security</ExternalLink> in your Lichess settings and revoke
          Offboard among the third-party apps.
        </li>
        <li>Connect Lichess again below.</li>
      </ol>
      <p>Keep to that order: revoking after you connect would revoke the new permission too.</p>
    </div>
  );
}

const OUTCOMES: Record<Outcome, string> = { done: "Done", skipped: "Nothing to do", failed: "Failed" };

// Each scheduled job by its name on the page, over its own part and in the last failure.
const JOBS: Record<string, string> = { [CREATE]: "Creating Matchdays", [COLLECT]: "Collecting results" };

// A scheduled job's last run, and plainly when it has never run or has not run for over two hours. The outcome comes
// first, in the same place for every job, so that a glance down the box answers "is anything wrong?": a failed outcome
// and a late last run are flagged where they stand, and explained in an alert below. A run that went well keeps its
// sentence quiet.
function JobStatus({ title, neverRun, run, now }: { title: string; neverRun: string; run: LastRun | null; now: Date }) {
  const late = run !== null && now.getTime() - run.at.getTime() > OVERDUE_MS;
  return (
    <div className={styles.part}>
      <h3>{title}</h3>
      {run ? (
        <>
          <dl className={styles.facts}>
            <Fact label="Outcome">
              {run.outcome === "failed" ? <span className={styles.flagged}>{OUTCOMES.failed}</span> : OUTCOMES[run.outcome]}
            </Fact>
            <Fact label="Last run">
              <Time at={run.at} as={DATE_TIME} className={late ? styles.flagged : undefined} />
            </Fact>
          </dl>
          {run.outcome === "failed" ? (
            <Alert>{run.detail}</Alert>
          ) : (
            <p className={styles.detail}>{run.detail}</p>
          )}
          {late && (
            <Alert>
              It hasn&apos;t run for over two hours. Check that CRON_SECRET is set on Vercel and that cron jobs are
              enabled.
            </Alert>
          )}
        </>
      ) : (
        <Alert>{neverRun}</Alert>
      )}
    </div>
  );
}

// The most recent failure of any scheduled job, which job it was and when it began: a problem that stands for days is
// one failure.
function LastFailure({ failure }: { failure: Failure | null }) {
  return (
    <div className={styles.part}>
      <h3>Last failure</h3>
      {failure ? (
        <>
          <dl className={styles.facts}>
            <Fact label="Job">{JOBS[failure.job] ?? failure.job}</Fact>
            <Fact label="Began">
              <Time at={failure.at} as={DATE_TIME} />
            </Fact>
          </dl>
          <p className={styles.detail}>{failure.problem}</p>
        </>
      ) : (
        <p className={styles.detail}>No job has failed.</p>
      )}
    </div>
  );
}
