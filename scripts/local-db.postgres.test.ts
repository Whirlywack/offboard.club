// A sort or a time that the database decides comes out as it does on the live database, Neon's Postgres 18, whose
// default collation is the builtin provider's C.UTF-8 and whose zone is GMT: text by code point, so every capital before
// every small letter, and a letter beyond ASCII after both, and no hour moved. CI's postgres:18 is made so (its
// POSTGRES_INITDB_ARGS), and so is db:start's (scripts/local-db.mjs, initdb()); this runs against each, and fails on a
// database that sorts by en_US, as the image's own default did. Runs only when ALLOW_DB_TESTS=1 is set as well as
// DATABASE_URL, and a plain `pnpm test` skips it.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("the database's sort and time", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => client.connect());
  afterAll(() => client.end());
  const sorted = async (words: string[]) =>
    (await client.query<{ word: string }>("select word from unnest($1::text[]) as word order by word", [[...words].reverse()])).rows.map(({ word }) => word);

  it("sorts Lichess ids by code point, as the live database does", async () => {
    expect(await sorted(["a0000000", "ab12cdef", "Ab12CdEf", "bR3kL9qZ", "Zx9Yw8Vu"])).toEqual(["Ab12CdEf", "Zx9Yw8Vu", "a0000000", "ab12cdef", "bR3kL9qZ"]);
  });

  it("sorts names by code point: capitals first, letters beyond ASCII last", async () => {
    const names = ["Andrius", "Cezaris", "Eglė", "Ona", "Saulė", "Zita", "andrius", "eva", "zebra", "Émile", "Ąžuolas", "Čiurlionis", "Šarūnas", "Ūla", "Žydrūnė"];
    expect(await sorted(names)).toEqual(names);
  });

  it("sorts punctuation and spaces by code point, before digits and letters", async () => {
    const words = ["1-1", "1-2", "11", "12", "a b", "a-b", "a1", "a_b", "ab", "pretend--newcomer-1", "pretend-a", "pretend_b", "pretenda"];
    expect(await sorted(words)).toEqual(words);
  });

  it("keeps time in UTC", async () => {
    const { rows } = await client.query("select '2026-03-29 03:30:00+03'::timestamptz::text as at");
    expect(rows).toEqual([{ at: "2026-03-29 00:30:00+00" }]);
  });
});
