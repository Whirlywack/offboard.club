// Applies the migrations/*.sql files that have not run yet, in name order, in one transaction,
// and records each in schema_migrations. Run with `pnpm migrate`; DATABASE_URL comes from the environment.
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set: add it to .env.local or the environment.");
  process.exit(1);
}

const dir = new URL("../migrations/", import.meta.url);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("begin");
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
