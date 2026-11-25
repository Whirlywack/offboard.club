import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { doneSince, done, failed, failingJobs, recordFailure, runJob, skipped, workDone } from "./jobs";
import { deliverAlerts, deliverPosts, stuckPosts } from "./telegram";

// The private alerts' real SQL (#17) against the database in DATABASE_URL (migrations/011_backups_and_alerts.sql): when
// each job last did its work, which jobs are failing, a failure a run finds recorded once, and the alerts kept apart
// from the group's posts in "telegramPost". Inside one transaction that is always rolled back, so nothing it does is kept; inside it, it empties
// "scheduledJob", "jobFailure" and "telegramPost". Telegram is the fake. Runs only when ALLOW_DB_TESTS=1 is set as well
// as DATABASE_URL, and a plain `pnpm test` skips it. Run it against a local database from `pnpm db:start`, never a
// shared or live one, before seeding: ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/alerts.postgres.test.ts
vi.mock("@/lib/db", async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // Nothing the app sends may end the test's transaction.
  const query = (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|start|commit|end|rollback|abort)\b/i.test(sql)) throw new Error(`refused inside the test's transaction: ${sql}`);
    return client.query(sql, params);
  };
  return { db: { client, query } };
});

const TOKEN = "a-pretend-telegram-token";
const GROUP = "@pretend_group";
const CHAT = "123456789";
const NOW = new Date("2026-11-25T12:00:00Z");
const LATER = new Date("2099-11-29T18:00:00Z");

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the alerts' SQL in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;
  const telegram = createFakeTelegram({ token: TOKEN, chats: [GROUP, CHAT] });
  const select = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  const sent = () => telegram.posts.map((post) => `${post.chatId} ${post.text}`);

  beforeAll(async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("TELEGRAM_GROUP_ID", GROUP);
    vi.stubEnv("TELEGRAM_URL", "");
    vi.stubGlobal("fetch", telegram.fetch);
    await client.connect();
    await client.query("begin");
    await client.query(`delete from "jobFailure"`);
    await client.query(`delete from "scheduledJob"`);
    await client.query(`delete from "telegramPost"`);
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }, 30_000);

  it("counts when a job last did its work from its first run, and moves it on only when a run does", async () => {
    expect(await doneSince("a-job")).toBeNull();
    await runJob("a-job", async () => skipped("Nothing."));
    const first = await doneSince("a-job");
    expect(first).toBeInstanceOf(Date);
    // now() is the test's transaction's, the same for every statement in it, so the first is moved back to tell them apart.
    await client.query(`update "scheduledJob" set "lastDoneAt" = "lastDoneAt" - interval '3 days'`);
    const backdated = await doneSince("a-job");
    await runJob("a-job", async () => failed("It broke."));
    expect(await doneSince("a-job")).toEqual(backdated);
    await runJob("a-job", async () => done("Did it."));
    expect((await doneSince("a-job"))!.getTime()).toBeGreaterThan(backdated!.getTime());
    await runJob("another-job", async () => done("Did it."));
    await client.query(`update "scheduledJob" set "lastDoneAt" = '2026-01-01T00:00:00Z' where "job" = 'another-job'`);
    expect(await doneSince("another-job")).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect((await doneSince("a-job"))!.getTime()).toBeGreaterThan(backdated!.getTime());
  });

  it("moves when a job last did its work when the job says so in a run, for that job alone", async () => {
    await client.query(`update "scheduledJob" set "lastDoneAt" = '2026-01-01T00:00:00Z'`);
    await workDone("a-job");
    expect((await doneSince("a-job"))!.getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
    expect(await doneSince("another-job")).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("lists the jobs whose last run failed, with why and when that run ended, and no other", async () => {
    await runJob("failing", async () => failed("It broke."));
    await runJob("fixed", async () => failed("It broke too."));
    await runJob("fixed", async () => done("Fine now."));
    await runJob("idle", async () => skipped("Nothing."));
    await client.query(`insert into "scheduledJob" ("job") values ('never-finished')`);
    await client.query(`update "scheduledJob" set "lastRunAt" = '2026-02-02T02:00:00Z' where "job" = 'failing'`);
    expect(await failingJobs()).toEqual([{ job: "failing", detail: "It broke.", at: new Date("2026-02-02T02:00:00Z") }]);
  });

  it("records a failure a run finds once since it began: not again, but for another job, problem or beginning", async () => {
    await client.query(`delete from "jobFailure"`);
    // Each failure begins at the test's transaction's now(), after the first and before the second.
    const [before, after] = [new Date("2000-01-01T00:00:00Z"), LATER];
    for (const [job, problem, since] of [
      ["a-job", "It is lost.", before],
      ["a-job", "It is lost.", before],
      ["a-job", "Another is lost.", before],
      ["another-job", "It is lost.", before],
      ["a-job", "It is lost.", after],
    ] as const)
      await recordFailure(job, problem, since);
    expect(await select(`select "job", "problem", "matchdayDate" from "jobFailure" order by "id"`)).toEqual([
      { job: "a-job", problem: "It is lost.", matchdayDate: null },
      { job: "a-job", problem: "Another is lost.", matchdayDate: null },
      { job: "another-job", problem: "It is lost.", matchdayDate: null },
      { job: "a-job", problem: "It is lost.", matchdayDate: null },
    ]);
  });

  it("sends the group's posts to the group and the alerts to the Organiser, never one to the other, and reports only the group's as stuck", async () => {
    // A post made `minutesAgo`, and claimed `claimedMinutesAgo` by a delivery that never sent it.
    const add = (key: string, minutesAgo: number, claimedMinutesAgo: number | null = null) =>
      client.query(
        `insert into "telegramPost" ("key", "text", "until", "createdAt", "claimedAt") values ($1, $1, $2, now() - make_interval(mins => $3), $4)`,
        [key, LATER, minutesAgo, claimedMinutesAgo === null ? null : new Date(NOW.getTime() - claimedMinutesAgo * 60_000)],
      );
    await add("alert:older", 10);
    await add("recap:2026-11-29", 5);
    await add("alert:newer", 1);
    await add("alert:stuck", 20, 30);
    await add("alert:being-sent", 20, 10);
    // Claimed as long ago, and sent.
    const claimed = new Date(NOW.getTime() - 30 * 60_000);
    await client.query(`insert into "telegramPost" ("key", "text", "until", "claimedAt", "sentAt") values ('alert:sent', 'alert:sent', $1, $2, $2)`, [LATER, claimed]);
    expect(await deliverPosts(NOW)).toEqual({ posted: 1, failed: null });
    expect(sent()).toEqual([`${GROUP} recap:2026-11-29`]);
    expect(await stuckPosts(NOW)).toEqual([]);
    // The alert claimed half an hour ago and never sent is sent again, oldest first, and the one sent is not; the one
    // claimed ten minutes ago is left to the delivery that may still be sending it.
    expect(await deliverAlerts(CHAT, NOW)).toEqual({ posted: 3, failed: null });
    expect(sent()).toEqual([`${GROUP} recap:2026-11-29`, `${CHAT} alert:stuck`, `${CHAT} alert:older`, `${CHAT} alert:newer`]);
    expect(await select(`select "key" from "telegramPost" where "sentAt" is null order by "key"`)).toEqual([{ key: "alert:being-sent" }]);
    expect(await select(`select "claimedAt" from "telegramPost" where "key" = 'alert:sent'`)).toEqual([{ claimedAt: claimed }]);
    // A group post so claimed is never sent again, and is reported instead.
    await add("notice:stuck", 20, 30);
    expect(await deliverAlerts(CHAT, NOW)).toEqual({ posted: 0, failed: null });
    expect(await deliverPosts(NOW)).toEqual({ posted: 0, failed: null });
    expect((await stuckPosts(NOW)).map((post) => post.text)).toEqual(["notice:stuck"]);
  });
});
