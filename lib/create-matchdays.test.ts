// The scheduled job that creates each Matchday's tournament on Lichess, through its two entry points: the run itself
// (createUpcomingMatchday, at a supplied time) and the endpoint Vercel calls. Faked: Lichess
// (lib/fixtures/fake-lichess.ts, standing in for fetch) and the database (lib/fake-db.ts). The Organiser's permission is
// connected beforehand the way the Organiser connects it; everything else is the app's own code.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cronRequest, maxDuration } from "@/app/api/jobs/create-matchdays/route";
import { addPerson, db, jobFailures, matchdays, organiserLichess, scheduledJobs, seasons, skippedSundays, resetDb, tournamentCancellations } from "@/lib/fake-db";
import { createFakeLichess, type FakeSwiss } from "@/lib/fixtures/fake-lichess";
import { createUpcomingMatchday, JOB } from "./create-matchdays";
import { lastFailure } from "./jobs";
import { finishOrganiserConnection, startOrganiserConnection } from "./organiser-lichess";

vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const TEAM = "offboard-team";
const KEY = randomBytes(32).toString("base64");
const SECRET = "a-cron-secret-of-forty-characters-123456";

// Season 1 starts on Sunday 29 November 2026; its first Matchday starts at 20:00 Vilnius time, 18:00 UTC.
const DATE = "2026-11-29";
const START = new Date("2026-11-29T18:00:00Z");
const SIX_DAYS = 6 * 86_400_000;
const at = (iso: string) => new Date(iso);
const DUE = at("2026-11-24T12:00:00Z"); // five days and six hours before

let lichess: ReturnType<typeof createFakeLichess>;
let token: string; // the Organiser's, as Lichess issued it
let logged: string[];

const requests = () => lichess.calls.map((c) => `${c.method} ${c.path}`);
const creations = () => lichess.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/swiss/new/"));
const created = () => [...lichess.tournaments.values()].filter((t) => t.form);

// One run of the job at `now`, with Lichess's clock at the same moment.
function runAt(now: Date) {
  lichess.now = () => now.getTime();
  return createUpcomingMatchday(now);
}

const seasonOne = (start: string) => seasons.set(1, { number: 1, start });

// The database losing its connection for statements that start with `start`, the first `times` of them.
const fakeQuery = db.query.getMockImplementation()!;
function breakStatements(start: string, times = Infinity) {
  let broken = 0;
  db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.trimStart().startsWith(start) && broken++ < times) throw new Error("Connection terminated unexpectedly");
    return fakeQuery(sql, params);
  });
}

// The Organiser connects their Lichess account, which leads the team, as they would from the Organiser page.
async function connectOrganiser() {
  const { url, cookie } = startOrganiserConnection("organiser");
  lichess.signedInAs = "boss";
  const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
  expect(await finishOrganiserConnection({ id: "organiser" }, back.searchParams, cookie)).toBe("/organiser?lichess=connected");
  token = [...lichess.tokens].find(([, t]) => !t.revoked && t.accountId === "boss")![0];
  lichess.calls.length = 0;
  db.query.mockClear();
}

beforeEach(async () => {
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test secret");
  vi.stubEnv("LICHESS_TEAM_ID", TEAM);
  vi.stubEnv("ORGANISER_USER_ID", "organiser");
  vi.stubEnv("LICHESS_TOKEN_KEY", KEY);
  vi.stubEnv("CRON_SECRET", SECRET);
  lichess = createFakeLichess({
    teamId: TEAM,
    teamPassword: "pw",
    accounts: [
      { id: "boss", username: "Boss" },
      { id: "helper", username: "Helper" },
    ],
  });
  lichess.team.leaders.add("boss");
  vi.stubGlobal("fetch", lichess.fetch);
  resetDb();
  addPerson("organiser", { lichessId: "boss-plays" });
  seasonOne(DATE);
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  await connectOrganiser();
});

afterEach(() => {
  // Whatever happened, the token went nowhere but Lichess's Authorization header.
  expect(logged.join("\n")).not.toContain(token);
  const recorded = JSON.stringify([...jobFailures.values(), ...scheduledJobs.values(), ...matchdays.values()]);
  expect(recorded).not.toContain(token);
  db.query.mockImplementation(fakeQuery);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("creating the upcoming Matchday's tournament", () => {
  it("creates a Swiss on the Club's team with exactly the Matchday's settings, as the Organiser", async () => {
    const run = await runAt(DUE);
    const id = matchdays.get(DATE)?.lichessTournamentId;
    expect(run).toEqual({ outcome: "done", detail: `Created tournament ${id} on Lichess for the Matchday of ${DATE}.`, matchdayDate: DATE });
    expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(requests()).toEqual([`GET /api/team/${TEAM}/swiss`, `POST /api/swiss/new/${TEAM}`]);
    const [create] = creations();
    expect(create.authorization).toBe(`Bearer ${token}`);
    expect(Object.fromEntries(create.body)).toEqual({
      name: "Offboard Matchday 2026-11-29",
      "clock.limit": "300",
      "clock.increment": "3",
      nbRounds: "5",
      startsAt: String(START.getTime()),
      rated: "true",
      "conditions.playYourGames": "false",
      description: "Offboard's weekly Matchday: five Games of five minutes plus three seconds a move. Recaps at https://offboard.club",
    });
    // As Lichess made it: on the Club's team, by the Organiser's account, not yet started.
    expect(lichess.tournaments.get(id!)).toMatchObject({ teamId: TEAM, createdBy: "boss", status: "created", startsAt: START.toISOString() });
    expect(matchdays.get(DATE)).toEqual({ date: DATE, lichessTournamentId: id, ingestedAt: null });
    expect(scheduledJobs.get(JOB)).toMatchObject({ lastOutcome: "done", lastDetail: run.detail, lockedBy: null, lockedUntil: null });
    expect(lichess.calls.every((c) => c.userAgent?.includes("offboard.club"))).toBe(true);
  });

  it.each([
    ["the Sunday before summer time", "2027-03-21", "2027-03-21T18:00:00.000Z"],
    ["the Sunday summer time begins", "2027-03-28", "2027-03-28T17:00:00.000Z"],
    ["the Sunday before summer time ends", "2027-10-24", "2027-10-24T17:00:00.000Z"],
    ["the Sunday summer time ends", "2027-10-31", "2027-10-31T18:00:00.000Z"],
  ])("starts it at 20:00 Vilnius time on %s", async (_, date, start) => {
    seasonOne(date);
    const now = new Date(Date.parse(start) - 5 * 86_400_000);
    expect((await runAt(now)).outcome).toBe("done");
    expect(creations()[0].body.get("startsAt")).toBe(String(Date.parse(start)));
    expect(creations()[0].body.get("name")).toBe(`Offboard Matchday ${date}`);
    expect(lichess.tournaments.get(matchdays.get(date)!.lichessTournamentId!)?.startsAt).toBe(start);
  });

  it("does it once the Matchday is six days away, and not before", async () => {
    const early = await runAt(new Date(START.getTime() - SIX_DAYS - 1));
    expect(early).toEqual({
      outcome: "skipped",
      detail: `The next Matchday, ${DATE}, is more than 6 days away; its tournament is created once it is 6 days away.`,
      matchdayDate: DATE,
    });
    expect(lichess.calls).toEqual([]);
    expect(matchdays.size).toBe(0);
    expect(scheduledJobs.get(JOB)).toMatchObject({ lastOutcome: "skipped", lastDetail: early.detail });
    expect((await runAt(new Date(START.getTime() - SIX_DAYS))).outcome).toBe("done");
  });

  it("moves on to the next Matchday once one starts, while Members can still join that one from the home page", async () => {
    expect(await runAt(at("2026-11-29T18:05:00Z"))).toMatchObject({ outcome: "skipped", matchdayDate: "2026-12-06" });
    expect(lichess.calls).toEqual([]);
    expect(matchdays.size).toBe(0);
  });

  it("does nothing when no Season is scheduled, and says so", async () => {
    seasons.clear();
    const run = await runAt(DUE);
    expect(run).toEqual({ outcome: "skipped", detail: "No Matchday is scheduled, so there is nothing to create.", matchdayDate: null });
    expect(lichess.calls).toEqual([]);
    expect(matchdays.size).toBe(0);
    expect(jobFailures.size).toBe(0);
    expect(scheduledJobs.get(JOB)?.lastDetail).toBe(run.detail);
  });

  it("gives a skipped Sunday no tournament, and creates the next Matchday's in its turn", async () => {
    seasonOne("2026-12-06");
    skippedSundays.set("2026-12-06", { date: "2026-12-06" });
    const before = await runAt(at("2026-12-01T12:00:00Z"));
    expect(before).toMatchObject({ outcome: "skipped", matchdayDate: "2026-12-13" });
    expect(lichess.calls).toEqual([]);
    expect((await runAt(at("2026-12-08T12:00:00Z"))).outcome).toBe("done");
    expect([...matchdays.keys()]).toEqual(["2026-12-13"]);
    expect(creations().map((c) => c.body.get("name"))).toEqual(["Offboard Matchday 2026-12-13"]);
  });

  it("leaves a Matchday that already has its tournament alone, without asking Lichess", async () => {
    await runAt(DUE);
    const id = matchdays.get(DATE)!.lichessTournamentId;
    lichess.calls.length = 0;
    expect(await runAt(new Date(DUE.getTime() + 3_600_000))).toEqual({
      outcome: "skipped",
      detail: `The Matchday of ${DATE} already has its tournament, ${id}.`,
      matchdayDate: DATE,
    });
    expect(lichess.calls).toEqual([]);
    expect(created()).toHaveLength(1);
  });

  it("creates it once when two runs start at the same moment", async () => {
    const runs = await Promise.all([runAt(DUE), runAt(DUE)]);
    expect(runs.map((r) => r.outcome).sort()).toEqual(["done", "skipped"]);
    expect(runs.find((r) => r.outcome === "skipped")?.detail).toBe("Another run was already working on it.");
    expect(creations()).toHaveLength(1);
    expect(created()).toHaveLength(1);
    expect(matchdays.get(DATE)?.lichessTournamentId).toBe(created()[0].id);
  });

  it("does nothing while another run holds the job, and takes over once that run's hold has lapsed", async () => {
    scheduledJobs.set(JOB, { job: JOB, lockedBy: "a run that died", lockedUntil: new Date(Date.now() + 60_000), lastRunAt: null, lastOutcome: null, lastDetail: null });
    expect((await runAt(DUE)).outcome).toBe("skipped");
    expect(lichess.calls).toEqual([]);
    scheduledJobs.get(JOB)!.lockedUntil = new Date(Date.now() - 1);
    expect((await runAt(DUE)).outcome).toBe("done");
    expect(creations()).toHaveLength(1);
  });
});

describe("recovering from a run that created the tournament without recording it", () => {
  it("records the tournament created when the database failed, instead of creating another", async () => {
    breakStatements(`insert into "matchday"`, 1);
    const first = await runAt(DUE);
    const [made] = created();
    expect(first).toEqual({
      outcome: "failed",
      detail: `Tournament ${made.id} was created on Lichess for the Matchday of ${DATE} but could not be recorded (Connection terminated unexpectedly); the next run records it.`,
      matchdayDate: DATE,
    });
    expect(matchdays.size).toBe(0);

    lichess.calls.length = 0;
    const second = await runAt(new Date(DUE.getTime() + 3_600_000));
    expect(second).toEqual({
      outcome: "done",
      detail: `Recorded tournament ${made.id}, which an earlier run created on Lichess without recording it, as the Matchday of ${DATE}.`,
      matchdayDate: DATE,
    });
    expect(requests()).toEqual([`GET /api/team/${TEAM}/swiss`]);
    expect(created()).toHaveLength(1);
    expect(matchdays.get(DATE)?.lichessTournamentId).toBe(made.id);
  });

  it("records the tournament whose creation Lichess answered but the answer was lost", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await lichess.fetch(input, init);
      if (new URL(String(input)).pathname.startsWith("/api/swiss/new/")) throw new TypeError("fetch failed");
      return response;
    });
    const first = await runAt(DUE);
    expect(first).toEqual({ outcome: "failed", detail: `The Matchday of ${DATE} could not be created: Lichess couldn't be reached.`, matchdayDate: DATE });
    expect(created()).toHaveLength(1);

    vi.stubGlobal("fetch", lichess.fetch);
    expect((await runAt(new Date(DUE.getTime() + 3_600_000))).outcome).toBe("done");
    expect(created()).toHaveLength(1);
    expect(matchdays.get(DATE)?.lichessTournamentId).toBe(created()[0].id);
  });

  it("records the tournament of a run that died after creating it, once that run's hold has lapsed", async () => {
    const earlier: FakeSwiss = { id: "EaRLieR1", teamId: TEAM, status: "created", startsAt: START.toISOString(), results: "", games: "", name: `Offboard Matchday ${DATE}`, createdBy: "boss" };
    lichess.tournaments.set(earlier.id, earlier);
    scheduledJobs.set(JOB, { job: JOB, lockedBy: "the run that died", lockedUntil: new Date(Date.now() - 1), lastRunAt: null, lastOutcome: null, lastDetail: null });
    expect((await runAt(DUE)).outcome).toBe("done");
    expect(creations()).toEqual([]);
    expect(matchdays.get(DATE)?.lichessTournamentId).toBe("EaRLieR1");
  });

  it("reports a failure, not success, when the tournament it found cannot be recorded as this Matchday's", async () => {
    const earlier: FakeSwiss = { id: "EaRLieR1", teamId: TEAM, status: "created", startsAt: START.toISOString(), results: "", games: "", name: `Offboard Matchday ${DATE}`, createdBy: "boss" };
    lichess.tournaments.set(earlier.id, earlier);
    // Already recorded as another day's Matchday, so it cannot be this one's too.
    matchdays.set("2026-11-22", { date: "2026-11-22", lichessTournamentId: "EaRLieR1", ingestedAt: null });
    const run = await runAt(DUE);
    expect(run).toEqual({
      outcome: "failed",
      detail: `Tournament EaRLieR1 is on Lichess for the Matchday of ${DATE}, but was not recorded: that Matchday already has another tournament, or this one is another Matchday's.`,
      matchdayDate: DATE,
    });
    expect(matchdays.has(DATE)).toBe(false);
    expect(creations()).toEqual([]);
    expect(await lastFailure()).toMatchObject({ job: JOB, matchdayDate: DATE, problem: run.detail });
  });

  it("creates nothing when the team has a tournament of the Matchday's name starting at another time", async () => {
    const other: FakeSwiss = { id: "MoVeD123", teamId: TEAM, status: "created", startsAt: "2026-11-29T16:00:00.000Z", results: "", games: "", name: `Offboard Matchday ${DATE}` };
    lichess.tournaments.set(other.id, other);
    const run = await runAt(DUE);
    expect(run.outcome).toBe("failed");
    expect(run.detail).toBe(
      `The Matchday of ${DATE} could not be created: the Club's team already has a tournament named "Offboard Matchday ${DATE}" that does not start at 20:00 Vilnius time that day, so none was created. Check it on Lichess.`,
    );
    expect(creations()).toEqual([]);
    expect(matchdays.size).toBe(0);
  });

  it("creates nothing when it cannot look for an earlier tournament", async () => {
    lichess.override = (call) => (call.path.endsWith("/swiss") ? Response.json({ error: "Oops" }, { status: 500 }) : undefined);
    const run = await runAt(DUE);
    expect(run).toMatchObject({ outcome: "failed", detail: expect.stringContaining("Lichess answered GET /api/team/{teamId}/swiss with 500") });
    expect(creations()).toEqual([]);
  });
});

describe("the Organiser's permission", () => {
  const cannot = (why: string) => ({ outcome: "failed", detail: `The Matchday of ${DATE} could not be created: ${why}`, matchdayDate: DATE });

  it("is needed: without it nothing is created, and the failure is recorded", async () => {
    organiserLichess.clear();
    expect(await runAt(DUE)).toEqual(cannot("The Organiser has not connected their Lichess account on the Organiser page."));
    expect(lichess.calls).toEqual([]);
  });

  it("must not have expired", async () => {
    organiserLichess.get("singleton")!.expiresAt = new Date(DUE.getTime() - 1);
    const run = await runAt(DUE);
    expect(run).toEqual(cannot(`The Organiser's Lichess permission expired on 2026-11-24; the Organiser must connect Lichess again on the Organiser page.`));
    expect(lichess.calls).toEqual([]);
  });

  it("lasts the year Lichess gave it", async () => {
    const { expiresAt } = organiserLichess.get("singleton")!;
    expect(Math.abs(expiresAt.getTime() - (Date.now() + 31_536_000_000))).toBeLessThan(60_000);
  });

  it("must be the current Organiser's", async () => {
    vi.stubEnv("ORGANISER_USER_ID", "someone-else");
    expect((await runAt(DUE)).detail).toContain("The Organiser has not connected their Lichess account");
    expect(lichess.calls).toEqual([]);
  });

  it("cannot be used without its key, or once what is stored has been changed", async () => {
    vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"));
    const unreadable = cannot(
      "The Organiser's stored Lichess permission cannot be read (LICHESS_TOKEN_KEY has changed, or what is stored was altered); the Organiser must connect Lichess again on the Organiser page, after revoking the old permission by hand on Lichess (https://lichess.org/account/security, signed in as boss).",
    );
    expect(await runAt(DUE)).toEqual(unreadable);
    vi.stubEnv("LICHESS_TOKEN_KEY", KEY);
    const row = organiserLichess.get("singleton")!;
    const [version, iv, sealed, tag] = row.token.split(".");
    const bytes = Buffer.from(sealed, "base64url");
    bytes[0] ^= 1;
    row.token = [version, iv, bytes.toString("base64url"), tag].join(".");
    expect(await runAt(DUE)).toEqual(unreadable);
    vi.stubEnv("LICHESS_TOKEN_KEY", "");
    expect((await runAt(DUE)).detail).toContain("LICHESS_TOKEN_KEY is not set");
    expect(lichess.calls).toEqual([]);
  });

  it("is reported plainly when Lichess refuses it", async () => {
    lichess.tokens.get(token)!.revoked = true;
    expect(await runAt(DUE)).toEqual(
      cannot("Lichess refused the Organiser's permission, which may have been revoked on Lichess; the Organiser must connect Lichess again on the Organiser page."),
    );
    expect(matchdays.size).toBe(0);
  });

  // The site checks only that the account is among the team's leaders Lichess shows; Lichess also wants the team's
  // permission for tournaments, and refuses creation without it as it refuses someone who is no leader at all.
  const notGranted = cannot(
    "Lichess answered POST /api/swiss/new/{teamId} with 404: You're not a leader of that team. The likely cause: boss leads the Club's team but without the team's permission to manage tournaments, which Lichess requires. A team admin can grant it in the team's leader settings on Lichess, or the Organiser can connect a leader who has it.",
  );

  it("must be a leader's with the team's permission for tournaments, which the failure names as the likely cause", async () => {
    lichess.team.withoutTournaments.add("boss");
    expect(await runAt(DUE)).toEqual(notGranted);
    expect(creations()).toHaveLength(1);
    expect(created()).toEqual([]);
    expect([...jobFailures.values()]).toMatchObject([{ problem: notGranted.detail }]);
  });

  it("must still be a leader's: Lichess's refusal is recorded with the same likely cause", async () => {
    lichess.team.leaders.delete("boss");
    expect(await runAt(DUE)).toEqual(notGranted);
    expect(created()).toEqual([]);
  });
});

describe("failures", () => {
  it("are recorded with the job, the time and the Matchday, the latest first", async () => {
    organiserLichess.clear();
    await runAt(DUE);
    vi.stubEnv("LICHESS_TEAM_ID", "");
    await runAt(DUE);
    expect([...jobFailures.values()]).toEqual([
      { id: 1, job: JOB, at: expect.any(Date), matchdayDate: DATE, problem: expect.stringContaining("has not connected their Lichess account") },
      { id: 2, job: JOB, at: expect.any(Date), matchdayDate: DATE, problem: expect.stringContaining("LICHESS_TEAM_ID is not set") },
    ]);
    expect(await lastFailure()).toEqual({ job: JOB, at: expect.any(Date), matchdayDate: DATE, problem: expect.stringContaining("LICHESS_TEAM_ID is not set") });
    expect(scheduledJobs.get(JOB)).toMatchObject({ lastOutcome: "failed", lockedBy: null });
  });

  it("are recorded when the job stops before it knows the Matchday", async () => {
    breakStatements(`select "number", to_char("start", 'YYYY-MM-DD') as "start" from "season"`);
    expect(await runAt(DUE)).toEqual({ outcome: "failed", detail: "The job stopped: Connection terminated unexpectedly.", matchdayDate: null });
    expect([...jobFailures.values()]).toMatchObject([{ job: JOB, matchdayDate: null }]);
  });

  it("are recorded once while a problem stands, and again when it changes or comes back", async () => {
    organiserLichess.clear();
    for (let hour = 0; hour < 3; hour++) await runAt(new Date(DUE.getTime() + hour * 3_600_000));
    expect(jobFailures.size).toBe(1);
    expect(scheduledJobs.get(JOB)).toMatchObject({ lastOutcome: "failed", lastDetail: expect.stringContaining("has not connected") });

    vi.stubEnv("LICHESS_TEAM_ID", "");
    await runAt(DUE);
    await runAt(DUE);
    expect([...jobFailures.values()].map((f) => f.problem)).toEqual([
      expect.stringContaining("has not connected their Lichess account"),
      expect.stringContaining("LICHESS_TEAM_ID is not set"),
    ]);

    // Fixed, then broken again in the same way: a new failure.
    vi.stubEnv("LICHESS_TEAM_ID", TEAM);
    seasons.clear();
    expect((await runAt(DUE)).outcome).toBe("skipped");
    vi.stubEnv("LICHESS_TEAM_ID", "");
    seasonOne(DATE);
    await runAt(DUE);
    expect(jobFailures.size).toBe(3);
  });

  it("are not recorded for runs that did what they should", async () => {
    await runAt(DUE);
    await runAt(DUE);
    expect(jobFailures.size).toBe(0);
    expect(await lastFailure()).toBeNull();
  });
});

describe("the run's time", () => {
  const cannot = (why: string) => ({ outcome: "failed", detail: `The Matchday of ${DATE} could not be created: ${why}`, matchdayDate: DATE });

  // A run at `at`, DUE unless told otherwise. A tournament is kept to cancel by hand for the week off, 10 January, still to come, which the run asks
  // Lichess again to cancel. The run's first statement, its hold on the job, waits `hold` ms, and the one that records
  // the run `record` ms, as for a connection to a database tried twice (lib/db.ts). Lichess is rate-limiting: each
  // request answers 429 after 25 s, and after the minute's wait, 25 s later, the team's tournaments, or never anything
  // else. What the run did, when it ended from its first line, and each request Lichess was sent.
  async function slowRun(hold: number, record: number, at = DUE) {
    vi.useFakeTimers({ now: at, toFake: ["Date", "setTimeout", "clearTimeout"] });
    lichess.now = () => at.getTime();
    tournamentCancellations.set("WeekOff1", { lichessTournamentId: "WeekOff1", date: "2027-01-10", problem: "kept" });
    db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const wait = sql.startsWith(`insert into "scheduledJob"`) ? hold : sql.startsWith(`update "scheduledJob"`) ? record : 0;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      return fakeQuery(sql, params);
    });
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit) => {
      const key = `${init.method ?? "GET"} ${new URL(String(input)).pathname}`;
      const again = asked.includes(key);
      asked.push(key);
      await new Promise((resolve, reject) => {
        if (!again || key.startsWith("GET")) setTimeout(resolve, 25_000);
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      });
      return again ? lichess.fetch(input, init) : new Response(null, { status: 429 });
    });
    let ended = 0;
    const running = createUpcomingMatchday(at).then((run) => ((ended = Date.now() - at.getTime()), run));
    await vi.advanceTimersByTimeAsync(600_000);
    const run = await running;
    vi.useRealTimers();
    return { run, ended, asked };
  }

  it("gives up on Lichess 240 s after its first line, the sweep's cancelling included, so that it is recorded inside its 300 s", async () => {
    // The hold takes until 20 s; the look for an earlier tournament until 130 s; the creation is given up at 240 s.
    const { run, ended, asked } = await slowRun(20_000, 20_000);
    expect(run).toEqual(cannot("Lichess didn't answer within the run's 240 s."));
    // The sweep had no time left, so Lichess was asked nothing more, and the tournament is kept, saying so.
    const [look, create] = [`GET /api/team/${TEAM}/swiss`, `POST /api/swiss/new/${TEAM}`];
    expect(asked).toEqual([look, look, create, create]);
    expect(tournamentCancellations.get("WeekOff1")?.problem).toBe("There was no time left to ask Lichess.");
    expect(scheduledJobs.get(JOB)).toMatchObject({ lastOutcome: "failed", lastDetail: run.detail, lockedBy: null });
    expect(ended).toBe(260_000);
    expect(ended).toBeLessThanOrEqual(maxDuration * 1000);
  });

  it("asks Lichess nothing once the run's 240 s have gone, and says so", async () => {
    const { run, asked } = await slowRun(241_000, 0);
    expect(run).toEqual(cannot("There was no time left to ask Lichess."));
    expect(asked).toEqual([]);
    expect(scheduledJobs.get(JOB)?.lastDetail).toBe(run.detail);
  });

  it("records a failure that stands once, however long each hourly run's reads took", async () => {
    // Each run's hold takes 16 s or more, so that the run's 240 s are up before a request's own 30 s.
    const details: string[] = [];
    for (const [hour, hold] of [[0, 16_000], [1, 18_000], [2, 20_000]])
      details.push((await slowRun(hold, 0, new Date(DUE.getTime() + hour * 3_600_000))).run.detail);
    expect(details).toEqual(Array(3).fill(cannot("Lichess didn't answer within the run's 240 s.").detail));
    expect(jobFailures.size).toBe(1);
  });

  it("gives up on cancelling after 25 s, however much of the run is left", async () => {
    // Its Matchday is more than six days away, so the run creates nothing; Lichess never answers.
    vi.useFakeTimers({ now: DUE, toFake: ["Date", "setTimeout", "clearTimeout"] });
    tournamentCancellations.set("WeekOff1", { lichessTournamentId: "WeekOff1", date: "2027-01-10", problem: "kept" });
    vi.stubGlobal("fetch", (_: unknown, init: RequestInit) => new Promise((__, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    let ended = 0;
    const running = createUpcomingMatchday(new Date(START.getTime() - SIX_DAYS - 1)).then((run) => ((ended = Date.now() - DUE.getTime()), run));
    await vi.advanceTimersByTimeAsync(300_000);
    expect((await running).outcome).toBe("skipped");
    vi.useRealTimers();
    expect(tournamentCancellations.get("WeekOff1")?.problem).toBe("Lichess took more than 25 s.");
    expect(ended).toBe(25_000);
  });
});

describe("the endpoint Vercel calls", () => {
  const call = (headers: Record<string, string> = {}) =>
    cronRequest(new Request("https://offboard.test/api/jobs/create-matchdays", { headers }));

  it.each([
    ["no credential", {}],
    ["the wrong secret", { authorization: "Bearer not-the-secret-at-all-000000" }],
    ["the secret without its Bearer prefix", { authorization: SECRET }],
    ["the secret with something added", { authorization: `Bearer ${SECRET}x` }],
  ])("refuses a request with %s, before reading anything", async (_, headers) => {
    const response = await call(headers);
    expect(response.status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
    expect(lichess.calls).toEqual([]);
  });

  it.each([
    ["unset", ""],
    ["shorter than 16 characters", "short-secret"],
  ])("refuses everything while CRON_SECRET is %s", async (_, secret) => {
    vi.stubEnv("CRON_SECRET", secret);
    expect((await call({ authorization: `Bearer ${secret}` })).status).toBe(401);
    expect((await call({ authorization: "Bearer undefined" })).status).toBe(401);
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("runs the job for Vercel's scheduled request, and answers what it did without the token", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: DUE });
    lichess.now = () => DUE.getTime();
    const response = await call({ authorization: `Bearer ${SECRET}`, "user-agent": "vercel-cron/1.0" });
    vi.useRealTimers();
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ outcome: "done", matchdayDate: DATE });
    expect(body).not.toContain(token);
    expect(creations()).toHaveLength(1);
  });

  it("answers 500 when the run failed", async () => {
    organiserLichess.clear();
    vi.useFakeTimers({ toFake: ["Date"], now: DUE });
    const response = await call({ authorization: `Bearer ${SECRET}` });
    vi.useRealTimers();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ outcome: "failed", matchdayDate: DATE });
  });
});
