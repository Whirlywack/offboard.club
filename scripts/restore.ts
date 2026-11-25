// Loads a dump the backup job made (lib/backup.ts) into the database in DATABASE_URL: `pnpm restore <file>`, the file as
// `vercel blob get` saved it (docs/restore.md). The database must be migrated, at least as far as the dump's was, and
// empty: it is refused if it has anyone in it, or anything in a table the dump fills. Every row and sequence is restored,
// or, if anything fails, nothing is. Unlike the seed it is for a database that is not on this machine, the new one a
// restore goes to, whose address is given for this command alone: DATABASE_URL='<its address>' pnpm restore <file>.
import { readFileSync } from "node:fs";
import { LEFT_OUT, restoreDump, unpackDump } from "@/lib/backup";
import { db } from "@/lib/db";

const [file, ...rest] = process.argv.slice(2);
if (!file || rest.length > 0) {
  console.error("Usage: pnpm restore <file>, a dump the backup job made.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set: give the address of the empty, migrated database to restore into.");
  process.exit(1);
}

async function main(): Promise<number> {
  const dump = unpackDump(readFileSync(file));
  const restored = await restoreDump(dump);
  console.log(`Restored the dump taken at ${dump.takenAt}, rows by table:`);
  for (const { table, rows } of restored) console.log(`  ${table.padEnd(24)} ${rows}`);
  console.log(`No dump has these: ${Object.entries(LEFT_OUT).map(([table, why]) => `${table}, as ${why}`).join("; ")}.`);
  return 0;
}

main()
  .catch((error: Error) => {
    console.error(`Nothing was restored: ${error.message}`);
    return 1;
  })
  .then(async (code) => {
    await db.end();
    process.exit(code);
  });
