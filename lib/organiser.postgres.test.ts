import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { organiserName } from "./organiser";

// The Organiser's name read by its real SQL from the database in DATABASE_URL, inside one transaction that is always
// rolled back, so nothing it does is kept. Every row it adds is its own. Runs only when ALLOW_DB_TESTS=1 is set as well,
// never in a plain `pnpm test`. Run it against a local database from `pnpm db:start`, never a shared or live one:
// ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/organiser.postgres.test.ts
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

describe.skipIf(process.env.ALLOW_DB_TESTS !== "1" || !process.env.DATABASE_URL)("the Organiser's name in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");
    // A Member, and one person short of being one in each of the three ways: [id, accepted public listing, accepted the
    // house rules, connected Lichess].
    const people: [string, boolean, boolean, boolean][] = [
      ["organiser-test-member", true, true, true],
      ["organiser-test-no-consent", false, true, true],
      ["organiser-test-no-rules", true, false, true],
      ["organiser-test-no-lichess", true, true, false],
    ];
    const at = (given: boolean) => (given ? new Date() : null);
    for (const [id, listed, rules, lichess] of people)
      await client.query(
        `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId")
         values ($1, $2, $3, false, $4, $5, $6)`,
        [id, `Name of ${id}`, `${id}@example.invalid`, at(listed), at(rules), lichess ? id : null],
      );
  }, 30_000);

  afterAll(async () => {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }, 30_000);

  afterEach(() => vi.unstubAllEnvs());

  it("is the configured Member's name", async () => {
    vi.stubEnv("ORGANISER_USER_ID", "organiser-test-member");
    expect(await organiserName()).toBe("Name of organiser-test-member");
  });

  it.each(["organiser-test-no-consent", "organiser-test-no-rules", "organiser-test-no-lichess"])(
    "is nobody's while the configured person is not a Member (%s)",
    async (id) => {
      vi.stubEnv("ORGANISER_USER_ID", id);
      expect(await organiserName()).toBeNull();
    },
  );

  it("is nobody's while ORGANISER_USER_ID is unset or names nobody", async () => {
    vi.stubEnv("ORGANISER_USER_ID", "");
    expect(await organiserName()).toBeNull();
    vi.stubEnv("ORGANISER_USER_ID", "organiser-test-nobody");
    expect(await organiserName()).toBeNull();
  });
});
