import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { fromDatabase } from "@/lib/fake-db";
import { failedRequestsSince, lastFailedRequest, noticeFailedRequest } from "./request-failures";

// The failed requests' real SQL (#60) against the database in DATABASE_URL (migrations/012_request_failures.sql): one
// row a kind, the latest, and those since a time. Inside one transaction that is always rolled back, so nothing it does
// is kept; inside it, it empties "requestFailure". Runs only when ALLOW_DB_TESTS=1 is set as well as DATABASE_URL, and
// a plain `pnpm test` skips it. Run it against a local database from `pnpm db:start`, never a shared or live one, before
// seeding: ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/request-failures.postgres.test.ts
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

const page = (routePath: string, error: unknown = new TypeError("Oops")) => noticeFailedRequest(error, { routePath, routeType: "render" });

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the failed requests' SQL in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;
  const select = async (sql: string) => (await client.query(sql)).rows;
  // now() is the test's transaction's, the same for every statement in it, so rows are moved back to tell them apart.
  const backdate = (route: string, at: string) => client.query(`update "requestFailure" set "lastAt" = $2 where "route" = $1`, [route, at]);

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");
    await client.query(`delete from "requestFailure"`);
  }, 30_000);

  afterAll(async () => {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }, 30_000);

  it("keeps one row a kind, its time moved on by each failure, and another for another route, kind or reason", async () => {
    await page("/profile");
    await backdate("/profile", "2026-01-01T00:00:00Z");
    await page("/profile");
    await page("/welcome");
    const unreachable = fromDatabase(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    await noticeFailedRequest(unreachable, { routePath: "/profile", routeType: "action" }, "POST");
    await page("/profile", new RangeError("Oops"));
    const [{ now }] = await select(`select now()`);
    expect(await select(`select "route", "kind", "reason", "lastAt" from "requestFailure" order by "route", "kind", "reason"`)).toEqual([
      { route: "/profile", kind: "page", reason: "the code threw RangeError", lastAt: now },
      { route: "/profile", kind: "page", reason: "the code threw TypeError", lastAt: now },
      { route: "/profile", kind: "server action", reason: "the database couldn't be reached", lastAt: now },
      { route: "/welcome", kind: "page", reason: "the code threw TypeError", lastAt: now },
    ]);
  });

  it("gives the kind that failed last, and those that failed after a time, not at it", async () => {
    await client.query(`delete from "requestFailure"`);
    expect(await lastFailedRequest()).toBeNull();
    for (const [route, at] of [["/older", "2026-11-01T00:00:00Z"], ["/newest", "2026-11-03T00:00:00Z"], ["/at-the-time", "2026-11-02T00:00:00Z"]]) {
      await page(route);
      await backdate(route, at);
    }
    expect(await lastFailedRequest()).toEqual({ route: "/newest", kind: "page", reason: "the code threw TypeError", at: new Date("2026-11-03T00:00:00Z") });
    expect(await failedRequestsSince(new Date("2026-11-02T00:00:00Z"))).toEqual([
      { route: "/newest", kind: "page", reason: "the code threw TypeError", at: new Date("2026-11-03T00:00:00Z") },
    ]);
  });
});
