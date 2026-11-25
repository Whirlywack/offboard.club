// A sort or a time that the database decides comes out the same on db:start's local Postgres as on CI's postgres:18,
// whose database sorts by glibc's en_US.utf8 and keeps time in UTC; db:start's sorts by ICU's en-US with punctuation
// shifted, and keeps UTC (scripts/local-db.mjs, INITDB). Each case runs against both, and each order here is the one
// CI's gave. ICU's plain en-US sorts the punctuation case otherwise: '1-1', '1-2', '11', '12'. Runs only when
// ALLOW_DB_TESTS=1 is set as well as DATABASE_URL, and a plain `pnpm test` skips it.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the database's sort and time", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => client.connect());
  afterAll(() => client.end());
  const sorted = async (words: string[]) =>
    (await client.query<{ word: string }>("select word from unnest($1::text[]) as word order by word", [[...words].reverse()])).rows.map(({ word }) => word);

  it("sorts names as en_US does: case after letter, accents and Lithuanian letters beside their own", async () => {
    const names = ["andrius", "Andrius", "Ąžuolas", "Cezaris", "Čiurlionis", "Eglė", "Émile", "eva", "Ona", "Šarūnas", "Saulė", "Ūla", "Uosis", "zebra", "Zita", "Žydrūnė"];
    expect(await sorted(names)).toEqual(names);
  });

  it("sorts Lichess ids and keys of letters and digits as en_US does", async () => {
    const ids = ["11", "12", "a1", "A2", "ab", "abc123", "abd", "ABD", "pretenda"];
    expect(await sorted(ids)).toEqual(ids);
  });

  it("sorts punctuation and spaces as en_US does: weighed only after the letters and digits around them", async () => {
    const words = ["1-1", "11", "1-2", "12", "a1", "a b", "a-b", "a_b", "ab", "pretend-a", "pretenda", "pretend_b", "pretend--newcomer-1"];
    expect(await sorted(words)).toEqual(words);
  });

  it("keeps time in UTC", async () => {
    const { rows } = await client.query("select '2026-03-29 03:30:00+03'::timestamptz::text as at");
    expect(rows).toEqual([{ at: "2026-03-29 00:30:00+00" }]);
  });
});
