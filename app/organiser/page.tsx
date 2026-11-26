import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ExternalLink } from "../external-link";
import { RuledLinks } from "../ruled-links";
import ui from "../ui.module.css";
import { connectOrganiserLichess, tournamentCancelled } from "./actions";
import { ConnectButton } from "./connect-button";
import { SeasonStart, Sundays, TestMessages } from "./forms";
import styles from "./organiser.module.css";
import { TeamRemovals } from "./team-removals";
import { alertsProblem, JOB as ALERTS, JOB_TITLES } from "@/lib/alerts";
import { getSession, requireOrganiser } from "@/lib/auth";
import { backupProblem, JOB as BACKUP } from "@/lib/backup";
import { JOB as COLLECT, lastTryAt, uncollected, type Uncollected } from "@/lib/collect-results";
import { dueFrom, JOB as CREATE } from "@/lib/create-matchdays";
import { cronSecretProblem } from "@/lib/cron";
import { lastFailure, lastRun, OVERDUE_MS, type Failure, type LastRun, type Outcome } from "@/lib/jobs";
import { membersToRemove, NOT_YOURSELF, teamRemovals, type Removable } from "@/lib/leaving";
import { lichessProfileUrl, lichessSwissEditUrl, lichessSwissUrl } from "@/lib/lichess";
import { matchdayOn } from "@/lib/matchdays";
import { isOrganiser } from "@/lib/organiser";
import { LICHESS_SECURITY_URL, organiserMessage, organiserPermission, type OrganiserPermission } from "@/lib/organiser-lichess";
import { JOB as POST } from "@/lib/post-to-telegram";
import { lastFailedRequest, noticeLater, type FailedRequest } from "@/lib/request-failures";
import { tournamentCancellations, type Cancellation } from "@/lib/reschedule";
import { addDays, latestSunday, matchdayStart, ZONE } from "@/lib/schedule";
import { MAX_SEASONS, nextMatchdayIn, placesIn, readSchedule, seasonDates, type Matchday, type Schedule } from "@/lib/seasons";
import { telegramProblem } from "@/lib/telegram";

// To anyone but the Organiser the page does not exist, so their tab says so, as app/not-found.tsx does.
export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession().catch((error: unknown) => void noticeLater(error, "/organiser"));
  return { title: isOrganiser(session?.user) ? "Organiser" : "Page not found" };
}

// Server Actions run within their page's limit: a change to the schedule waits on Lichess for up to 25 s to cancel a
// tournament (lib/reschedule.ts).
export const maxDuration = 60;

// The Organiser's page. Anyone else gets the not-found page: a visitor with no session cookie with a real 404
// (proxy.ts); a signed-in Member who is not the Organiser with noindex under a 200, since the static shell is sent
// before the session can be read. Nothing of the page is in that shell, not even its <main>.
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

// What needs the Organiser, or with `failed`, what went wrong: marked so (organiser.module.css), and so is its section.
const Alert = ({ children, failed = false }: { children: ReactNode; failed?: boolean }) => (
  <p role="alert" className={failed ? styles.failed : styles.needs}>
    {children}
  </p>
);

async function Organiser({ searchParams }: Pick<PageProps<"/organiser">, "searchParams">) {
  const { id } = await requireOrganiser();
  const now = new Date();
  const params = await searchParams;
  const [permission, creating, collecting, posting, notIn, failure, schedule, removals, cancellations, members] = await Promise.all([
    organiserPermission(),
    lastRun(CREATE),
    lastRun(COLLECT),
    lastRun(POST),
    uncollected(now),
    lastFailure(),
    readSchedule(now),
    teamRemovals(),
    tournamentCancellations(),
    membersToRemove(id),
  ]);
  // The jobs #17 added, the nightly backup and the alerts to the Organiser, and the requests that failed (#60).
  const [backingUp, alerting, failedRequest] = await Promise.all([lastRun(BACKUP), lastRun(ALERTS), lastFailedRequest()]);
  const runs: Record<string, LastRun | null> = { [CREATE]: creating, [COLLECT]: collecting, [POST]: posting, [BACKUP]: backingUp, [ALERTS]: alerting };
  const telegram = telegramProblem();
  const next = nextMatchdayIn(schedule, now);
  const tournament = next ? ((await matchdayOn(next.date))?.lichessTournamentId ?? null) : null;
  const message = organiserMessage(params.lichess);
  const removal = typeof params.member === "string" && Object.hasOwn(REMOVALS, params.member) ? REMOVALS[params.member] : null;
  const secretProblem = cronSecretProblem();
  // What the page can tell stops every run from creating a Matchday, each shown further down: no permission it can use,
  // and a secret every scheduled request is refused with.
  const usable = permission !== null && permission.readable && permission.expiresAt > now;
  const blockers = Number(!usable) + Number(secretProblem !== null);
  return (
    <main id="main" className={styles.page}>
      <div className={styles.top}>
        <div>
          <h1 className={ui.display}>
            <em>Organiser</em>
          </h1>
          <p className={styles.lede}>Only you can see this page</p>
        </div>

        {removal && (
          <p role={removal.problem ? "alert" : "status"} className={removal.problem ? styles.needs : styles.notice}>
            {removal.text}
          </p>
        )}

        <NextMatchday next={next} tournament={tournament} blockers={blockers} now={now} />
      </div>

      <section aria-labelledby="lichess" className={styles.section}>
        <h2 id="lichess">Lichess permission</h2>
        {message && (
          <p role={message.problem ? "alert" : "status"} className={message.problem ? styles.needs : styles.notice}>
            {message.text}
          </p>
        )}
        <Permission permission={permission} now={now} />
        <p className={styles.detail}>
          Before you connect, sign in to Lichess as a leader of the Club&apos;s team with its &ldquo;Tournaments&rdquo;
          and &ldquo;Remove&rdquo; permissions.
        </p>
        <form action={connectOrganiserLichess} className={`${ui.actions} ${styles.fill}`}>
          <ConnectButton label={permission ? "Connect Lichess again" : "Connect Lichess"} quiet={usable} />
        </form>
      </section>

      <TournamentCancellations cancellations={cancellations} />

      <TeamRemovals removals={removals} />

      <ScheduleChanges schedule={schedule} next={next} now={now} />

      <RemoveMember members={members} />

      <section aria-labelledby="telegram" className={styles.section}>
        <h2 id="telegram">Telegram</h2>
        {telegram ? (
          <Alert>{telegram}</Alert>
        ) : (
          <p>The bot posts reminders, Recaps and notices to the group.</p>
        )}
        <TestMessages />
      </section>

      <section aria-labelledby="jobs" className={styles.section}>
        <h2 id="jobs">Scheduled jobs</h2>
        {secretProblem && <Alert>{secretProblem}</Alert>}
        <JobStatus title={JOB_TITLES[CREATE]} neverRun="Not run yet: Vercel runs it hourly once CRON_SECRET is set." run={creating} now={now} />
        <JobStatus
          title={JOB_TITLES[COLLECT]}
          neverRun="Not run yet: Vercel runs it at least hourly once CRON_SECRET is set."
          run={collecting}
          now={now}
        />
        <JobStatus title={JOB_TITLES[POST]} neverRun="Not run yet: Vercel runs it hourly once CRON_SECRET is set." run={posting} now={now} />
        <JobStatus
          title={JOB_TITLES[BACKUP]}
          neverRun="Not run yet: Vercel runs it every night once CRON_SECRET is set."
          run={backingUp}
          now={now}
          daily
          off={backupProblem()}
        />
        <JobStatus
          title={JOB_TITLES[ALERTS]}
          neverRun="Not run yet: Vercel runs it hourly once CRON_SECRET is set."
          run={alerting}
          now={now}
          off={alertsProblem()}
        />
        <ResultsNotIn matchdays={notIn} now={now} />
        <LastFailure failure={failure} since={failure ? (runs[failure.job] ?? null) : null} />
        <LastFailedRequest failure={failedRequest} />
      </section>

      <nav aria-label="More" className={styles.more}>
        <RuledLinks links={[["/", "Home"]]} />
      </nav>
    </main>
  );
}

type Creation = { tournament: string | null; blockers: number; now: Date };

// Whether the next Matchday is on Lichess yet, and if not, when it will be, or what stops it being created.
function NextMatchday({ next, ...creation }: Creation & { next: Matchday | null }) {
  return (
    <section aria-labelledby="next" className={styles.next}>
      <h2 id="next" className={ui.caps}>
        Next Matchday
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
          <p className={styles.detail}>Season 1 is scheduled once sixteen Members have joined.</p>
        </>
      )}
    </section>
  );
}

function OnLichess({ start, tournament, blockers, now }: Creation & { start: Date }) {
  if (tournament)
    return (
      <p className={styles.link}>
        <ExternalLink href={lichessSwissUrl(tournament)}>Open it on Lichess</ExternalLink>
      </p>
    );
  const due = dueFrom(start);
  // Promise no creation the page knows cannot happen.
  if (blockers > 0) {
    const fixed = blockers > 1 ? "the problems below" : "the problem below";
    return (
      <Alert>
        {now < due ? (
          <>
            It&apos;s due on Lichess on <Time at={due} as={WEEKDAY} />, but can&apos;t be created until you fix {fixed}.
          </>
        ) : (
          <>
            It&apos;s due on Lichess now, but can&apos;t be created until you fix {fixed}.
          </>
        )}
      </Alert>
    );
  }
  if (now < due)
    return (
      <p className={styles.detail}>
        It&apos;s due on Lichess on <Time at={due} as={WEEKDAY} />.
      </p>
    );
  // A run every hour: give the first two a chance before calling it late.
  if (now.getTime() - due.getTime() <= OVERDUE_MS)
    return <p className={styles.detail}>It&apos;s due on Lichess now. The next hourly run should create it.</p>;
  return <Alert failed>It should be on Lichess by now. See Creating Matchdays below.</Alert>;
}

// An expired permission is dead on Lichess too, so there is nothing left to revoke, even if it cannot be read.
function Permission({ permission, now }: { permission: OrganiserPermission | null; now: Date }) {
  if (permission === null) return <p className={styles.needs}>Not connected, so Matchdays aren&apos;t being created.</p>;
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
        <Alert>Matchdays aren&apos;t being created until you connect again.</Alert>
      ) : (
        !permission.readable && <Unreadable lichessId={permission.lichessId} />
      )}
    </>
  );
}

// The stored permission cannot be opened with LICHESS_TOKEN_KEY: still valid on Lichess, and only its account can end it.
function Unreadable({ lichessId }: { lichessId: string }) {
  return (
    <div role="alert" className={`${styles.needs} ${styles.steps}`}>
      <p>
        This permission can&apos;t be read with the current LICHESS_TOKEN_KEY, so Matchdays aren&apos;t being created. To
        end it and connect again:
      </p>
      <ol>
        <li>Sign in to Lichess as {lichessId}.</li>
        <li>
          Open <ExternalLink href={LICHESS_SECURITY_URL}>Security</ExternalLink> in your Lichess settings and revoke
          Offboard among the third-party apps.
        </li>
        <li>Connect Lichess again below.</li>
      </ol>
      <p>Keep to that order: revoking afterwards would end the new permission too.</p>
    </div>
  );
}

const OUTCOMES: Record<Outcome, string> = { done: "Done", skipped: "Nothing to do", failed: "Failed" };

const DAY_MS = 86_400_000;

type Status = { title: string; neverRun: string; run: LastRun | null; now: Date; daily?: boolean; off?: string | null };

// A scheduled job's last run, and plainly when it has never run or has not run for over two hours, or a day and two
// hours for one that runs nightly, and why it does nothing when it is switched off (`off`). The outcome comes first, in
// the same place for every job, so that a glance down the section answers "is anything wrong?": a failed outcome and a
// late last run are flagged where they stand, and explained in an alert below, marked as failed. A run that went well
// keeps its sentence quiet.
function JobStatus({ title, neverRun, run, now, daily = false, off = null }: Status) {
  const late = run !== null && now.getTime() - run.at.getTime() > (daily ? DAY_MS : 0) + OVERDUE_MS;
  return (
    <div className={styles.part}>
      <h3>{title}</h3>
      {off && <Alert>{off}</Alert>}
      {run ? (
        <>
          <dl className={styles.facts}>
            <Fact label="Outcome">
              {run.outcome === "failed" ? <span className={styles.flag}>{OUTCOMES.failed}</span> : OUTCOMES[run.outcome]}
            </Fact>
            <Fact label="Last run">
              <Time at={run.at} as={DATE_TIME} className={late ? styles.flag : undefined} />
            </Fact>
          </dl>
          {run.outcome === "failed" ? (
            <Alert failed>{run.detail}</Alert>
          ) : (
            // Said once: a run that did nothing because the job is off says what the alert above says.
            run.detail !== off && <p className={styles.detail}>{run.detail}</p>
          )}
          {late && (
            <Alert failed>
              It hasn&apos;t run for over {daily ? "a day" : "two hours"}. Check that CRON_SECRET is set on Vercel and that
              cron jobs are enabled.
            </Alert>
          )}
        </>
      ) : (
        <Alert>{neverRun}</Alert>
      )}
    </div>
  );
}

// The Matchdays of the last eight Sundays played on Lichess whose results are not in (lib/collect-results.ts), so that
// one Collecting results has stopped looking after stays in sight, marked as needing the Organiser. Nothing when there
// are none.
function ResultsNotIn({ matchdays, now }: { matchdays: Uncollected[]; now: Date }) {
  if (matchdays.length === 0) return null;
  const latest = latestSunday(now);
  return (
    <div className={styles.part}>
      <h3>Results not in</h3>
      <ul role="list" className={styles.list}>
        {matchdays.map(({ date, lichessTournamentId }) => (
          <li key={date} className={date === latest ? undefined : styles.needs}>
            <Time at={matchdayStart(date)} as={WEEKDAY} className={styles.when} />{" "}
            {date === latest ? (
              <>
                Checked until <Time at={lastTryAt(date)} as={MATCHDAY} />.
              </>
            ) : (
              <>No longer checked. If Lichess still has its tournament, run pnpm ingest {lichessTournamentId}.</>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The most recent failure of any scheduled job, which job it was, when it began (a problem that stands for days is one
// failure) and whether the job has run without failing since, by its last run (`since`).
function LastFailure({ failure, since }: { failure: Failure | null; since: LastRun | null }) {
  return (
    <div className={styles.part}>
      <h3>Last failure</h3>
      {failure ? (
        <>
          <dl className={styles.facts}>
            <Fact label="Job">{JOB_TITLES[failure.job] ?? failure.job}</Fact>
            <Fact label="Began">
              <Time at={failure.at} as={DATE_TIME} />
            </Fact>
            {since && (
              <Fact label="Since">
                {since.outcome === "failed" ? (
                  "Still failing"
                ) : (
                  <>
                    Ran without failing on <Time at={since.at} as={DATE_TIME} />
                  </>
                )}
              </Fact>
            )}
          </dl>
          <p className={styles.detail}>{failure.problem}</p>
        </>
      ) : (
        <p className={styles.detail}>No job has failed.</p>
      )}
    </div>
  );
}

const upper = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// The kind of request that failed last (lib/request-failures.ts): its address's shape, its kind, when it last failed
// and why. History, like the last failure above, so not an alert.
function LastFailedRequest({ failure }: { failure: FailedRequest | null }) {
  return (
    <div className={styles.part}>
      <h3>Last failed request</h3>
      {failure ? (
        <>
          <dl className={styles.facts}>
            <Fact label="Address">{failure.route}</Fact>
            <Fact label="Kind">{upper(failure.kind)}</Fact>
            <Fact label="Last failed">
              <Time at={failure.at} as={DATE_TIME} />
            </Fact>
          </dl>
          <p className={styles.detail}>{upper(failure.reason)}.</p>
        </>
      ) : (
        <p className={styles.detail}>No failed request has been recorded.</p>
      )}
    </div>
  );
}

// The tournaments the site couldn't cancel on Lichess for Sundays that are no longer Matchdays (lib/reschedule.ts), by
// Sunday, each with why, the page on Lichess that cancels it, and a button for once the Organiser has, which forgets
// it, the whole section marked as needing the Organiser. Nothing at all when there are none.
function TournamentCancellations({ cancellations }: { cancellations: Cancellation[] }) {
  if (cancellations.length === 0) return null;
  return (
    <section aria-labelledby="cancellations" className={`${styles.section} ${styles.byHand}`}>
      <h2 id="cancellations">Cancel on Lichess</h2>
      <p>
        The site couldn&apos;t cancel these Sundays&apos; tournaments on Lichess. Cancel each there, signed in as the
        account that created it, then press Done.
      </p>
      <ul role="list">
        {cancellations.map(({ lichessTournamentId, date, problem }) => (
          <li key={lichessTournamentId} className={styles.part}>
            <h3>
              <Time at={matchdayStart(date)} as={WEEKDAY} />
            </h3>
            <p className={styles.detail}>{problem}</p>
            <p className={styles.link}>
              <ExternalLink href={lichessSwissEditUrl(lichessTournamentId)}>Cancel it on Lichess</ExternalLink>
            </p>
            <form action={tournamentCancelled} className={ui.actions}>
              <input type="hidden" name="lichessTournamentId" value={lichessTournamentId} />
              <button className={ui.quiet}>
                Done<span className="visually-hidden">: the tournament for {format(matchdayStart(date), WEEKDAY)} is cancelled</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

// How many Sundays the page lists to skip or unskip, from the next: about two months.
const SUNDAYS_LISTED = 8;

// Skipping a Sunday, undoing that, and setting a Season's start (lib/reschedule.ts). The Seasons offered are the next
// two whose first Matchday is still to come, or Season 1 alone while it is not scheduled.
function ScheduleChanges({ schedule, next, now }: { schedule: Schedule; next: Matchday | null; now: Date }) {
  const first = addDays(latestSunday(now), 7);
  const dates = Array.from({ length: SUNDAYS_LISTED }, (_, i) => addDays(first, 7 * i));
  const places = placesIn(schedule, dates);
  const sundays = dates.map((date) => {
    const place = places.get(date);
    return {
      date,
      day: format(matchdayStart(date), WEEKDAY),
      matchday: place ? `Season ${place.season}, Matchday ${place.number}` : null,
      skipped: schedule.skipped.includes(date),
    };
  });
  const from = !next ? 1 : next.number === 1 ? next.season : next.season + 1;
  const seasons = (next ? [from, from + 1] : [1]).filter((n) => n <= MAX_SEASONS).map((number) => {
    const start = seasonDates(schedule, number)?.[0];
    return { number, label: start ? `Season ${number}, now from ${format(matchdayStart(start), WEEKDAY)}` : `Season ${number}, not scheduled yet` };
  });
  return (
    <section aria-labelledby="schedule" className={styles.section}>
      <h2 id="schedule">Schedule</h2>
      {sundays.some((s) => s.matchday || s.skipped) ? (
        <Sundays sundays={sundays} />
      ) : (
        <p className={styles.detail}>No Matchday in the next {SUNDAYS_LISTED} weeks.</p>
      )}
      <SeasonStart seasons={seasons} first={first} />
    </section>
  );
}

// How the last removal went, by the code app/organiser/actions.ts sends back in the address.
const REMOVALS: Record<string, { text: string; problem: boolean }> = {
  removed: { text: "Member removed.", problem: false },
  gone: { text: "That Member has already left the Club.", problem: true },
  self: { text: NOT_YOURSELF, problem: true },
};

// Choosing a Member by name. Continue opens the step that confirms it (app/organiser/remove), which says what removing
// them does, the same as deleting their own account; choosing changes nothing.
function RemoveMember({ members }: { members: Removable[] }) {
  return (
    <section aria-labelledby="remove" className={styles.section}>
      <h2 id="remove">Remove a Member</h2>
      {members.length === 0 ? (
        <p className={styles.detail}>There&apos;s nobody to remove.</p>
      ) : (
        <form action="/organiser/remove" className={styles.part}>
          <div className={styles.field}>
            <label htmlFor="remove-member">Member</label>
            <select id="remove-member" name="member" required defaultValue="">
              <option value="" disabled>
                Choose a Member
              </option>
              {members.map(({ id, name, lichessUsername }) => (
                <option key={id} value={id}>
                  {name} ({lichessUsername})
                </option>
              ))}
            </select>
          </div>
          <div className={`${ui.actions} ${styles.fill}`}>
            <button>Continue</button>
          </div>
        </form>
      )}
    </section>
  );
}

