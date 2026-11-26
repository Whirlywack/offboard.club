// The private alerts to the Organiser (#17), through the job that sends them (alertOrganiser, at a supplied time), the
// endpoint Vercel calls and the schedule it calls it on (vercel.json), and the jobs whose failures they report. Faked:
// Telegram (lib/fixtures/fake-telegram.ts), standing in for fetch, the database (lib/fake-db.ts) and the clock.
// Everything else is the app's own code.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cronRequest } from "@/app/api/jobs/alert-organiser/route";
import { GET as backupRequest } from "@/app/api/jobs/backup/route";
import { addPerson, jobFailures, organiserLichess, resetDb, scheduledJobs, seasons, telegramPosts } from "@/lib/fake-db";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { alertOrganiser, JOB } from "./alerts";
import { JOB as BACKUP } from "./backup";
import { JOB as COLLECT } from "./collect-results";
import { createUpcomingMatchday } from "./create-matchdays";
import { done, failed, runJob, skipped } from "./jobs";
import { postToTelegram } from "./post-to-telegram";
import { postNotice, queuePost } from "./telegram";

vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const TOKEN = "a-pretend-telegram-token";
const GROUP = "@pretend_group";
const CHAT = "123456789";
const SECRET = "a-cron-secret-of-forty-characters-123456";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SUNDAY = new Date("2026-11-29T18:00:00Z"); // 20:00 in Vilnius, a Matchday's start

const COULD_NOT = "Couldn't collect the results of Sunday 29 November: Lichess took more than 4 minutes. The site keeps trying until Sunday 6 December at 20:00. If it hasn't worked by then, run pnpm ingest PreTend1.";

let telegram: ReturnType<typeof createFakeTelegram>;

const dms = () => telegram.posts.filter((post) => post.chatId === CHAT).map((post) => post.text);
const toGroup = () => telegram.posts.filter((post) => post.chatId !== CHAT);
// What is said of a group post Telegram may have posted.
const lost = (text: string) => `It isn't known whether Telegram posted "${text}", so it won't be posted again. Check the group.`;

// One run of a job at `now`, ending as `ends` says, with the clock at `now`.
async function jobRun(job: string, now: Date, ends: ReturnType<typeof failed>) {
  vi.setSystemTime(now);
  return runJob(job, async () => ends);
}

async function alertAt(now: Date) {
  vi.setSystemTime(now);
  return alertOrganiser(now);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
  vi.stubEnv("TELEGRAM_GROUP_ID", GROUP);
  vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", CHAT);
  vi.stubEnv("TELEGRAM_URL", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
  vi.stubEnv("ORGANISER_USER_ID", "organiser");
  vi.stubEnv("LICHESS_TEAM_ID", "offboard-team");
  vi.stubEnv("CRON_SECRET", SECRET);
  telegram = createFakeTelegram({ token: TOKEN, chats: [GROUP, CHAT] });
  vi.stubGlobal("fetch", telegram.fetch);
  resetDb();
  addPerson("organiser");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a scheduled job's failure", () => {
  it("reaches the Organiser privately, in their own chat and never the group, in the words of the Organiser page", async () => {
    vi.stubEnv("LICHESS_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
    seasons.set(1, { number: 1, start: "2026-12-06" });
    const run = await createUpcomingMatchday(new Date("2026-12-01T10:07:00Z"));
    expect(run.outcome).toBe("failed");
    expect(await alertAt(new Date("2026-12-01T10:07:30Z"))).toEqual({ outcome: "done", detail: "Sent you an alert.", matchdayDate: null });
    expect(dms()).toEqual([`Creating Matchdays: ${run.detail}`]);
    expect(run.detail).toBe("Couldn't create the tournament for Sunday 6 December: Lichess isn't connected. Connect it on the Organiser page.");
    expect(toGroup()).toEqual([]);
  });

  it("is one alert, not one a run: Collecting results failing every five minutes of a Sunday evening sends one", async () => {
    for (let minutes = 5; minutes <= 6 * 60; minutes += 5) {
      const now = new Date(SUNDAY.getTime() + minutes * MINUTE);
      await jobRun(COLLECT, now, failed(COULD_NOT, "2026-11-29"));
      if (minutes % 60 === 10) await alertAt(now);
    }
    expect(dms()).toEqual([`Collecting results: ${COULD_NOT}`]);
  });

  it("is alerted again a day later though each failed run ends just after the alerts' run begins", async () => {
    const alerted: number[] = [];
    for (let hour = 0; hour <= 48; hour++) {
      await jobRun(COLLECT, new Date(SUNDAY.getTime() + hour * HOUR + 2000), failed(COULD_NOT));
      await alertAt(new Date(SUNDAY.getTime() + hour * HOUR));
      if (dms().length > alerted.length) alerted.push(hour);
    }
    expect(alerted).toEqual([0, 24, 48]);
  });

  it("is alerted again a day later while it stands, and at once when it changes", async () => {
    await jobRun(COLLECT, SUNDAY, failed(COULD_NOT));
    await alertAt(SUNDAY);
    await alertAt(new Date(SUNDAY.getTime() + 23 * HOUR));
    expect(dms()).toHaveLength(1);
    await alertAt(new Date(SUNDAY.getTime() + DAY));
    expect(dms()).toEqual([`Collecting results: ${COULD_NOT}`, `Collecting results: ${COULD_NOT}`]);
    await jobRun(COLLECT, new Date(SUNDAY.getTime() + DAY + HOUR), failed("Couldn't collect the results of Sunday 29 November: something else."));
    await alertAt(new Date(SUNDAY.getTime() + DAY + HOUR));
    expect(dms().at(-1)).toBe("Collecting results: Couldn't collect the results of Sunday 29 November: something else.");
    expect(dms()).toHaveLength(3);
  });

  it("is not alerted once the job has run without failing, before the alerts looked", async () => {
    await jobRun(COLLECT, SUNDAY, failed(COULD_NOT));
    await jobRun(COLLECT, new Date(SUNDAY.getTime() + 5 * MINUTE), skipped("The Recap of Sunday 29 November is public."));
    expect(await alertAt(new Date(SUNDAY.getTime() + 10 * MINUTE))).toMatchObject({ outcome: "skipped", detail: "Nothing to tell you." });
    expect(dms()).toEqual([]);
  });

  it("is not alerted when it is the alerts' own: a failure to send one", async () => {
    await jobRun(JOB, SUNDAY, failed("Couldn't send you an alert: Telegram refused it: Bad Request: chat not found. The next run tries again."));
    await alertAt(new Date(SUNDAY.getTime() + HOUR));
    expect(dms()).toEqual([]);
  });

  it("leaves out every secret setting and the database's address, and is at most 1,000 characters", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://neondb_owner:a-pretend-password@ep-pretend-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_pretendstore_a-pretend-blob-token");
    // Too short to be hidden: it would hide every "e".
    vi.stubEnv("LICHESS_TEAM_PASSWORD", "e");
    const said = `The job stopped: getaddrinfo ENOTFOUND ep-pretend-123456-pooler.eu-central-1.aws.neon.tech, user neondb_owner, ${TOKEN} ${SECRET} vercel_blob_rw_pretendstore_a-pretend-blob-token a-pretend-password.`;
    await jobRun(COLLECT, SUNDAY, failed(said));
    await alertAt(SUNDAY);
    expect(dms()).toEqual(["Collecting results: The job stopped: getaddrinfo ENOTFOUND [hidden], user [hidden], [hidden] [hidden] [hidden] [hidden]."]);
    await jobRun(COLLECT, SUNDAY, failed(`${"ą".repeat(5000)}.`));
    await alertAt(SUNDAY);
    expect([...dms()[1]]).toHaveLength(1000);
    expect(dms()[1].endsWith("ąąą…")).toBe(true);
  });

  it("leaves out the database's user name and password as an error says them, not as the address writes them", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://neon%2Bowner:a%2Fpretend%40password@ep-pretend-123456-pooler.eu-central-1.aws.neon.tech/neondb");
    await jobRun(COLLECT, SUNDAY, failed(`The job stopped: password authentication failed for user "neon+owner" with a/pretend@password.`));
    await alertAt(SUNDAY);
    expect(dms()).toEqual(['Collecting results: The job stopped: password authentication failed for user "[hidden]" with [hidden].']);
  });
});

describe("a post to the group Telegram may have posted", () => {
  const NOTICE = "No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00.";
  const ALERTED = `Posting to Telegram: ${lost(NOTICE)}`;
  const badGateway = (call: { params: Record<string, unknown> }) => (call.params.chat_id === GROUP ? new Response("Bad Gateway", { status: 502 }) : undefined);
  const at = (hours: number) => new Date(SUNDAY.getTime() + hours * HOUR);
  const postAt = async (now: Date) => {
    vi.setSystemTime(now);
    return postToTelegram(now);
  };
  // Posting to Telegram and the alerts each hour, in either order, for two days from `hours`; then a week, a month and
  // a year on.
  const later = async (hours: number) => {
    for (let hour = hours; hour <= hours + 48; hour++) {
      if (hour % 2) await postAt(at(hour));
      await alertAt(at(hour));
      if (!(hour % 2)) await postAt(at(hour));
    }
    for (const days of [7, 30, 365]) {
      await postAt(at(hours + days * 24));
      await alertAt(at(hours + days * 24));
    }
  };
  const failures = () => [...jobFailures.values()].map((f) => `${f.job} ${f.problem}`);
  // The notice is sent by the change that made it, and Telegram's answer does not say whether it was posted.
  const sentByTheChange = async () => {
    telegram.override = badGateway;
    vi.setSystemTime(at(0));
    await postNotice(at(0));
    telegram.override = undefined;
  };

  beforeEach(async () => {
    await queuePost({ key: "notice:a", text: NOTICE, until: new Date("2099-01-01T00:00:00Z") });
  });

  it("reaches the Organiser once, from the run that sent it and those after it, in one failure", async () => {
    telegram.override = badGateway;
    expect(await postAt(at(0))).toMatchObject({ outcome: "failed", detail: lost(NOTICE) });
    telegram.override = undefined;
    await later(0);
    expect(dms()).toEqual([ALERTED]);
    expect([...jobFailures.values()].map((f) => f.problem)).toEqual([lost(NOTICE)]);
  });

  it("reaches the Organiser once when it went out from elsewhere, as a change's notice does, in one failure", async () => {
    await sentByTheChange();
    await alertAt(new Date(at(0).getTime() + 14 * MINUTE));
    expect(dms()).toEqual([]);
    await later(1);
    expect(dms()).toEqual([ALERTED]);
    expect(failures()).toEqual([`post-to-telegram ${lost(NOTICE)}`]);
  });

  it("is one failure all the same when Posting to Telegram next runs more than a day after it was sent", async () => {
    await sentByTheChange();
    for (let hour = 1; hour <= 25; hour++) await alertAt(at(hour));
    await later(26);
    expect(dms()).toEqual([ALERTED]);
    expect(failures()).toEqual([`post-to-telegram ${lost(NOTICE)}`]);
  });

  it("is one failure all the same, but no alert, when Telegram was switched off for more than a day after it was sent", async () => {
    await sentByTheChange();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    for (let hour = 1; hour <= 25; hour++) {
      await postAt(at(hour));
      await alertAt(at(hour));
    }
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    await later(26);
    expect(dms()).toEqual([]);
    expect(failures()).toEqual([`post-to-telegram ${lost(NOTICE)}`]);
  });

  it("reaches the Organiser once though the run that sent it ended after the alerts' run began", async () => {
    telegramPosts.get("notice:a")!.claimedAt = new Date(at(0).getTime() + 500);
    await jobRun("post-to-telegram", new Date(at(0).getTime() + 1000), failed(lost(NOTICE)));
    await alertAt(at(0));
    expect(dms()).toEqual([ALERTED]);
    await postAt(at(0.5));
    for (const hours of [24, 25]) await alertAt(at(hours));
    expect(dms()).toEqual([ALERTED]);
  });
});

describe("the backup", () => {
  const lastDone = (hoursAgo: number) =>
    scheduledJobs.set(BACKUP, {
      job: BACKUP,
      lockedBy: null,
      lockedUntil: null,
      lastRunAt: new Date(SUNDAY.getTime() - HOUR),
      lastOutcome: "skipped",
      lastDetail: "Something.",
      lastDoneAt: new Date(SUNDAY.getTime() - hoursAgo * HOUR),
    });

  it("not made for two days, while backups are set up, is alerted once a day until one is", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_pretendstore_a-pretend-blob-token");
    lastDone(47);
    await alertAt(SUNDAY);
    expect(dms()).toEqual([]);
    lastDone(49);
    await alertAt(SUNDAY);
    await alertAt(new Date(SUNDAY.getTime() + HOUR));
    expect(dms()).toEqual(["Backing up: no backup of the database has been made since 27 November 2026."]);
    await alertAt(new Date(SUNDAY.getTime() + DAY));
    expect(dms()).toHaveLength(2);
    // A backup made puts it right.
    await jobRun(BACKUP, new Date(SUNDAY.getTime() + DAY + HOUR), done("Backed up the database (3 kB)."));
    await alertAt(new Date(SUNDAY.getTime() + 2 * DAY + 2 * HOUR));
    expect(dms()).toHaveLength(2);
  });

  it("is nothing to alert while backups aren't set up, nor before the job has ever run", async () => {
    lastDone(49);
    await alertAt(SUNDAY);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_pretendstore_a-pretend-blob-token");
    scheduledJobs.delete(BACKUP);
    await alertAt(new Date(SUNDAY.getTime() + HOUR));
    expect(dms()).toEqual([]);
  });

  it("is switched off by its endpoint without the store's token: skipped, not failed", async () => {
    const response = await backupRequest(new Request("https://offboard.test/api/jobs/backup", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "skipped", detail: "Backups are off: BLOB_READ_WRITE_TOKEN isn't set." });
    expect(scheduledJobs.get(BACKUP)?.lastOutcome).toBe("skipped");
  });
});

describe("the Organiser's Lichess permission", () => {
  const ENDS = new Date("2027-11-25T12:00:00Z");
  const after = (days: number) => new Date(ENDS.getTime() + days * DAY);

  it("is warned of 30 days before it ends and 7 days before, then said to have ended on the day, each once", async () => {
    organiserLichess.set("singleton", { userId: "organiser", lichessId: "boss", scopes: "tournament:write team:lead", token: "sealed", expiresAt: ENDS, connectedAt: new Date() });
    const warning = "Your Lichess permission expires on 25 November 2027. Connect Lichess again on the Organiser page before then.";
    for (const days of [-31, -30.5, -30, -29, -8, -7, -6, -1, 0, 0.5, 1, 2]) await alertAt(after(days));
    expect(dms()).toEqual([
      warning,
      warning,
      "Your Lichess permission expired on 25 November 2027, so Matchdays aren't being created. Connect Lichess again on the Organiser page.",
    ]);
    // From the day after, nothing is queued about it at all.
    expect([...telegramPosts.values()].filter((post) => post.sentAt === null)).toEqual([]);
  });

  it("is not warned of when it was the previous Organiser's", async () => {
    organiserLichess.set("singleton", { userId: "someone-else", lichessId: "boss", scopes: "tournament:write team:lead", token: "sealed", expiresAt: ENDS, connectedAt: new Date() });
    await alertAt(after(-7));
    expect(dms()).toEqual([]);
  });
});

describe("sending", () => {
  it("is off without the bot's token or the Organiser's own chat id, says which, and queues nothing", async () => {
    await jobRun(COLLECT, SUNDAY, failed(COULD_NOT));
    for (const [settings, detail] of [
      [{ TELEGRAM_ORGANISER_CHAT_ID: "" }, "Alerts are off: TELEGRAM_ORGANISER_CHAT_ID is missing or not in the form .env.example gives, so the bot can't message you."],
      // A group's id, which is negative: an alert goes to the Organiser alone.
      [{ TELEGRAM_ORGANISER_CHAT_ID: "-1001234567890" }, "Alerts are off: TELEGRAM_ORGANISER_CHAT_ID is missing or not in the form .env.example gives, so the bot can't message you."],
      [{ TELEGRAM_BOT_TOKEN: "" }, "Alerts are off: TELEGRAM_BOT_TOKEN is missing or not in the form .env.example gives, so the bot can't message you."],
      [{ TELEGRAM_BOT_TOKEN: "", TELEGRAM_ORGANISER_CHAT_ID: "" }, "Alerts are off: TELEGRAM_BOT_TOKEN and TELEGRAM_ORGANISER_CHAT_ID are missing or not in the form .env.example gives, so the bot can't message you."],
    ] as const) {
      for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
      expect(await alertAt(SUNDAY)).toEqual({ outcome: "skipped", detail, matchdayDate: null });
      vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
      vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", CHAT);
    }
    expect(telegram.calls).toEqual([]);
    expect([...telegramPosts.keys()]).toEqual([]);
  });

  it("tries a refused alert again at the next run, and sends again one Telegram may have taken without saying", async () => {
    await jobRun(COLLECT, SUNDAY, failed(COULD_NOT));
    telegram.override = () => Response.json({ ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }, { status: 403 });
    expect(await alertAt(SUNDAY)).toEqual({
      outcome: "failed",
      detail: "Couldn't send you an alert: Telegram refused it: Forbidden: bot can't initiate conversation with a user. The next run tries again.",
      matchdayDate: null,
    });
    telegram.override = undefined;
    await alertAt(new Date(SUNDAY.getTime() + HOUR));
    expect(dms()).toEqual([`Collecting results: ${COULD_NOT}`]);

    await jobRun(COLLECT, new Date(SUNDAY.getTime() + 2 * HOUR), failed("Couldn't collect the results of Sunday 29 November: another thing."));
    telegram.override = () => new Response("Bad Gateway", { status: 502 });
    expect((await alertAt(new Date(SUNDAY.getTime() + 2 * HOUR))).detail).toBe(
      `It isn't known whether Telegram sent you "Collecting results: Couldn't collect the results of Sunday 29 November: another thing." (Telegram answered 502 without saying), so it is sent again in an hour.`,
    );
    telegram.override = undefined;
    await alertAt(new Date(SUNDAY.getTime() + 3 * HOUR));
    await alertAt(new Date(SUNDAY.getTime() + 4 * HOUR));
    const tries = telegram.calls.filter((call) => String(call.params.text).endsWith("another thing."));
    expect(tries).toHaveLength(2);
    expect(dms().at(-1)).toBe("Collecting results: Couldn't collect the results of Sunday 29 November: another thing.");
  });

  it("sends an alert whose run died after claiming it, once 15 minutes have passed, and never sends a group post so claimed", async () => {
    await queuePost({ key: "alert:lost", text: "Your Lichess permission ended on 25 November 2027.", until: new Date(SUNDAY.getTime() + DAY) });
    await queuePost({ key: "recap:2026-11-29", text: "A Recap.", until: new Date(SUNDAY.getTime() + DAY) });
    // Claimed by a run that died before it sent them.
    for (const key of ["alert:lost", "recap:2026-11-29"]) telegramPosts.get(key)!.claimedAt = SUNDAY;
    await alertAt(new Date(SUNDAY.getTime() + 14 * MINUTE));
    expect(dms()).toEqual([]);
    await alertAt(new Date(SUNDAY.getTime() + 15 * MINUTE));
    // The group post is the Organiser's to look for.
    expect(dms()).toEqual(["Your Lichess permission ended on 25 November 2027.", `Posting to Telegram: ${lost("A Recap.")}`]);
    expect(telegramPosts.get("recap:2026-11-29")).toMatchObject({ claimedAt: SUNDAY, sentAt: null });
  });

  it("is never the group's: the group's posting sends no alert, and does not report one as stuck", async () => {
    await queuePost({ key: "alert:waiting", text: "An alert.", until: new Date(SUNDAY.getTime() + DAY) });
    await queuePost({ key: "alert:stuck", text: "A stuck alert.", until: new Date(SUNDAY.getTime() + DAY) });
    telegramPosts.get("alert:stuck")!.claimedAt = new Date(SUNDAY.getTime() - HOUR);
    expect(await postToTelegram(SUNDAY)).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(telegram.posts).toEqual([]);
    expect(telegramPosts.get("alert:waiting")?.claimedAt).toBeNull();
  });
});

describe("the schedule", () => {
  it("refuses anyone but Vercel's scheduled request, before anything is read", async () => {
    const response = await cronRequest(new Request("https://offboard.test/api/jobs/alert-organiser", { headers: { authorization: "Bearer wrong" } }));
    expect(response.status).toBe(401);
    expect(scheduledJobs.size).toBe(0);
    const backup = await backupRequest(new Request("https://offboard.test/api/jobs/backup"));
    expect(backup.status).toBe(401);
  });

  it("runs the alerts every hour with the other jobs, and the backup every night", () => {
    const { crons } = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(crons).toContainEqual({ path: "/api/jobs/alert-organiser", schedule: "7 * * * *" });
    expect(crons).toContainEqual({ path: "/api/jobs/backup", schedule: "7 1 * * *" });
  });
});
