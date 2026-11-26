// `pnpm restore <file>` (scripts/restore.ts) refusing, before it connects to anything, what it cannot restore: no file,
// more than one, no database, and a file that is not a dump. lib/backup.postgres.test.ts restores real dumps.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

// Every temporary folder a test makes, removed once the tests have run, failed or not, and then checked to be gone.
const temporary: string[] = [];
afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
  expect(temporary.filter((dir) => existsSync(dir))).toEqual([]);
});

// Nothing listens here, so a run that got as far as connecting would fail otherwise.
const NOWHERE = "postgres://offboard@127.0.0.1:1/offboard";

const restore = (args: string[], env: Record<string, string | undefined> = { DATABASE_URL: NOWHERE }) => {
  const { status, stdout, stderr } = spawnSync("node_modules/.bin/tsx", ["scripts/restore.ts", ...args], { env: { ...process.env, DATABASE_URL: undefined, ...env }, encoding: "utf8" });
  return [status, stdout, stderr.trim()];
};

describe("pnpm restore", () => {
  it("refuses no file, two, and no database to restore into", () => {
    expect(restore([])).toEqual([1, "", "Usage: pnpm restore <file>, a dump the backup job made."]);
    expect(restore(["a", "b"])).toEqual([1, "", "Usage: pnpm restore <file>, a dump the backup job made."]);
    expect(restore(["a"], {})).toEqual([1, "", "DATABASE_URL is not set: give the address of the empty, migrated database to restore into."]);
  }, 30_000);

  it("refuses a file that isn't a dump the backup job made, restoring nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "offboard-restore-"));
    temporary.push(dir);
    writeFileSync(join(dir, "other.json.gz"), gzipSync(JSON.stringify({ tables: {} })));
    expect(restore([join(dir, "other.json.gz")])).toEqual([1, "", "Nothing was restored: That file isn't a dump the backup job made."]);
  }, 30_000);
});
