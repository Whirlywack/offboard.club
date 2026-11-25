// The scheduled job that collects the latest Matchday's results, through its two entry points, the run itself
// (collectResults, at a supplied time) and the endpoint Vercel calls, and through the schedule Vercel calls it on
// (vercel.json). Faked: Lichess (lib/fixtures/fake-lichess.ts, standing in for fetch), the database (lib/fake-db.ts) and
// the timers, so that the seconds the job waits for Lichess pass at once. The Matchday's tournament is registered as
// Creating Matchdays leaves it; everything else is the app's own code.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cronRequest } from "@/app/api/jobs/collect-results/route";
import { addPerson, db, games, jobFailures, matchdays, people, resetDb, results, scheduledJobs } from "@/lib/fake-db";
import { createFakeLichess, type FakeSwiss } from "@/lib/fixtures/fake-lichess";
import { collectResults, JOB, SETTLE_MS } from "./collect-results";
import { lastFailure } from "./jobs";
import { getAllTime } from "./leaderboards";
import { getSwiss } from "./lichess";
import { registerTournament } from "./matchdays";
import { getRecap } from "./recaps";
import { matchdayStart } from "./schedule";

vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const TEAM = "offboard-team";
const SECRET = "a-cron-secret-of-forty-characters-123456";
const LOCAL_DATABASE = "postgres://offboard@127.0.0.1:55432/offboard_pretend";
const REAL_DATABASE = "postgres://someone:a-pretend-password@ep-pretend-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";

// The Matchday of Sunday 29 November 2026 starts at 20:00 Vilnius time, 18:00 UTC.
const DATE = "2026-11-29";
const START = matchdayStart(DATE);
const TOURNAMENT = "PreTend1";
const MINUTE = 60_000;
const after = (minutes: number) => new Date(START.getTime() + minutes * MINUTE);
const OVER = after(90); // 21:30 in Vilnius, once the tournament has finished

// A small Matchday as Lichess exports it. ana, ben and cora are Members; zed is on the Club's Lichess team, but not a
// Member. ana mated ben, zed beat cora on time, ben and cora drew.
const lines = (rows: object[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join("");
const standings = lines([
  { rank: 1, points: 4, tieBreak: 9, rating: 1610, username: "Lichess-ana" },
  { rank: 2, points: 3.5, tieBreak: 8, rating: 1720, username: "Lichess-zed" },
  { rank: 3, points: 2, tieBreak: 5, rating: 1530, username: "Lichess-ben" },
  { rank: 4, points: 0.5, tieBreak: 1, rating: 1440, username: "Lichess-cora" },
]);
const game = (id: string, white: string, black: string, winner: "white" | "black" | null, status: string, plies: number) => ({
  id,
  rated: true,
  status,
  lastMoveAt: after(70).getTime(),
  players: {
    white: { user: { name: `Lichess-${white}`, id: `lichess-${white}` }, rating: 1500 },
    black: { user: { name: `Lichess-${black}`, id: `lichess-${black}` }, rating: 1550 },
  },
  ...(winner && { winner }),
  moves: Array(plies).fill("Nf3").join(" "),
  clocks: Array(plies).fill(4200),
});
const exported = lines([
  game("Pretend01", "ana", "ben", "white", "mate", 31),
  game("Pretend02", "zed", "cora", "white", "outoftime", 60),
  game("Pretend03", "ben", "cora", null, "draw", 80),
]);

let lichess: ReturnType<typeof createFakeLichess>;
let tournament: FakeSwiss;
let logged: string[];

const requests = () => lichess.calls.map((c) => `${c.method} ${c.path}`);

// One run of the job at `now`; the seconds it waits for Lichess's final standings pass at once.
async function runAt(now: Date) {
  const run = collectResults(now);
  await vi.advanceTimersByTimeAsync(SETTLE_MS);
  return run;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.stubEnv("DATABASE_URL", LOCAL_DATABASE);
  vi.stubEnv("LICHESS_TEAM_ID", TEAM);
  vi.stubEnv("CRON_SECRET", SECRET);
  tournament = { id: TOURNAMENT, teamId: TEAM, status: "finished", startsAt: START.toISOString(), results: standings, games: exported };
  lichess = createFakeLichess({
    teamId: TEAM,
    teamPassword: "pw",
    accounts: ["ana", "ben", "cora", "zed"].map((id) => ({ id: `lichess-${id}`, username: `Lichess-${id}` })),
    tournaments: [tournament],
  });
  vi.stubGlobal("fetch", lichess.fetch);
  resetDb();
  for (const id of ["ana", "ben", "cora"]) addPerson(id, { name: `Member ${id}` });
  expect(await registerTournament(DATE, TOURNAMENT)).toBe(true);
  db.query.mockClear();
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("collecting the results of the Matchday just played", () => {
  it("ingests the tournament once it has finished, which makes its Recap public", async () => {
    expect(await getRecap(DATE)).toBeNull();
    const run = await runAt(OVER);
    expect(run).toEqual({
      outcome: "done",
      detail: `Collected the results of the Matchday of ${DATE}: 3 Members played, with 2 Games between them. Its Recap is public.`,
      matchdayDate: DATE,
    });
    expect(matchdays.get(DATE)).toEqual({ date: DATE, lichessTournamentId: TOURNAMENT, ingestedAt: expect.any(Date) });
    const recap = await getRecap(DATE);
    expect(recap?.leaderboard.map((row) => [row.rank, row.name, row.points])).toEqual([
      [1, "Member ana", 4],
      [2, "Member ben", 2],
      [3, "Member cora", 0.5],
    ]);
    expect(recap?.awards.map((award) => award.kind)).toEqual(["biggestUpset", "leastTimeLeft", "fastestCheckmate"]);
    expect(scheduledJobs.get(JOB)).toMatchObject({ lastOutcome: "done", lastDetail: run.detail, lockedBy: null });
    expect(jobFailures.size).toBe(0);
    // Without a token, as the site.
    expect(lichess.calls.every((c) => c.authorization === null && c.userAgent?.includes("offboard.club"))).toBe(true);
  });

  it("reads the standings no sooner than ten seconds after Lichess said the tournament had finished", async () => {
    const run = collectResults(OVER);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(requests()).toEqual([`GET /api/swiss/${TOURNAMENT}`]);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).outcome).toBe("done");
    expect(requests()).toEqual([
      `GET /api/swiss/${TOURNAMENT}`,
      `GET /api/swiss/${TOURNAMENT}`,
      `GET /api/team/${TEAM}/swiss`,
      `GET /api/swiss/${TOURNAMENT}/results`,
      `GET /api/swiss/${TOURNAMENT}/games`,
      "POST /api/users",
    ]);
  });

  it.each([
    ["is still being played", "started" as const],
    ["has not started, as Lichess waits for two players", "created" as const],
  ])("leaves a tournament that %s alone, and collects it on a later check", async (_, status) => {
    tournament.status = status;
    const early = await runAt(after(40));
    expect(early).toEqual({
      outcome: "skipped",
      detail: `Tournament ${TOURNAMENT}, the Matchday of ${DATE}, has not finished on Lichess yet; its results are collected once it has.`,
      matchdayDate: DATE,
    });
    expect(requests()).toEqual([`GET /api/swiss/${TOURNAMENT}`]);
    expect(matchdays.get(DATE)?.ingestedAt).toBeNull();
    expect(results.size + games.size).toBe(0);
    expect(jobFailures.size).toBe(0);

    tournament.status = "finished";
    expect((await runAt(after(45))).outcome).toBe("done");
    expect(results.size).toBe(3);
  });

  it("ingests it once: later runs leave it alone without asking Lichess", async () => {
    await runAt(OVER);
    const stored = structuredClone({ matchdays, results, games });
    lichess.calls.length = 0;
    for (const at of [after(95), after(24 * 60)])
      expect(await runAt(at)).toEqual({
        outcome: "skipped",
        detail: `The results of the Matchday of ${DATE} are in, and its Recap is public.`,
        matchdayDate: DATE,
      });
    expect(lichess.calls).toEqual([]);
    expect({ matchdays, results, games }).toEqual(stored);
  });

  it("ingests it once when two runs start at the same moment", async () => {
    const both = Promise.all([collectResults(OVER), collectResults(OVER)]);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    const runs = await both;
    expect(runs.map((r) => r.outcome).sort()).toEqual(["done", "skipped"]);
    expect(runs.find((r) => r.outcome === "skipped")?.detail).toBe("Another run of this job is still working, so this one did nothing.");
    expect(requests().filter((r) => r.endsWith("/results"))).toHaveLength(1);
    expect(results.size).toBe(3);
  });

  it("counts a Matchday however few Members took part", async () => {
    // Only ana is still a Member; ben and cora connected other Lichess accounts since.
    people.get("ben")!.lichessId = "lichess-ben-new";
    people.get("cora")!.lichessId = "lichess-cora-new";
    expect(await runAt(OVER)).toMatchObject({
      outcome: "done",
      detail: `Collected the results of the Matchday of ${DATE}: 1 Member played, with 0 Games between them. Its Recap is public.`,
    });
    expect((await getRecap(DATE))?.leaderboard.map((row) => [row.rank, row.name])).toEqual([[1, "Member ana"]]);
    expect((await getAllTime()).map((row) => [row.name, row.played])).toEqual([["Member ana", 1]]);
  });

  it("looks at nothing before the Matchday starts, and says so of a Sunday without a tournament", async () => {
    // A minute before 20:00 the latest Sunday is the one before, which had none.
    expect(await runAt(after(-1))).toEqual({
      outcome: "skipped",
      detail: "Sunday 2026-11-22 has no tournament on Lichess, so there are no results to collect.",
      matchdayDate: "2026-11-22",
    });
    expect(lichess.calls).toEqual([]);
    expect(matchdays.get(DATE)?.ingestedAt).toBeNull();
  });

  it("looks after a Matchday until the next Sunday's starts, and then only the next one", async () => {
    tournament.status = "started"; // as if Lichess never finished it
    expect((await runAt(after(7 * 24 * 60 - 1))).matchdayDate).toBe(DATE);
    lichess.calls.length = 0;
    expect(await runAt(after(7 * 24 * 60))).toMatchObject({ outcome: "skipped", matchdayDate: "2026-12-06" });
    expect(lichess.calls).toEqual([]);
  });
});

describe("a failure to collect", () => {
  const cannot = (why: string) => ({ outcome: "failed", detail: `The results of the Matchday of ${DATE} could not be collected: ${why}`, matchdayDate: DATE });

  it("is recorded for the Organiser, stores nothing, and is retried on the next check", async () => {
    lichess.override = (call) => (call.path.endsWith("/games") ? Response.json({ error: "Oops" }, { status: 500 }) : undefined);
    const first = await runAt(OVER);
    expect(first).toEqual(cannot("Lichess answered GET /api/swiss/{id}/games with 500: Oops."));
    expect(await lastFailure()).toEqual({ job: JOB, at: expect.any(Date), matchdayDate: DATE, problem: first.detail });
    expect(matchdays.get(DATE)?.ingestedAt).toBeNull();
    expect(results.size + games.size).toBe(0);

    // Still failing: one failure, not one a run.
    expect(await runAt(after(95))).toEqual(first);
    expect(jobFailures.size).toBe(1);

    lichess.override = undefined;
    expect((await runAt(after(100))).outcome).toBe("done");
    expect(results.size).toBe(3);
    expect(scheduledJobs.get(JOB)?.lastOutcome).toBe("done");
  });

  it("says why when Lichess no longer has the tournament", async () => {
    lichess.tournaments.clear();
    expect(await runAt(OVER)).toEqual(
      cannot(`Lichess has no tournament ${TOURNAMENT}. Lichess deletes a tournament that fewer than two players joined an hour after its start.`),
    );
    expect(jobFailures.size).toBe(1);
  });

  it("passes on why ingestion refused the tournament", async () => {
    for (const id of ["ana", "ben", "cora"]) people.get(id)!.lichessId = `lichess-${id}-new`;
    expect(await runAt(OVER)).toEqual(cannot(`None of the 4 participants of tournament ${TOURNAMENT} is a Member.`));
    expect(matchdays.get(DATE)?.ingestedAt).toBeNull();
  });

  // Lichess answers the requests in turn, each after so many seconds, with a 429 where marked, after which the client
  // waits a minute and asks again: 118 s for [29, 429], [29]. Every attempt is within the client's own 30 s, and the
  // Games export within its 300 s, so only the run's own limit stops it at 240 s, wherever it has got to.
  const slow: [string, ([seconds: number] | [seconds: number, status: 429])[], number?][] = [
    ["behind two of the site's other requests to Lichess", [[29, 429], [29], [29, 429], [29], [29]], 2],
    ["asking whether the tournament has finished", [[29, 429], [29], [29, 429], [29]]],
    ["asking for the team's tournaments", [[29, 429], [29], [29], [29, 429], [29]]],
    ["asking for the standings", [[29, 429], [29], [29], [29], [29, 429], [29]]],
    ["downloading the Games", [[29, 429], [29], [29], [29], [29], [200]]],
    ["asking for the Members' accounts", [[29, 429], [29], [29], [29], [29], [20], [29]]],
  ];
  it.each(slow)("is recorded at 240 s, within the 300 s Vercel gives the run, when Lichess is slow %s", async (_, answers, others = 0) => {
    let n = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const [seconds, status] = answers[n++] ?? [0];
      await new Promise((resolve, reject) => {
        setTimeout(resolve, seconds * 1000);
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
      return status === 429 ? new Response(null, { status }) : lichess.fetch(input, init);
    });
    for (let i = 0; i < others; i++) void getSwiss("Other123").catch(() => {});
    const started = Date.now();
    let finished = 0;
    const run = collectResults(OVER).finally(() => (finished = Date.now()));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await run).toEqual(cannot("Lichess took more than 240 s."));
    expect(finished - started).toBe(240_000);
    expect(results.size + games.size).toBe(0);
    expect(jobFailures.size).toBe(1);
  });
});

describe("the endpoint Vercel calls", () => {
  const call = (headers: Record<string, string> = {}) =>
    cronRequest(new Request("https://offboard.test/api/jobs/collect-results", { headers }));
  const fromVercel = { authorization: `Bearer ${SECRET}`, "user-agent": "vercel-cron/1.0" };

  it.each([
    ["no credential", {}],
    ["the wrong secret", { authorization: "Bearer not-the-secret-at-all-000000" }],
  ])("refuses a request with %s, before reading anything", async (_, headers) => {
    expect((await call(headers)).status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
    expect(lichess.calls).toEqual([]);
  });

  it("refuses to collect while the site follows a fake Lichess, before reading anything", async () => {
    const response = await call(fromVercel);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      outcome: "failed",
      detail: "The site follows LICHESS_URL to a fake Lichess, so it collects no results here. Locally, run pnpm collect-results.",
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(lichess.calls).toEqual([]);
  });

  it("in production collects from lichess.org, whatever LICHESS_URL says, and answers what it did", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", REAL_DATABASE);
    const asked: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(new URL(String(input)).origin);
      return lichess.fetch(input, init);
    });
    vi.setSystemTime(OVER);
    const response = call(fromVercel);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect((await response).status).toBe(200);
    expect(await (await response).json()).toMatchObject({ outcome: "done", matchdayDate: DATE });
    expect(new Set(asked)).toEqual(new Set(["https://lichess.org"]));
    expect(results.size).toBe(3);
  });

  it("answers 500 when the run failed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    lichess.tournaments.clear();
    vi.setSystemTime(OVER);
    const response = await call(fromVercel);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ outcome: "failed", matchdayDate: DATE });
  });
});

describe("the schedule Vercel runs it on (vercel.json)", () => {
  const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")).crons;
  const schedules = crons.filter((c) => c.path === "/api/jobs/collect-results").map((c) => c.schedule);

  // Whether a cron field ("*", "7", "17-23", "*/5", lists of them) takes `value`. Vercel reads its expressions in UTC.
  const takes = (field: string, value: number) =>
    field.split(",").some((part) => {
      const [range, step = "1"] = part.split("/");
      const [low, high] = range === "*" ? [0, Infinity] : range.split("-").map(Number).concat(range.includes("-") ? [] : [Number(range)]);
      return value >= low && value <= high && (value - (range === "*" ? 0 : low)) % Number(step) === 0;
    });
  const runsAt = (at: Date) =>
    schedules.some((schedule) => {
      const [minute, hour, day, month, weekday] = schedule.split(" ");
      return (
        takes(minute, at.getUTCMinutes()) &&
        takes(hour, at.getUTCHours()) &&
        takes(day, at.getUTCDate()) &&
        takes(month, at.getUTCMonth() + 1) &&
        takes(weekday, at.getUTCDay())
      );
    });
  // The first run at or after `at`, to the minute.
  const nextRun = (at: Date) => {
    let minute = Math.ceil(at.getTime() / MINUTE) * MINUTE;
    while (!runsAt(new Date(minute))) minute += MINUTE;
    return new Date(minute);
  };

  it.each([
    ["in winter time", "2026-11-29"],
    ["in summer time", "2027-06-27"],
    ["on the Sunday summer time begins", "2027-03-28"],
    ["on the Sunday summer time ends", "2027-10-31"],
  ])("has the Recap out within fifteen minutes of the last Game, however long the Matchday lasts, %s", (_, date) => {
    for (let minutes = 30; minutes <= 4 * 60; minutes++) {
      const lastGame = new Date(matchdayStart(date).getTime() + minutes * MINUTE);
      expect(nextRun(lastGame).getTime() + SETTLE_MS - lastGame.getTime()).toBeLessThanOrEqual(15 * MINUTE);
    }
  });

  it("checks again at least once an hour all week, to retry what failed", () => {
    for (let at = Date.parse("2026-11-30T00:00:00Z"); at < Date.parse("2026-12-07T00:00:00Z"); at += 17 * MINUTE)
      expect(nextRun(new Date(at)).getTime() - at).toBeLessThanOrEqual(60 * MINUTE);
  });
});
