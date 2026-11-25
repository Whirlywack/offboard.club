import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { doneSince, done, failed, failingJobs, runJob, skipped } from "./jobs";
import { deliverAlerts, deliverPosts, stuckPost } from "./telegram";

// The private alerts' real SQL (#17) against the database in DATABASE_URL (migrations/011_backups_and_alerts.sql): when
// each job last did its work, which jobs are failing, and the alerts kept apart from the group's posts in
// "telegramPost". Inside one transaction that is always rolled back, so nothing it does is kept; inside it, it empties
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

  it("lists the jobs whose last run failed, with why, and no other", async () => {
    await runJob("failing", async () => failed("It broke."));
    await runJob("fixed", async () => failed("It broke too."));
    await runJob("fixed", async () => done("Fine now."));
    await runJob("idle", async () => skipped("Nothing."));
    await client.query(`insert into "scheduledJob" ("job") values ('never-finished')`);
    expect(await failingJobs()).toEqual([{ job: "failing", detail: "It broke." }]);
  });

  it("sends the group's posts to the group and the alerts to the Organiser, never one to the other, and reports only the group's as stuck", async () => {
    const add = (key: string, minutesAgo: number, claimed = false) =>
      client.query(
        `insert into "telegramPost" ("key", "text", "until", "createdAt", "claimedAt") values ($1, $1, $2, now() - make_interval(mins => $3), $4)`,
        [key, LATER, minutesAgo, claimed ? new Date(NOW.getTime() - 30 * 60_000) : null],
      );
    await add("alert:older", 10);
    await add("recap:2026-11-29", 5);
    await add("alert:newer", 1);
    await add("alert:stuck", 20, true);
    expect(await deliverPosts(NOW)).toEqual({ posted: 1, failed: null });
    expect(sent()).toEqual([`${GROUP} recap:2026-11-29`]);
    expect(await stuckPost(NOW)).toBeNull();
    expect(await deliverAlerts(CHAT, NOW)).toEqual({ posted: 2, failed: null });
    expect(sent()).toEqual([`${GROUP} recap:2026-11-29`, `${CHAT} alert:older`, `${CHAT} alert:newer`]);
    expect(await select(`select "key" from "telegramPost" where "sentAt" is null order by "key"`)).toEqual([{ key: "alert:stuck" }]);
    await add("notice:stuck", 20, true);
    expect(await stuckPost(NOW)).toBe("notice:stuck");
  });
});
