import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { skipMatchday } from "./reschedule";
import { postgresStore } from "./seasons";
import { deliverPosts, forgetPastPosts, forgetReminders, postNotice, queuePost, stuckPosts } from "./telegram";

// The Telegram posts' real SQL against the database in DATABASE_URL (migrations/008_telegram.sql), inside one
// transaction that is always rolled back, so nothing it does is kept; Telegram is the fake. The migration is applied
// inside that transaction if the database does not have it yet. Inside it, it empties "telegramPost", "season" and
// "skippedSunday". One case needs two connections of its own, outside that transaction, which see each other's
// statements: it adds two posts of its own, committed, and deletes them again whatever happens, as well as any a run of
// it that was killed left behind (their keys start "race "). So it runs only when
// ALLOW_DB_TESTS=1 is set as well as DATABASE_URL, and a plain `pnpm test` skips it. Run it against a local database
// from `pnpm db:start`, never a shared or live one, before seeding (once that one is seeded, another from
// `pnpm db:start --dir <new folder>`), with that database's address:
// ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/telegram.postgres.test.ts
vi.mock("@/lib/db", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // The connection the app's statements go to: the test's transaction, unless a case runs them on one of its own.
  const on = new AsyncLocalStorage<pg.Client>();
  // What a case does just before each statement the app sends; and the app's own transactions' starts and ends, in order.
  const hooks = { before: async (sql: string) => void sql };
  const events: string[] = [];
  // Nothing the app sends may end the test's transaction.
  const query = async (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|start|commit|end|rollback|abort)\b/i.test(sql)) throw new Error(`refused inside the test's transaction: ${sql}`);
    await hooks.before(sql.replace(/\s+/g, " ").trim());
    return (on.getStore() ?? client).query(sql, params);
  };
  // The app's own transaction (lib/transaction.ts) is a savepoint within the test's.
  const inner: Record<string, string> = { begin: "savepoint change", commit: "release savepoint change", rollback: "rollback to savepoint change" };
  const connect = async () => ({
    query: (sql: string, params?: unknown[]) => (Object.hasOwn(inner, sql) ? (events.push(sql), client.query(inner[sql])) : query(sql, params)),
    release: () => {},
  });
  return { db: { client, query, connect, on, hooks, events } };
});

const TOKEN = "a-pretend-telegram-token";
const GROUP = "@pretend_group";
const NOW = new Date("2026-11-25T12:00:00Z");
const LATER = new Date("2099-11-29T18:00:00Z");
const MINUTE = 60_000;

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the Telegram posts in Postgres", () => {
  const { client, on, hooks, events } = db as unknown as {
    client: pg.Client;
    on: AsyncLocalStorage<pg.Client>;
    hooks: { before: (sql: string) => Promise<void> };
    events: string[];
  };
  const store = postgresStore(client);
  const telegram = createFakeTelegram({ token: TOKEN, chats: [GROUP] });
  const select = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  const posts = () => select(`select "key", "text", "claimedAt" is not null as "claimed", "sentAt" is not null as "sent" from "telegramPost" order by "createdAt", "key"`);
  const texts = async () => (await posts()).map((row) => row.text);
  const notice = (text: string) => ({ text, until: LATER });
  const add = (key: string, { minutesAgo = 0, claimedMinutesAgo = null as number | null, sent = false, until = LATER } = {}) =>
    client.query(
      `insert into "telegramPost" ("key", "text", "until", "createdAt", "claimedAt", "sentAt")
       values ($1, $1, $2, now() - make_interval(mins => $3), $4, case when $5 then now() end)`,
      [key, until, minutesAgo, claimedMinutesAgo === null ? null : new Date(NOW.getTime() - claimedMinutesAgo * MINUTE), sent],
    );

  beforeAll(async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("TELEGRAM_GROUP_ID", GROUP);
    vi.stubEnv("TELEGRAM_URL", "");
    vi.stubGlobal("fetch", telegram.fetch);
    if (!("client" in db)) throw new Error("the database must be the test's own transaction");
    await client.connect();
    const [{ applied }] = await select(`select to_regclass('"telegramPost"') is not null as applied`);
    // Before the transaction, so that it holds no lock on them: the posts a killed run of the race below left.
    if (applied) await client.query(`delete from "telegramPost" where "key" like 'race %'`);
    await client.query("begin");
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

  it("queues a change's notice in the statement that makes it, and only when it changes something, which it says", async () => {
    expect(await store.setSkipped("2026-12-06", true, notice("skipped"))).toBe(true);
    expect(await store.setSkipped("2026-12-06", true, notice("skipped again"))).toBe(false);
    expect(await store.setSkipped("2026-12-06", false, notice("back"))).toBe(true);
    expect(await store.setSkipped("2026-12-06", false, notice("back again"))).toBe(false);
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
    const [{ keys, notices }] = await select(`select count(distinct "key")::int as keys, count(*) filter (where "key" like 'notice:%')::int as notices from "telegramPost"`);
    expect([keys, notices]).toEqual([5, 5]);
    await client.query(`delete from "telegramPost"`);
    await client.query(`delete from "skippedSunday"`);
  });

  it("takes back the reminders waiting but the next Matchday's, or all of them, and only those not claimed", async () => {
    await add("reminder:2026-12-06:10");
    await add("reminder:2026-12-06:19", { claimedMinutesAgo: 1 }); // being sent
    await add("reminder:2026-12-13:10");
    await add("recap:2026-12-06");
    await forgetReminders("reminder:2026-12-13:");
    expect((await posts()).map((row) => row.key).sort()).toEqual(["recap:2026-12-06", "reminder:2026-12-06:19", "reminder:2026-12-13:10"]);
    await forgetReminders(null);
    expect((await posts()).map((row) => row.key).sort()).toEqual(["recap:2026-12-06", "reminder:2026-12-06:19"]);
    await client.query(`delete from "telegramPost"`);
  });

  describe("a change from the Organiser page (lib/reschedule.ts)", () => {
    // Season 1 from Sunday 13 December; its second Matchday, 20 December, has a tournament, which skipping it strands.
    beforeAll(async () => {
      for (const table of ["telegramPost", "season", "skippedSunday", "tournamentCancellation"]) await client.query(`delete from "${table}"`);
      await client.query(`insert into "season" ("number", "start") values (1, '2026-12-13')`);
      await client.query(`insert into "matchday" ("date", "lichessTournamentId") values ('2026-12-20', 'PgTele01')`);
    });

    afterAll(async () => {
      for (const table of ["telegramPost", "season", "skippedSunday", "tournamentCancellation", "matchday"]) await client.query(`delete from "${table}"`);
    });

    it("keeps neither the change nor its notice if the change's transaction fails, sends nothing and takes back no reminder", async () => {
      await add("reminder:2026-12-20:10");
      const before = telegram.calls.length;
      hooks.before = async (sql) => {
        if (sql.startsWith('insert into "tournamentCancellation"')) throw new Error("Connection terminated unexpectedly");
      };
      try {
        await expect(skipMatchday("2026-12-20", NOW)).rejects.toThrow("Connection terminated unexpectedly");
      } finally {
        hooks.before = async () => {};
      }
      expect(await select(`select "date" from "skippedSunday"`)).toEqual([]);
      expect((await posts()).map((row) => row.key)).toEqual(["reminder:2026-12-20:10"]);
      expect(telegram.calls.length).toBe(before);
      await client.query(`delete from "telegramPost"`);
    });

    it("queues the notice with the change, and posts it once the change is saved, not inside its transaction", async () => {
      events.length = 0;
      const before = telegram.posts.length;
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        events.push("posted to Telegram");
        return telegram.fetch(input, init);
      });
      try {
        expect(await skipMatchday("2026-12-20", NOW)).toMatchObject({ text: expect.stringMatching(/^Sunday 20 December is skipped/) });
      } finally {
        vi.stubGlobal("fetch", telegram.fetch);
      }
      expect(events).toEqual(["begin", "commit", "posted to Telegram"]);
      expect(telegram.posts.slice(before).map((p) => p.text)).toEqual(["No Matchday on Sunday 20 December. The next one is on Sunday 27 December at 20:00."]);
      expect(await select(`select to_char("date", 'YYYY-MM-DD') as "date" from "skippedSunday"`)).toEqual([{ date: "2026-12-20" }]);
    });
  });

  it("queues a post once by its key, taking the new text until a delivery claims it", async () => {
    await queuePost({ key: "recap:2026-11-29", text: "first", until: LATER });
    await queuePost({ key: "recap:2026-11-29", text: "second", until: LATER });
    expect(await texts()).toEqual(["second"]);
    await client.query(`update "telegramPost" set "claimedAt" = now()`);
    await queuePost({ key: "recap:2026-11-29", text: "third", until: LATER });
    expect(await texts()).toEqual(["second"]);
    await client.query(`delete from "telegramPost"`);
  });

  it("sends the oldest first, each once, none past its until, and gives back one Telegram refused", async () => {
    const sent = (before = telegram.posts.length) => () => telegram.posts.slice(before).map((p) => p.text);
    const since = sent();
    await add("newer", { minutesAgo: 1 });
    await add("older", { minutesAgo: 5 });
    await add("past", { minutesAgo: 10, until: NOW }); // its until is now: no longer worth posting
    telegram.override = (call) => (call.params.text === "newer" ? Response.json({ ok: false, error_code: 500, description: "Oops" }, { status: 500 }) : undefined);
    expect(await deliverPosts(NOW)).toEqual({ posted: 1, failed: { text: "newer", problem: "Telegram refused it: Oops", perhaps: false } });
    expect(since()).toEqual(["older"]);
    expect(await posts()).toEqual([
      { key: "past", text: "past", claimed: false, sent: false },
      { key: "older", text: "older", claimed: true, sent: true },
      { key: "newer", text: "newer", claimed: false, sent: false }, // given back
    ]);
    telegram.override = undefined;
    expect(await deliverPosts(NOW)).toEqual({ posted: 1, failed: null });
    expect(await deliverPosts(NOW)).toEqual({ posted: 0, failed: null });
    expect(since()).toEqual(["older", "newer"]);
  });

  it("sends a change's notice alone, the oldest waiting, and nothing else", async () => {
    await client.query(`delete from "telegramPost"`);
    await add("recap:2026-11-29", { minutesAgo: 9 });
    await add("notice:a", { minutesAgo: 5 });
    await add("notice:b", { minutesAgo: 1 });
    const before = telegram.posts.length;
    await postNotice(NOW);
    expect(telegram.posts.slice(before).map((p) => p.text)).toEqual(["notice:a"]);
  });

  it("keeps one it may have posted claimed, so that it is never sent again, and reports it after 15 minutes", async () => {
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

  it("finds the posts claimed more than 15 minutes ago, and after a time when given one, never sent, oldest first, and no other", async () => {
    await client.query(`delete from "telegramPost"`);
    const claimed = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MINUTE);
    await add("sent long ago", { claimedMinutesAgo: 30, sent: true });
    await add("stuck", { claimedMinutesAgo: 20 });
    await add("stuck all day", { claimedMinutesAgo: 24 * 60 - 1 });
    await add("a day ago", { claimedMinutesAgo: 24 * 60 });
    await add("being sent", { claimedMinutesAgo: 15 - 1 / 60 });
    await add("waiting");
    const day = [
      { text: "stuck all day", claimedAt: claimed(24 * 60 - 1) },
      { text: "stuck", claimedAt: claimed(20) },
    ];
    expect(await stuckPosts(NOW, claimed(24 * 60))).toEqual(day);
    expect(await stuckPosts(NOW, null)).toEqual([{ text: "a day ago", claimedAt: claimed(24 * 60) }, ...day]);
  });

  it("forgets the posts whose until has passed, and no other", async () => {
    await client.query(`delete from "telegramPost"`);
    await queuePost({ key: "due now", text: "a", until: NOW });
    await queuePost({ key: "due later", text: "b", until: LATER });
    await forgetPastPosts(NOW);
    expect((await posts()).map((row) => row.key)).toEqual(["due later"]);
  });

  // Two deliveries at once, each on its own connection: one claims a post and holds the claim, in a transaction, while
  // the other claims. The other must skip the post being claimed, not wait for it and then send it a second time.
  it("lets two deliveries at once send different posts, each once", async () => {
    const tag = randomBytes(6).toString("hex");
    const keys = [`race ${tag} 1`, `race ${tag} 2`];
    const [holder, other] = [0, 1].map(() => new pg.Client({ connectionString: process.env.DATABASE_URL }));
    await Promise.all([holder.connect(), other.connect()]);
    const before = telegram.posts.length;
    try {
      // Committed, so that both connections see them.
      for (const [i, key] of keys.entries())
        await other.query(`insert into "telegramPost" ("key", "text", "until", "createdAt") values ($1, $1, $2, now() - make_interval(mins => $3))`, [key, LATER, 10 - i]);
      let claimed!: () => void;
      const holderClaimed = new Promise<void>((resolve) => (claimed = resolve));
      let fetched!: () => void;
      const otherFetched = new Promise<void>((resolve) => (fetched = resolve));
      let first = true;
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        if (first) {
          // The holder has claimed: it waits to send until the other has claimed too, or 3 s have passed.
          first = false;
          claimed();
          await Promise.race([otherFetched, new Promise((resolve) => setTimeout(resolve, 3000))]);
        } else fetched();
        return telegram.fetch(input, init);
      });
      await holder.query("begin");
      const holding = on.run(holder, () => deliverPosts(NOW)).then(async (delivery) => {
        await holder.query("commit");
        return delivery;
      });
      await holderClaimed;
      const deliveries = await Promise.all([holding, on.run(other, () => deliverPosts(NOW))]);
      expect(deliveries).toEqual([
        { posted: 1, failed: null },
        { posted: 1, failed: null },
      ]);
      expect(telegram.posts.slice(before).map((p) => p.text).sort()).toEqual(keys);
    } finally {
      vi.stubGlobal("fetch", telegram.fetch);
      await holder.query("rollback").catch(() => {});
      await other.query(`delete from "telegramPost" where "key" = any($1)`, [keys]);
      await Promise.all([holder.end(), other.end()]);
    }
  }, 30_000);

  // Two skips of one Sunday at the same moment, each in its own transaction on its own connection, as two requests
  // from the Organiser page are: the second waits for the first, then finds the Sunday skipped, and queues no notice.
  // The Sunday is one no other suite uses; the case commits it, and deletes it and its notice whatever happens.
  it("lets one of two skips at once change the Sunday and queue its notice, and tells the other it changed nothing", async () => {
    const date = "2098-11-30";
    const tag = `two skips ${randomBytes(6).toString("hex")}`;
    const [first, second] = [0, 1].map(() => new pg.Client({ connectionString: process.env.DATABASE_URL }));
    await Promise.all([first.connect(), second.connect()]);
    try {
      await first.query("begin");
      await second.query("begin");
      expect(await postgresStore(first).setSkipped(date, true, notice(`${tag}: first`))).toBe(true);
      const waiting = postgresStore(second).setSkipped(date, true, notice(`${tag}: second`));
      await first.query("commit");
      expect(await waiting).toBe(false);
      await second.query("commit");
      const queued = await first.query(`select "text" from "telegramPost" where "text" like $1`, [`${tag}:%`]);
      expect(queued.rows.map((row) => row.text)).toEqual([`${tag}: first`]);
    } finally {
      await Promise.all([first.query("rollback").catch(() => {}), second.query("rollback").catch(() => {})]);
      await first.query(`delete from "skippedSunday" where "date" = $1`, [date]);
      await first.query(`delete from "telegramPost" where "text" like $1`, [`${tag}:%`]);
      await Promise.all([first.end(), second.end()]);
    }
  }, 30_000);
});
