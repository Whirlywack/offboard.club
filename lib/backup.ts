// The Club's backups (#17). Every night Vercel runs this job (vercel.json, app/api/jobs/backup), which dumps the whole
// database through SQL from inside the function, as a Vercel Function has no pg_dump, and stores the dump outside Neon,
// whose own restore history lasts 6 hours, in the private Vercel Blob store offboard-backups. `pnpm restore <file>` loads
// one into an empty, migrated database (docs/restore.md).
//
// - One moment: every table is read in one read-only, repeatable-read transaction, so a dump is the database as it was
//   at one instant, its foreign keys whole.
// - Every table: the tables are read from the database's catalogue, so one that a later migration adds is dumped with
//   no change here. LEFT_OUT names the few left out, each with why.
// - Exactly: each value is dumped as Postgres's own text for it, under fixed settings, and restored through the same
//   type's input, so a timestamp keeps its microseconds and its instant, a bigint its digits, json its text, and an empty
//   string stays apart from null. Each sequence, those behind identity columns included, keeps its next value.
// - Private: the store is private and each dump is written to it as private, so its address opens only with the store's
//   token. A dump holds Members' personal data, so no part of it is logged or put in a message: a run says how big the
//   dump was, or why it failed.
// - Gone within 14 days, as /privacy says: each run, once its own dump is stored, deletes every dump under backups/ made
//   more than 13 days before, by the date in its name, so that while the job runs nightly none is kept longer. Each is
//   also written with a time to live of 12 days (ttlDays), after which the store deletes it by itself, even if this job
//   stops running: Vercel applies expirations at UTC midnight, and a dump past its time is "usually gone within a day"
//   (vercel.com/docs/vercel-blob/using-blob-sdk, "Expire blobs automatically"), with no promise beyond that.
// - Nothing half-written: a dump is made whole in memory, then stored by one request under a name of its own, which
//   either makes the file or does not. A run that fails leaves nothing, and the next night's makes a whole dump again.
// - On time: a run stops waiting for the dump and the store at its deadline, whatever they are doing. What it records,
//   that a dump was stored and how the run went, needs the database; runs that cannot record are noticed when none
//   has been stored for two days (lib/alerts.ts).

import { del, list, put } from "@vercel/blob";
import { escapeIdentifier } from "pg";
import { gunzipSync, gzipSync } from "node:zlib";
import { done, failed, JOB_DEADLINE_MS, runJob, sentence, skipped, workDone, type JobRun } from "./jobs";
import { inTransaction } from "./transaction";

export const JOB = "backup";

// The days after which the store deletes a dump by itself (ttlDays): see "Gone within 14 days" above.
const KEPT_DAYS = 12;

// The tables a dump leaves out, each with why; the restore says so. Every other table is dumped as it is, among them
// "organiserLichess": the Organiser's Lichess token there is sealed under LICHESS_TOKEN_KEY (lib/token-box.ts), which is
// in neither the database nor the dump, so a dump alone gives no usable token, and restored where that key is set, the
// site goes on creating Matchdays without the Organiser connecting again. "account" holds no LinkedIn token (lib/auth.ts)
// and is what matches a sign-in to its person.
export const LEFT_OUT: Record<string, string> = {
  session: "signed-in sessions are credentials, with an IP address and browser each; everyone signs in again",
  verification: "values for one sign-in or connection, valid for minutes, are credentials too",
  schema_migrations: "the database restored into is migrated already; the dump lists its migrations instead",
};

export type Dump = {
  offboardDump: 1;
  takenAt: string;
  migrations: string[];
  // Each table's columns, but those Postgres generates, and its rows, each value as Postgres's text for it or null.
  tables: Record<string, { columns: string[]; rows: (string | null)[][] }>;
  sequences: Record<string, { value: string; called: boolean }>;
};

// The settings under which every value's text is exact and unambiguous, whatever the database's defaults, so that any
// database reads it back the same; and the moment of the dump.
const SETTINGS = `select set_config('DateStyle', 'ISO, YMD', true), set_config('IntervalStyle', 'postgres', true),
  set_config('extra_float_digits', '1', true), now()::text as "now"`;

const id = (name: string) => escapeIdentifier(name);

// The whole database, but LEFT_OUT, as one moment of it. Throws if the database fails.
export function dumpDatabase(): Promise<Dump> {
  return inTransaction(async (q) => {
    await q.query("set transaction isolation level repeatable read, read only");
    const { rows: started } = await q.query<{ now: string }>(SETTINGS);
    const { rows: migrations } = await q.query<{ name: string }>(`select name from schema_migrations order by name`);
    const { rows: found } = await q.query<{ table: string; columns: string[] }>(
      `select c.relname as "table", array_agg(a.attname::text order by a.attnum) as "columns"
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       where n.nspname = current_schema() and c.relkind = 'r' group by c.relname order by c.relname`,
    );
    const tables: Dump["tables"] = {};
    for (const { table, columns } of found.filter(({ table }) => !Object.hasOwn(LEFT_OUT, table))) {
      const { rows } = await q.query<(string | null)[]>({
        text: `select ${columns.map((column) => `${id(column)}::text`).join(", ")} from ${id(table)}`,
        rowMode: "array",
      });
      tables[table] = { columns, rows };
    }
    const { rows: names } = await q.query<{ name: string }>(
      `select c.relname as "name" from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = current_schema() and c.relkind = 'S' order by c.relname`,
    );
    const sequences: Dump["sequences"] = {};
    for (const { name } of names) {
      const { rows } = await q.query<{ value: string; called: boolean }>(`select last_value::text as "value", is_called as "called" from ${id(name)}`);
      sequences[name] = rows[0];
    }
    return { offboardDump: 1, takenAt: started[0].now, migrations: migrations.map((m) => m.name), tables, sequences };
  });
}

// A dump, from the file the job stores, gzipped JSON; or an error saying it is not one.
export function unpackDump(file: Buffer): Dump {
  const dump = JSON.parse(gunzipSync(file).toString("utf8")) as Dump;
  if (dump?.offboardDump !== 1) throw new Error("That file isn't a dump the backup job made.");
  return dump;
}

type Restored = { table: string; rows: number }[];

// Loads `dump` into the database, which must be migrated at least as far as the dump's was and have nothing in any table
// the dump fills, all in one transaction: either every row and sequence is restored, or nothing is. Tables are filled
// in the order of their foreign keys, read from this database's catalogue, so that each refers only to rows already
// there, whatever the dump's order. How many rows each table got.
export function restoreDump(dump: Dump): Promise<Restored> {
  return inTransaction(async (q) => {
    const { rows: applied } = await q.query<{ name: string }>(`select name from schema_migrations`);
    const missing = dump.migrations.find((name) => !applied.some((row) => row.name === name));
    if (missing) throw new Error(`This database doesn't have migration ${missing}, which the dump's had. Migrate it first, with pnpm migrate.`);
    const { rows: columns } = await q.query<{ table: string; column: string; type: string }>(
      `select c.relname as "table", a.attname as "column", format_type(a.atttypid, a.atttypmod) as "type"
       from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
       where n.nspname = current_schema() and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`,
    );
    const typeOf = (table: string, column: string) => columns.find((c) => c.table === table && c.column === column)?.type;
    const taken: string[] = [];
    for (const [table, { columns: dumped }] of Object.entries(dump.tables)) {
      const unknown = dumped.find((column) => !typeOf(table, column));
      if (unknown) throw new Error(`This database has no column ${unknown} in "${table}", which the dump has.`);
      const { rows } = await q.query<{ taken: boolean }>(`select exists (select from ${id(table)}) as "taken"`);
      if (rows[0].taken) taken.push(table);
    }
    if (taken.length > 0)
      throw new Error(
        `${taken.includes("user") ? "This database already has people in it" : `This database isn't empty: "${taken[0]}" has rows`}. A dump is restored only into an empty, migrated database.`,
      );
    const { rows: references } = await q.query<{ table: string; references: string }>(
      `select t.relname as "table", r.relname as "references" from pg_constraint k
       join pg_class t on t.oid = k.conrelid join pg_class r on r.oid = k.confrelid join pg_namespace n on n.oid = t.relnamespace
       where k.contype = 'f' and n.nspname = current_schema()`,
    );
    const restored: Restored = [];
    for (const table of inOrder(Object.keys(dump.tables), references)) {
      const { columns: names, rows } = dump.tables[table];
      if (rows.length > 0) {
        const values = names.map((name, i) => `r.c${i}::${typeOf(table, name)}`).join(", ");
        const arrays = names.map((_, i) => `$${i + 1}::text[]`).join(", ");
        const aliases = names.map((_, i) => `c${i}`).join(", ");
        // Overriding the system value, so that an identity column keeps the value it had.
        await q.query(
          `insert into ${id(table)} (${names.map(id).join(", ")}) overriding system value select ${values} from unnest(${arrays}) as r (${aliases})`,
          names.map((_, i) => rows.map((row) => row[i])),
        );
      }
      restored.push({ table, rows: rows.length });
    }
    for (const [name, { value, called }] of Object.entries(dump.sequences))
      await q.query(`select setval($1::regclass, $2::bigint, $3)`, [id(name), value, called]);
    return restored;
  });
}

// The tables so that each comes after those its foreign keys refer to. A table that refers to itself is filled by one
// statement, which Postgres checks as a whole.
function inOrder(tables: string[], references: { table: string; references: string }[]): string[] {
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size > 0) {
    const ready = [...left].filter((table) => !references.some((r) => r.table === table && r.references !== table && left.has(r.references)));
    if (ready.length === 0) throw new Error(`These tables refer to each other in a circle, so they can't be filled in order: ${[...left].join(", ")}.`);
    for (const table of ready) {
      order.push(table);
      left.delete(table);
    }
  }
  return order;
}

// --- The nightly job ---

// The store's token, which Vercel sets in Production alone, where the store is connected.
const storeToken = () => process.env.BLOB_READ_WRITE_TOKEN || null;

// Why nothing is backed up, as a sentence for the Organiser page; null when backups are set up.
export const backupProblem = () => (storeToken() ? null : "Backups aren't set up: BLOB_READ_WRITE_TOKEN isn't set, so the database isn't backed up.");

// Where a dump made at `now` goes: by its UTC date and time, as backups/2026-11-29T01-07-12Z.json.gz.
const PREFIX = "backups/";
export const dumpPathname = (now: Date) => `${PREFIX}${now.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z")}.json.gz`;

// When the dump at `pathname` was made, read back from its name; null for a name this job does not give.
function madeAt(pathname: string): Date | null {
  const name = /^backups\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json\.gz$/.exec(pathname);
  const at = name && new Date(`${name[1]}T${name[2]}:${name[3]}:${name[4]}Z`);
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

// A run deletes the dumps made more than 13 days before it, so that, run nightly, each is gone within 14.
const DELETE_AFTER_MS = 13 * 86_400_000;

// One run of the job at `now`: what it did and why. Throws only if the database cannot record the run.
export const backUp = (now: Date) => runJob(JOB, () => backUpNow(now));

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const reason = (error: unknown) => (error instanceof Error ? error.message : "unknown error");

async function backUpNow(now: Date): Promise<JobRun> {
  const token = storeToken();
  if (!token) return skipped(backupProblem()!);
  // The run ends at its deadline whatever @vercel/blob is doing: the SDK tries a request again, with growing waits, for
  // up to 17 minutes, and has no documented way to try fewer times, so the run stops waiting for it instead, and records
  // why within its route's maxDuration. The abort has no reason, which the SDK (2.9.0, requestApi) takes as the end the
  // next time it tries; one aborted with a reason it would try again.
  const deadline = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      deadline.abort();
      reject(new Error(`it took more than ${JOB_DEADLINE_MS / 1000} s`));
    }, JOB_DEADLINE_MS);
  });
  const inTime = <T>(work: Promise<T>) => Promise.race([work, late]);
  const options = { token, abortSignal: deadline.signal };
  try {
    let size: string;
    try {
      const file = gzipSync(JSON.stringify(await inTime(dumpDatabase())));
      await inTime(put(dumpPathname(now), file, { ...options, access: "private", ttlDays: KEPT_DAYS, contentType: "application/gzip" }));
      size = `${Math.ceil(file.length / 1024)} kB`;
    } catch (error) {
      // The store's errors and the database's name the request, never a value from the dump.
      return failed(`The backup failed: ${sentence(reason(error))}.`);
    }
    // The new dump is stored, so a backup has been made, whatever happens next. Now the old ones go, those under
    // backups/ alone, by the date in each name.
    await workDone(JOB);
    const old: string[] = [];
    const strange: string[] = [];
    try {
      let cursor: string | undefined;
      do {
        const page = await inTime(list({ ...options, prefix: PREFIX, cursor }));
        for (const { url, pathname } of page.blobs) {
          const at = madeAt(pathname);
          if (!at) strange.push(pathname);
          else if (now.getTime() - at.getTime() > DELETE_AFTER_MS) old.push(url);
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      if (old.length > 0) await inTime(del(old, options));
    } catch (error) {
      return failed(`Backed up the database (${size}), but couldn't delete the backups over 13 days old: ${sentence(reason(error))}.`);
    }
    const deleted = old.length > 0 ? `, and deleted ${count(old.length, "backup", "backups")} over 13 days old` : "";
    if (strange.length > 0)
      return failed(
        `Backed up the database (${size})${deleted}, but left ${strange[0]}${strange.length > 1 ? ` and ${strange.length - 1} more` : ""} alone: its name isn't one this job gives, so it isn't deleted after 13 days. Delete it in the store if it isn't wanted.`,
      );
    return done(`Backed up the database (${size})${deleted}.`);
  } finally {
    clearTimeout(timer);
  }
}
