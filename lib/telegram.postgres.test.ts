import { readFileSync } from "node:fs";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { postgresStore } from "./seasons";
import { deliverPosts, forgetPastPosts, queuePost } from "./telegram";

// The Telegram posts' real SQL against the database in DATABASE_URL (migrations/008_telegram.sql), inside one
// transaction that is always rolled back, so nothing it does is kept; Telegram is the fake. The migration is applied
// inside that transaction if the database does not have it yet. Inside it, it empties "telegramPost", "season" and
// "skippedSunday", so it runs only when ALLOW_DB_TESTS=1 is set as well as DATABASE_URL, and a plain `pnpm test` skips
// it. Run it against a local database from `pnpm db:start`, never a shared or live one, before seeding (once that one
// is seeded, a second from `pnpm db:start --dir .local-db-tests`), with that database's address:
// ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/telegram.postgres.test.ts
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
const NOW = new Date("2026-11-25T12:00:00Z");
const LATER = new Date("2026-11-29T18:00:00Z");

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the Telegram posts in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;
  const store = postgresStore(client);
  const telegram = createFakeTelegram({ token: TOKEN, chats: [GROUP] });
  const select = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  const posts = () => select(`select "key", "text", "claimedAt" is not null as "claimed", "sentAt" is not null as "sent" from "telegramPost" order by "createdAt", "key"`);
  const texts = async () => (await posts()).map((row) => row.text);
  const notice = (text: string) => ({ text, until: LATER });

  beforeAll(async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("TELEGRAM_GROUP_ID", GROUP);
    vi.stubEnv("TELEGRAM_URL", "");
    vi.stubGlobal("fetch", telegram.fetch);
    if (!("client" in db)) throw new Error("the database must be the test's own transaction");
    await client.connect();
    await client.query("begin");
    const [{ applied }] = await select(`select to_regclass('"telegramPost"') is not null as applied`);
    if (!applied) await client.query(readFileSync(new URL("../migrations/008_telegram.sql", import.meta.url), "utf8"));
    await client.query(`delete from "telegramPost"`);
    await client.query(`delete from "season"`);
    await client.query(`delete from "skippedSunday"`);
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

  it("queues a change's notice in the statement that makes it, and only when it changes something", async () => {
    await store.setSkipped("2026-12-06", true, notice("skipped"));
    await store.setSkipped("2026-12-06", true, notice("skipped again"));
    await store.setSkipped("2026-12-06", false, notice("back"));
    await store.setSkipped("2026-12-06", false, notice("back again"));
    await store.addSeason({ number: 1, start: "2026-11-29" }, notice("season 1"));
    await store.addSeason({ number: 1, start: "2026-12-06" }, notice("season 1, racing"));
    await store.setStart({ number: 2, start: "2027-01-24" }, notice("season 2"));
    await store.setStart({ number: 2, start: "2027-01-24" }, notice("season 2, the same start"));
    await store.setStart({ number: 2, start: "2027-01-31" }, notice("season 2, moved"));
    // A change Telegram is not told of is still made.
    await store.setSkipped("2026-12-13", true, null);
    expect((await texts()).sort()).toEqual(["back", "season 1", "season 2", "season 2, moved", "skipped"]);
    expect(await store.seasons()).toEqual(expect.arrayContaining([{ number: 1, start: "2026-11-29" }, { number: 2, start: "2027-01-31" }]));
    expect(await store.skippedSundays()).toEqual(["2026-12-13"]);
    const [{ keys }] = await select(`select count(distinct "key")::int as keys from "telegramPost"`);
    expect(keys).toBe(5);
    await client.query(`delete from "telegramPost"`);
  });

  it("queues a post once by its key", async () => {
    await queuePost({ key: "recap:2026-11-29", text: "first", until: LATER });
    await queuePost({ key: "recap:2026-11-29", text: "second", until: LATER });
    expect(await texts()).toEqual(["first"]);
    await client.query(`delete from "telegramPost"`);
  });

  it("sends the oldest first, each once, none past its until, and gives back one Telegram refused", async () => {
    const add = (key: string, until: Date, minutesAgo: number) =>
      client.query(`insert into "telegramPost" ("key", "text", "until", "createdAt") values ($1, $1, $2, now() - make_interval(mins => $3))`, [
        key,
        until,
        minutesAgo,
      ]);
    await add("newer", LATER, 1);
    await add("older", LATER, 5);
    await add("past", NOW, 10); // its until is now: no longer worth posting
    telegram.override = (call) => (call.params.text === "newer" ? Response.json({ ok: false, error_code: 500, description: "Oops" }, { status: 500 }) : undefined);
    expect(await deliverPosts(NOW)).toEqual({ posted: 1, failed: { text: "newer", problem: "Telegram refused it: Oops", perhaps: false } });
    expect(telegram.posts.map((p) => p.text)).toEqual(["older"]);
    expect(await posts()).toEqual([
      { key: "past", text: "past", claimed: false, sent: false },
      { key: "older", text: "older", claimed: true, sent: true },
      { key: "newer", text: "newer", claimed: false, sent: false }, // given back
    ]);
    telegram.override = undefined;
    expect(await deliverPosts(NOW)).toEqual({ posted: 1, failed: null });
    expect(await deliverPosts(NOW)).toEqual({ posted: 0, failed: null });
    expect(telegram.posts.map((p) => p.text)).toEqual(["older", "newer"]);
  });

  it("keeps one it may have posted claimed, so that it is never sent again", async () => {
    await client.query(`delete from "telegramPost"`);
    await queuePost({ key: "maybe", text: "maybe", until: LATER });
    telegram.override = () => new Response("Bad Gateway", { status: 502 });
    expect((await deliverPosts(NOW)).failed?.perhaps).toBe(true);
    telegram.override = undefined;
    expect(await deliverPosts(NOW)).toEqual({ posted: 0, failed: null });
    expect(await posts()).toEqual([{ key: "maybe", text: "maybe", claimed: true, sent: false }]);
    // A post cannot be sent without being claimed.
    await client.query("savepoint unclaimed");
    await expect(client.query(`insert into "telegramPost" ("key", "text", "until", "sentAt") values ('x', 'x', now(), now())`)).rejects.toThrow(/check constraint/);
    await client.query("rollback to savepoint unclaimed");
  });

  it("forgets the posts whose until has passed, and no other", async () => {
    await client.query(`delete from "telegramPost"`);
    await queuePost({ key: "due now", text: "a", until: NOW });
    await queuePost({ key: "due later", text: "b", until: LATER });
    await forgetPastPosts(NOW);
    expect((await posts()).map((row) => row.key)).toEqual(["due later"]);
  });
});
