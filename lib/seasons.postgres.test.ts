import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchdaysOfSeason, postgresStore, setSeasonStart, skipSunday, unskipSunday, upcomingMatchday } from "./seasons";

// The real Store's SQL against the database in DATABASE_URL, inside one transaction that is always rolled back,
// so nothing it does is kept. Skipped when DATABASE_URL is not set, as in a plain `pnpm test`. To run it:
// node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/seasons.postgres.test.ts
describe.skipIf(!process.env.DATABASE_URL)("the Postgres store", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const store = postgresStore(client);

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");
  }, 30_000);

  afterAll(async () => {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }, 30_000);

  it("schedules Season 1, skips and sets starts", async () => {
    // Seen from inside the transaction only.
    await client.query(`delete from "season"`);
    await client.query(`delete from "skippedSunday"`);
    // Sixteen Members who connected Lichess in January 2026, before any real one, and one person part-way through.
    const addPerson = (n: number, finishedAt: string | null) =>
      client.query(
        `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId", "lichessConnectedAt")
         values ($1, $1, $2, false, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', $3, $4)`,
        [`store-test-${n}`, `store-test-${n}@example.invalid`, finishedAt && `store-test-${n}`, finishedAt],
      );
    for (let n = 1; n <= 16; n++) await addPerson(n, `2026-01-${String(n).padStart(2, "0")}T12:00:00Z`);
    await addPerson(17, null);
    const times = await store.signUpTimes();
    expect(times.filter((t) => t < new Date("2026-02-01"))).toHaveLength(16);

    // The sixteenth on Friday 16 January: Season 1 starts Sunday 25 January.
    const now = new Date("2026-01-20T12:00:00Z");
    expect(await upcomingMatchday(now, store)).toEqual({ season: 1, number: 1, date: "2026-01-25", start: new Date("2026-01-25T18:00:00Z") });
    expect(await store.seasons()).toEqual([{ number: 1, start: "2026-01-25" }]);
    // A racing request's insert changes nothing.
    await store.addSeason({ number: 1, start: "2026-02-01" });
    expect(await store.seasons()).toEqual([{ number: 1, start: "2026-01-25" }]);

    expect(await skipSunday("2026-02-01", now, store)).toBeNull();
    expect(await skipSunday("2026-02-01", now, store)).toBeNull();
    expect(await store.skippedSundays()).toEqual(["2026-02-01"]);
    expect(await matchdaysOfSeason(1, now, store)).toEqual(["2026-01-25", "2026-02-08", "2026-02-15", "2026-02-22", "2026-03-01", "2026-03-08"]);
    expect(await unskipSunday("2026-02-01", now, store)).toBeNull();
    expect(await store.skippedSundays()).toEqual([]);

    expect(await setSeasonStart(1, "2026-02-08", now, store)).toBeNull();
    expect(await setSeasonStart(2, "2026-04-05", now, store)).toBeNull();
    expect((await store.seasons()).sort((a, b) => a.number - b.number)).toEqual([
      { number: 1, start: "2026-02-08" },
      { number: 2, start: "2026-04-05" },
    ]);
  }, 60_000);
});
