// Applies the migrations/*.sql files that have not run yet, in name order, in one transaction,
// and records each in schema_migrations. Run with `pnpm migrate`; DATABASE_URL comes from the environment.
//
// The live database is migrated by the production deploy and by nothing else: `pnpm build` runs this with
// --on-deploy, which applies migrations only when Vercel is building production (VERCEL_ENV=production) and does
// nothing anywhere else. So a migration reaches the live database once it has merged, and the deploy fails,
// leaving the previous one live, if it cannot be applied.
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

if (process.argv.includes("--on-deploy") && process.env.VERCEL_ENV !== "production") {
  console.log("not a production deploy: migrations left alone");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set: add it to .env.local or the environment.");
  process.exit(1);
}

const dir = new URL("../migrations/", import.meta.url);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("begin");
  // Two deploys building at once take turns here: the second waits, then finds nothing left to apply.
  await client.query("select pg_advisory_xact_lock(20261125)");
  await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const { rows } = await client.query("select name from schema_migrations");
  const applied = new Set(rows.map((row) => row.name));
  const pending = (await readdir(dir)).filter((name) => name.endsWith(".sql") && !applied.has(name)).sort();
  for (const name of pending) {
    await client.query(await readFile(new URL(name, dir), "utf8"));
    await client.query("insert into schema_migrations (name) values ($1)", [name]);
    console.log(`applied ${name}`);
  }
  await client.query("commit");
  if (pending.length === 0) console.log("nothing to apply");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
