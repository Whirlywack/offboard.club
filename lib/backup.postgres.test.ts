import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFakeBlob } from "@/lib/fixtures/fake-blob";
import { backUp, dumpDatabase, dumpPathname, LEFT_OUT, restoreDump, unpackDump, type Dump } from "./backup";

// The backup and the restore, by their real SQL, against databases of their own on the Postgres server in DATABASE_URL:
// the test makes them, migrates them with scripts/migrate.mjs and drops them again, so the database in DATABASE_URL is
// not touched. One, the source, is filled with rows in every table, values chosen to be hard to bring back exactly;
// its dump is restored into a second, empty and migrated, and every table of the two is compared row by row. The store
// is the fake (lib/fixtures/fake-blob.ts), served on a local port. Runs only when ALLOW_DB_TESTS=1 is set as well as
// DATABASE_URL, and a plain `pnpm test` skips it. Run it against a Postgres from `pnpm db:start`, never a shared or live
// one: ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/backup.postgres.test.ts
vi.mock("@/lib/db", async () => {
  const { default: pg } = await import("pg");
  // The app's statements go to whichever database the case has chosen; `between`, if set, runs after each statement on
  // a connection the app took for itself, such as the dump's.
  let pool: pg.Pool | null = null;
  const current = () => {
    if (!pool) throw new Error("no database chosen");
    return pool;
  };
  const test = { between: null as ((sql: string) => Promise<void>) | null };
  return {
    db: {
      query: (...args: unknown[]) => (current().query as (...a: unknown[]) => Promise<unknown>)(...args),
      connect: async () => {
        const client = await current().connect();
        const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
        return {
          query: async (...args: unknown[]) => {
            const result = await query(...args);
            await test.between?.(typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text);
            return result;
          },
          release: (error?: Error) => client.release(error),
        };
      },
      use: async (url: string | null) => {
        await pool?.end();
        pool = url ? new pg.Pool({ connectionString: url, max: 2 }) : null;
      },
      test,
    },
  };
});

// A run's deadline, 240 s in production, short here.
const DEADLINE_MS = 500;
vi.mock("./jobs", async (original) => ({ ...(await original<typeof import("./jobs")>()), JOB_DEADLINE_MS: 500 }));

const { use, test: hooks } = db as unknown as { use: (url: string | null) => Promise<void>; test: { between: ((sql: string) => Promise<void>) | null } };

const PREFIX = "offboard_backup_test_";
const TOKEN = "vercel_blob_rw_pretendstore_a-pretend-blob-token";
const NOW = new Date("2026-11-29T01:07:12.345Z");

// A text with every kind of character a Member's words can hold: quotes, a backslash, control characters, a line and
// paragraph separator, right-to-left text, an emoji, and what COPY and CSV would take for null.
const HARD = `Ą "quoted" 'single' back\\slash \u0001\u0007 tab\tnew\nline    שלום 👩🏽‍💻 NULL \\N`;

describe.skipIf(process.env.ALLOW_DB_TESTS !== "1" || !process.env.DATABASE_URL)("the backup and the restore in Postgres", () => {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const made: string[] = [];
  const urlOf = (name: string) => {
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    return url.toString();
  };
  // A new database, migrated as a deploy migrates the live one, whose sessions show values unlike the defaults: a dump
  // and a restore must not depend on how the database they run on writes them.
  const freshDatabase = async (settings = ["TimeZone = 'Pacific/Chatham'", "DateStyle = 'SQL, DMY'", "IntervalStyle = 'sql_standard'", "extra_float_digits = 0"]) => {
    const name = `${PREFIX}${randomBytes(6).toString("hex")}`;
    await admin.query(`create database ${name}`);
    for (const setting of settings) await admin.query(`alter database ${name} set ${setting}`);
    made.push(name);
    const migrated = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: urlOf(name) }, encoding: "utf8" });
    if (migrated.status !== 0) throw new Error(migrated.stderr);
    return urlOf(name);
  };
  const on = async <T>(url: string, work: (client: pg.Client) => Promise<T>) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  };
  // Every table of the database and its rows, each value as Postgres's text for it under the same settings, in one order.
  const everything = (url: string) =>
    on(url, async (client) => {
      await client.query(`set TimeZone = 'UTC'; set DateStyle = 'ISO, YMD'; set IntervalStyle = 'postgres'; set extra_float_digits = 3`);
      const { rows: tables } = await client.query<{ table: string; columns: string[] }>(
        `select c.relname as "table", array_agg(a.attname::text order by a.attnum) as "columns" from pg_class c
         join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         where n.nspname = current_schema() and c.relkind = 'r' group by c.relname order by c.relname`,
      );
      const all: Record<string, unknown[]> = {};
      for (const { table, columns } of tables) {
        const list = columns.map((c) => `${pg.escapeIdentifier(c)}::text`).join(", ");
        all[table] = (await client.query({ text: `select ${list} from ${pg.escapeIdentifier(table)} order by ${columns.map((_, i) => i + 1).join(", ")}`, rowMode: "array" })).rows;
      }
      const { rows: sequences } = await client.query(`select sequencename, last_value::text, start_value::text from pg_sequences order by 1`);
      return { tables: all, sequences };
    });

  let source: string;
  let target: string;
  let dump: Dump;

  // A table that no migration makes yet, as a later one might: it has a column of every kind of type, and is dumped all
  // the same, its column Postgres generates left for Postgres to make again, and a key that refers to its own rows.
  const LATER = `create table "everyType" (
    "id" bigint generated always as identity primary key, "big" bigint, "num" numeric, "flt" double precision, "j" json,
    "jb" jsonb, "b" bytea, "iv" interval, "arr" text[], "ts" timestamptz, "tsz" timestamp, "d" date, "t" time, "ok" boolean,
    "txt" text, "shout" text generated always as (upper("txt")) stored, "parent" bigint references "everyType")`;

  beforeAll(async () => {
    await admin.connect();
    // Those a killed run of this left behind.
    const { rows } = await admin.query<{ datname: string }>(`select datname from pg_database where datname like $1`, [`${PREFIX}%`]);
    for (const { datname } of rows) await admin.query(`drop database ${datname} with (force)`);
    [source, target] = [await freshDatabase(), await freshDatabase(["TimeZone = 'America/St_Johns'", "DateStyle = 'ISO, MDY'", "IntervalStyle = 'postgres'"])];
    await on(source, async (client) => {
      await client.query(LATER);
      await client.query(
        `insert into "company" ("domain", "name", "logoUrl", "fetchedAt", "fetchTriedAt", "fetchAttempts") values
           ('example.com', $1, null, '2026-11-24 10:00:00.000001+00', '2026-11-24 10:00:00.000001+00', 1),
           ('example.org', '', 'https://example.org/logo.png', null, '2026-11-24 10:00:00+00', 3)`,
        [HARD],
      );
      await client.query(
        `insert into "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", "publicDisplayConsentAt",
           "houseRulesAcceptedAt", "position", "linkedInUrl", "openTo", "lichessId", "lichessUsername", "lichessBlitzRating",
           "lichessConnectedAt", "companyDomain", "companiesCreatedOn", "companiesCreatedThatDay", "lichessMarked", "lichessClosed")
         values ($1, $2, 'ana@example.invalid', true, null, '2026-11-24 18:00:00.123456+00', '2026-11-24 18:00:00.123456+00',
           '2026-11-24 18:05:00+00', '2026-11-24 18:05:00+00', '', null, $2, 'ana', 'Ana', 1500, '2026-11-24 18:06:00+00',
           'example.com', '2026-11-24', 2, false, true),
           ('ben', 'Ben', 'ben@example.invalid', false, 'https://photo.invalid/ben.jpg', now(), now(), null, null, null, null,
           null, null, null, null, null, null, null, 0, false, false)`,
        [`ana "${HARD}"`, HARD],
      );
      await client.query(
        `insert into "account" (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") values ('acc', 'linkedin-ana', 'linkedin', $1, now(), now())`,
        [`ana "${HARD}"`],
      );
      // Credentials, which no dump keeps.
      await client.query(`insert into "session" (id, "expiresAt", token, "updatedAt", "userId") values ('s', now(), 'a-pretend-session-token', now(), $1)`, [`ana "${HARD}"`]);
      await client.query(`insert into "verification" (id, identifier, value, "expiresAt") values ('v', 'state', 'a-pretend-state', now())`);
      await client.query(`insert into "season" ("number", "start") values (1, '2026-11-29')`);
      await client.query(`insert into "skippedSunday" ("date") values ('2026-12-13')`);
      await client.query(`insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values ('2026-11-29', 'PreTend1', '2026-11-29 20:30:00.5+00'), ('2026-12-06', null, null)`);
      await client.query(
        `insert into "matchdayResult" ("matchdayDate", "userId", "rank", "points", "rating", "companyDomain") values ('2026-11-29', $1, 1, 0.1::float8 + 0.2::float8, 1510, 'example.com'), ('2026-11-29', 'ben', 2, 2.5, 1400, null)`,
        [`ana "${HARD}"`],
      );
      await client.query(
        `insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt")
         values ('Pretend01', '2026-11-29', $1, 'ben', 'white', 'mate', 31, 1500, 1550, 4200, '2026-11-29 19:10:00.999999+00'),
                ('Pretend02', '2026-11-29', null, 'ben', null, 'draw', 80, 1500, 1550, null, '2026-11-29 19:30:00+00')`,
        [`ana "${HARD}"`],
      );
      await client.query(
        `insert into "organiserLichess" ("userId", "lichessId", "scopes", "token", "expiresAt") values ($1, 'ana', 'tournament:write team:lead', 'v1.a-pretend-sealed-token', '2027-11-25 12:00:00+00')`,
        [`ana "${HARD}"`],
      );
      await client.query(`insert into "scheduledJob" ("job", "lastRunAt", "lastOutcome", "lastDetail") values ('create-matchdays', now(), 'done', $1)`, [HARD]);
      // An id past the largest whole number JavaScript holds exactly, and the identity's sequence past it.
      await client.query(`insert into "jobFailure" ("id", "job", "problem") overriding system value values (9007199254740993, 'collect-results', $1)`, [HARD]);
      await client.query(`select setval('"jobFailure_id_seq"', 9007199254740993)`);
      await client.query(`insert into "teamRemoval" ("lichessId", "problem") values ('gone', 'Lichess refused it.')`);
      await client.query(`insert into "telegramPost" ("key", "text", "until", "claimedAt", "sentAt") values ('recap:2026-11-29', $1, '2026-12-06 18:00:00+00', now(), now())`, [HARD]);
      await client.query(
        `insert into "everyType" ("big", "num", "flt", "j", "jb", "b", "iv", "arr", "ts", "tsz", "d", "t", "ok", "txt") values
           (9223372036854775807, 123456789012345678901234567890.123456789, 1e-310, '{"b": 1,  "a": [1, 2.50, "x"], "a": null}',
            '{"z": {"y": [true, null]}}', '\\x00ff7f', '-1 days +02:03:04.5', $1, '2026-03-29 00:59:59.999999+00',
            '2026-10-25 03:30:00', '0001-01-01', '23:59:59.999999', false, $2),
           (-9223372036854775808, 'NaN', 'Infinity', 'null', '[]', '', '0', '{}', '-infinity', 'infinity', '2026-11-29', '00:00', true, ''),
           (null, null, -0.0, null, null, null, '-1 days -02:03:04.5', $3, null, null, '2026-12-01', null, null, null)`,
        [["a", "", null, HARD, "NULL"], HARD, [null]],
      );
      // The first row refers to the last, which a restore filling the rows one by one would not have yet.
      await client.query(`update "everyType" set "parent" = (select max("id") from "everyType") where "id" = (select min("id") from "everyType")`);
    });
    await on(target, (client) => client.query(LATER));
    await use(source);
    dump = await dumpDatabase();
  }, 60_000);

  afterAll(async () => {
    await use(null);
    try {
      for (const name of made) await admin.query(`drop database if exists ${name} with (force)`);
    } finally {
      await admin.end();
    }
  }, 30_000);

  it("dumps every table the catalogue has, a later one too, but those it says why it leaves out", async () => {
    const { tables } = await everything(source);
    expect([...Object.keys(dump.tables), ...Object.keys(LEFT_OUT)].sort()).toEqual(Object.keys(tables).sort());
    // Each named is a table there is.
    for (const table of Object.keys(LEFT_OUT)) expect(tables).toHaveProperty(table);
    expect(dump.tables).toHaveProperty("everyType");
    expect(dump.tables.everyType.columns).not.toContain("shout");
    expect(JSON.stringify(dump)).not.toContain("a-pretend-session-token");
    expect(JSON.stringify(dump)).not.toContain("a-pretend-state");
    expect(dump.migrations).toEqual((await on(source, (c) => c.query(`select name from schema_migrations order by name`))).rows.map((r) => r.name));
  });

  it("is one moment of the database: what is written while it reads one table and then another is in neither", async () => {
    await use(source);
    let written = false;
    hooks.between = async (sql) => {
      if (written || !sql.includes(`from "account"`)) return;
      written = true;
      await on(source, (c) => c.query(`insert into "teamRemoval" ("lichessId", "problem") values ('during', 'Written during the dump.')`));
    };
    try {
      const during = await dumpDatabase();
      expect(written).toBe(true);
      expect(during.tables.teamRemoval.rows.map((row) => row[0])).toEqual(["gone"]);
    } finally {
      hooks.between = null;
      await on(source, (c) => c.query(`delete from "teamRemoval" where "lichessId" = 'during'`));
    }
  });

  it("restores into an empty, migrated database exactly, every table row by row, whatever the dump's order of tables", async () => {
    // The tables in the reverse of their foreign keys' order: each refers to those that would come after it.
    const reversed = { ...dump, tables: Object.fromEntries(Object.entries(dump.tables).reverse()) };
    await use(target);
    const restored = await restoreDump(reversed);
    expect(restored.find((r) => r.table === "user")).toEqual({ table: "user", rows: 2 });
    const [before, after] = [await everything(source), await everything(target)];
    for (const [table, rows] of Object.entries(before.tables)) {
      if (table === "session" || table === "verification") expect(after.tables[table]).toEqual([]);
      // Each database's own record of its migrations, the same ones, applied when each was made.
      else if (table === "schema_migrations") expect(after.tables[table].map((row) => (row as string[])[0])).toEqual(rows.map((row) => (row as string[])[0]));
      else expect([table, after.tables[table]]).toEqual([table, rows]);
    }
    expect(after.sequences).toEqual(before.sequences);
    // The identity's next value follows the restored one.
    const next = await on(target, (c) => c.query(`insert into "jobFailure" ("job", "problem") values ('x', 'y') returning "id"::text`));
    expect(next.rows).toEqual([{ id: "9007199254740994" }]);
  });

  it("refuses a database that already has people in it, and changes nothing there", async () => {
    await use(target);
    const before = await everything(target);
    await expect(restoreDump(dump)).rejects.toThrow("This database already has people in it. A dump is restored only into an empty, migrated database.");
    expect(await everything(target)).toEqual(before);
  });

  it("refuses a database that isn't empty but has nobody in it", async () => {
    const other = await freshDatabase();
    await on(other, (c) => c.query(LATER));
    await on(other, (c) => c.query(`insert into "teamRemoval" ("lichessId", "problem") values ('someone', 'x')`));
    await use(other);
    await expect(restoreDump(dump)).rejects.toThrow(`This database isn't empty: "teamRemoval" has rows.`);
    expect((await on(other, (c) => c.query(`select count(*)::int as n from "user"`))).rows).toEqual([{ n: 0 }]);
  });

  it("refuses a database that hasn't had every migration the dump's had, or lacks one of its columns", async () => {
    const other = await freshDatabase();
    await use(other);
    await expect(restoreDump({ ...dump, migrations: [...dump.migrations, "999_later.sql"] })).rejects.toThrow(
      "This database doesn't have migration 999_later.sql, which the dump's had. Migrate it first, with pnpm migrate.",
    );
    // This one has no "everyType".
    await expect(restoreDump(dump)).rejects.toThrow(`This database has no column id in "everyType", which the dump has.`);
    expect((await on(other, (c) => c.query(`select count(*)::int as n from "company"`))).rows).toEqual([{ n: 0 }]);
  });

  it("refuses tables that refer to each other in a circle, rather than fill them in an order that breaks a key", async () => {
    const other = await freshDatabase();
    await on(other, (c) =>
      c.query(`create table "x" ("id" int primary key, "y" int); create table "y" ("id" int primary key, "x" int references "x" deferrable);
               alter table "x" add foreign key ("y") references "y" deferrable`),
    );
    await use(other);
    const circle: Dump = { ...dump, tables: { x: { columns: ["id", "y"], rows: [["1", "1"]] }, y: { columns: ["id", "x"], rows: [["1", "1"]] } }, sequences: {} };
    await expect(restoreDump(circle)).rejects.toThrow("These tables refer to each other in a circle, so they can't be filled in order: x, y.");
  });

  describe("the nightly job", () => {
    const blob = createFakeBlob({ token: TOKEN, storeId: "pretendstore" });
    let server: Server;
    let logged: string[];
    // While set, the store takes each request and never answers it.
    let silent = false;

    beforeAll(async () => {
      server = createServer(async (request, reply) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        blob.calls.length += silent ? 1 : 0;
        if (silent) return;
        const headers = Object.entries(request.headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value] as [string, string]] : []));
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const response = await blob.handle(new Request(new URL(request.url ?? "/", "http://127.0.0.1"), { method: request.method, headers, body }));
        reply.writeHead(response.status, Object.fromEntries(response.headers));
        reply.end(Buffer.from(await response.arrayBuffer()));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as { port: number };
      vi.stubEnv("VERCEL_BLOB_API_URL", `http://127.0.0.1:${port}/api/blob`);
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
      logged = [];
      for (const method of ["log", "info", "warn", "error", "debug"] as const)
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
      await use(source);
    });

    afterAll(async () => {
      // No value from the database reached the log.
      expect(logged.join("\n")).not.toContain("Ana");
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    const lastRun = async () =>
      (await on(source, (c) => c.query(`select "lastOutcome", "lastDetail" from "scheduledJob" where "job" = 'backup'`))).rows[0];

    it("stores the whole dump, compressed, as a private file named by its date and time, deleted by the store after 12 days", async () => {
      const run = await backUp(NOW);
      expect(run.outcome).toBe("done");
      expect(run.detail).toMatch(/^Backed up the database \(\d+ kB\)\. Each backup is kept for at least 12 days\.$/);
      expect(dumpPathname(NOW)).toBe("backups/2026-11-29T01-07-12Z.json.gz");
      const stored = blob.blobs.get("backups/2026-11-29T01-07-12Z.json.gz")!;
      expect(stored).toMatchObject({ contentType: "application/gzip", ttlDays: 12 });
      expect(blob.calls.at(-1)?.headers).toMatchObject({ "x-vercel-blob-access": "private" });
      // The store's address of it is nowhere in what the run says.
      expect(JSON.stringify(run)).not.toContain("blob.vercel-storage.com");
      // The same as the dump before but for the moment and the job's own row, which the run itself made.
      const file = unpackDump(stored.body);
      const jobs = (d: Dump) => d.tables.scheduledJob.rows.map((row) => row[0]);
      expect(jobs(file)).toEqual([...jobs(dump), "backup"]);
      const without = (d: Dump) => ({ ...d, takenAt: null, tables: { ...d.tables, scheduledJob: null } });
      expect(without(file)).toEqual(without(dump));
      expect(await lastRun()).toEqual({ lastOutcome: "done", lastDetail: run.detail });
    });

    it("makes a whole new one at the next run, and leaves the earlier as it was", async () => {
      const first = blob.blobs.get(dumpPathname(NOW))!.body;
      const later = new Date(NOW.getTime() + 86_400_000);
      expect((await backUp(later)).outcome).toBe("done");
      expect(blob.blobs.get(dumpPathname(NOW))!.body).toBe(first);
      expect(unpackDump(blob.blobs.get(dumpPathname(later))!.body).tables.user.rows).toHaveLength(2);
    });

    it("fails plainly when the store refuses it, storing nothing and saying nothing of what the dump holds", async () => {
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_pretendstore_not-the-store-token");
      const count = blob.blobs.size;
      const run = await backUp(new Date(NOW.getTime() + 2 * 86_400_000));
      expect(run).toEqual({
        outcome: "failed",
        detail: "The backup failed: Vercel Blob: Access denied, please provide a valid token for this resource.",
        matchdayDate: null,
      });
      expect(blob.blobs.size).toBe(count);
      expect(await lastRun()).toEqual({ lastOutcome: "failed", lastDetail: run.detail });
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
    });

    it("gives up on a store that never answers, at the run's deadline, and says so", async () => {
      silent = true;
      try {
        const calls = blob.calls.length;
        const started = Date.now();
        expect(await backUp(new Date(NOW.getTime() + 4 * 86_400_000))).toEqual({
          outcome: "failed",
          detail: "The backup failed: it took more than 0.5 s.",
          matchdayDate: null,
        });
        expect(blob.calls.length).toBe(calls + 1);
        expect(Date.now() - started).toBeGreaterThanOrEqual(DEADLINE_MS);
      } finally {
        silent = false;
      }
    });

    it("switches itself off without the store's token: skipped, not failed, and asks the store nothing", async () => {
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
      const calls = blob.calls.length;
      expect(await backUp(new Date(NOW.getTime() + 3 * 86_400_000))).toEqual({
        outcome: "skipped",
        detail: "Backups aren't set up: BLOB_READ_WRITE_TOKEN isn't set, so the database isn't backed up.",
        matchdayDate: null,
      });
      expect(blob.calls.length).toBe(calls);
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
    });
  });
});
