// pnpm check (scripts/check.mjs): it refuses a checkout with real settings before it does anything, runs every step in a
// copy and reports each, fails on a test that failed or was skipped, seeds as CI does, and leaves nothing behind. The
// whole command runs here in a small checkout of its own whose package.json scripts stand in for the real ones.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { SCENARIOS, seedSettings, testTally } from "./check.mjs";

// A checkout holding scripts/check.mjs and scripts/local-db.mjs, and a temporary folder of its own for check to use,
// removed when the test ends, passed or failed.
function checkout() {
  const root = mkdtempSync(join(tmpdir(), "offboard-check-test-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "tmp"));
  for (const script of ["check.mjs", "local-db.mjs"]) copyFileSync(`scripts/${script}`, join(root, "scripts", script));
  return root;
}
const check = (root: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [join(root, "scripts/check.mjs")], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "", TMPDIR: join(root, "tmp"), ...env } });

describe("a checkout whose .env.local holds real settings", () => {
  it("is refused before anything is copied or started", () => {
    const root = checkout();
    writeFileSync(join(root, ".env.local"), "DATABASE_URL=postgres://someone:a-pretend-password@ep-pretend-123.eu-central-1.aws.neon.tech/neondb\n");
    const { status, stdout, stderr } = check(root);
    const left = readdirSync(join(root, "tmp")).filter((name) => name.startsWith("offboard-"));
    expect(stderr.trim()).toMatch(/^This checkout's \.env\.local holds real settings/);
    expect(stdout).toBe("");
    expect(status).toBe(1);
    expect(left).toEqual([]);
  });
});

// Each script records how it was run in $FAKE_LOG and fails when $FAKE_FAIL names it. db:start makes a folder as
// db:start does, with offboard.env and a postmaster.pid, and gives the checkout a .env.local; its first try in a folder
// for the tests' database loses its ports, as when two checks start at once.
const FAKE = `
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
const [name, ...args] = process.argv.slice(2);
const fail = (process.env.FAKE_FAIL ?? "").split(",").includes(name);
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, args, env: process.env, envLocal: existsSync(".env.local") }) + "\\n");
const dir = args[args.indexOf("--dir") + 1];
if (name === "db:start") {
  if (dir.endsWith("tests-1")) process.exit(1);
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + "/offboard.env", "DATABASE_URL=postgres://offboard@127.0.0.1:1/" + dir.split("/").pop() + "\\n");
  writeFileSync(dir + "/postmaster.pid", "1\\n");
  if (!existsSync(".env.local")) writeFileSync(".env.local", "DATABASE_URL=pretend\\n");
}
if (name === "db:stop") rmSync(dir + "/postmaster.pid");
if (name === "test") {
  const out = args.find((arg) => arg.startsWith("--outputFile.json=")).split("=")[1];
  const status = fail ? "failed" : process.env.FAKE_FAIL === "skip" ? "skipped" : "passed";
  const results = [{ name: process.cwd() + "/lib/a.test.ts", status: "passed", message: "", assertionResults: [{ status, fullName: "it works" }] }];
  writeFileSync(out, JSON.stringify({ testResults: results }));
}
if (name === "seed") console.log((fail ? 2 : 3) + ' of 3 states the "' + args[0] + '" scenario promises are there.');
process.exit(fail ? 1 : 0);
`;

function fakeCheckout() {
  const root = checkout();
  const scripts = Object.fromEntries(["lint", "typecheck", "test", "build", "seed", "db:start", "db:stop"].map((name) => [name, `node fake.mjs ${name}`]));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fake", private: true, scripts }));
  writeFileSync(join(root, "fake.mjs"), FAKE);
  mkdirSync(join(root, "migrations"));
  writeFileSync(join(root, "migrations/001_first.sql"), "create table a (b int);\n");
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=Pretend", "-c", "user.email=pretend@pretend.invalid", ...args], { cwd: root });
  git("init", "--quiet");
  git("add", "package.json", "fake.mjs", "migrations", "scripts");
  git("commit", "--quiet", "--message", "first");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}
const runs = (log: string) =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { name: string; args: string[]; env: Record<string, string>; envLocal: boolean });

describe("a check", () => {
  it("passes when every step does, and reports each with the tallies, the databases stopped and the copy removed", () => {
    const root = fakeCheckout();
    const log = join(root, "fake.log");
    const { status, stdout } = check(root, { FAKE_LOG: log });
    const summary = stdout.slice(stdout.indexOf("\npnpm check "));
    expect(summary).toMatch(/^\npnpm check passed, in \d+ s\./);
    expect(summary).toContain("✓ migrations: none that has merged was edited");
    expect(summary).toContain("✓ tests: 1 files, 1 tests: 1 passed, 0 failed, 0 skipped; 0 of the files real-Postgres suites (0 tests)");
    expect(summary).toContain("✓ seeds: club 3 of 3 states, season-over 3 of 3 states, empty 3 of 3 states");
    expect(status).toBe(0);
    const ran = runs(log);
    expect(ran.map((run) => run.name)).toEqual(["db:start", "db:start", "db:start", "lint", "typecheck", "test", "build", "seed", "seed", "seed", "db:stop", "db:stop"]);
    const stopped = ran.filter((run) => run.name === "db:stop").map((run) => run.args.at(-1)!.split("/").pop());
    expect(stopped.sort()).toEqual(["db-seeded-1", "db-tests-2"]);
    const test = ran.find((run) => run.name === "test")!;
    expect([test.env.ALLOW_DB_TESTS, test.env.DATABASE_URL]).toEqual(["1", "postgres://offboard@127.0.0.1:1/db-tests-2"]);
    for (const seed of ran.filter((run) => run.name === "seed")) {
      expect(seed.env.DATABASE_URL).toBe("postgres://offboard@127.0.0.1:1/db-seeded-1");
      expect(seed.env).toMatchObject({ BETTER_AUTH_URL: "http://localhost:3100", LICHESS_TEAM_ID: "pretend-team", ORGANISER_USER_ID: "org" });
    }
    // CI has no .env.local: the one db:start gave the copy is gone before anything reads it.
    expect(ran.filter((run) => run.name !== "db:start").some((run) => run.envLocal)).toBe(false);
    expect(existsSync(join(root, ".env.local"))).toBe(false);
    expect(readdirSync(join(root, "tmp")).filter((name) => name.startsWith("offboard-"))).toEqual([]);
  }, 60_000);

  it("fails when any step does, runs the others, and says which failed, a skipped test among them", () => {
    const root = fakeCheckout();
    const { status, stdout } = check(root, { FAKE_LOG: join(root, "fake.log"), FAKE_FAIL: "lint,build,seed" });
    expect(stdout).toContain("\npnpm check failed: lint, build, seeds, in ");
    expect(stdout).toContain("✓ typecheck\n");
    expect(stdout).toContain("✗ seeds: club 2 of 3 states, season-over 2 of 3 states, empty 2 of 3 states");
    expect(status).toBe(1);
    const skipped = check(root, { FAKE_LOG: join(root, "fake.log"), FAKE_FAIL: "skip" });
    expect(skipped.stdout).toContain("\npnpm check failed: tests, in ");
    expect(skipped.stdout).toContain("skipped, which a check may not: lib/a.test.ts > it works");
    expect(skipped.status).toBe(1);
    expect(readdirSync(join(root, "tmp")).filter((name) => name.startsWith("offboard-"))).toEqual([]);
  }, 60_000);

  it("fails when a merged migration was edited, and runs nothing that needs a database it could not start", () => {
    const root = fakeCheckout();
    writeFileSync(join(root, "migrations/001_first.sql"), "create table a (b text);\n");
    const { status, stdout } = check(root, { FAKE_LOG: join(root, "fake.log"), FAKE_FAIL: "db:start" });
    expect(stdout).toContain("a merged migration was edited, renamed or removed; add a new one instead:\n    M\tmigrations/001_first.sql");
    expect(stdout).toContain("\npnpm check failed: migrations, empty databases, tests, seeds, in ");
    expect(stdout).toContain("  ✗ tests: not run\n  ✗ seeds: not run");
    expect(status).toBe(1);
    expect(readdirSync(join(root, "tmp")).filter((name) => name.startsWith("offboard-"))).toEqual([]);
  }, 60_000);
});

describe("the tests' report", () => {
  const file = (name: string, statuses: string[], extra = {}) => ({
    name: `/tmp/offboard-check-x/checkout/${name}`,
    status: "passed",
    message: "",
    assertionResults: statuses.map((status, i) => ({ status, fullName: `test ${i}` })),
    ...extra,
  });

  it("is tallied, the real-Postgres suites apart", () => {
    const report = { testResults: [file("app/a.test.ts", ["passed", "passed"]), file("lib/b.postgres.test.ts", ["passed"])] };
    expect(testTally(report)).toEqual({
      problem: null,
      line: "2 files, 3 tests: 3 passed, 0 failed, 0 skipped; 1 of the files real-Postgres suites (1 tests)",
    });
  });

  it("fails the check when a test was skipped, as a real-Postgres suite is without its database", () => {
    const report = { testResults: [file("app/a.test.ts", ["passed"]), file("lib/b.postgres.test.ts", ["skipped", "skipped"])] };
    expect(testTally(report).problem).toBe("skipped, which a check may not: lib/b.postgres.test.ts > test 0; lib/b.postgres.test.ts > test 1");
    expect(testTally({ testResults: [file("app/a.test.ts", ["todo"])] }).problem).toMatch(/^skipped/);
  });

  it("fails the check when a test failed, a file did not load, or there is no report", () => {
    expect(testTally({ testResults: [file("app/a.test.ts", ["passed", "failed"])] }).problem).toBe("failed: app/a.test.ts > test 1");
    expect(testTally({ testResults: [file("app/a.test.ts", [], { status: "failed", message: "Transform failed" })] }).problem).toBe(
      "app/a.test.ts did not load",
    );
    expect(testTally(null).problem).toBe("vitest wrote no report");
  });
});

describe("the seeds", () => {
  it("are CI's three scenarios, with CI's settings", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain(`for scenario in ${SCENARIOS.join(" ")}; do pnpm seed "$scenario"; done`);
    const settings: Record<string, string> = seedSettings();
    for (const name of ["BETTER_AUTH_URL", "LICHESS_TEAM_ID", "ORGANISER_USER_ID"]) expect(ci).toContain(`${name}: ${settings[name]}\n`);
    expect(ci).toContain('export BETTER_AUTH_SECRET="$(openssl rand -base64 32)" LICHESS_TOKEN_KEY="$(openssl rand -base64 32)"');
    for (const name of ["BETTER_AUTH_SECRET", "LICHESS_TOKEN_KEY"]) expect(Buffer.from(settings[name], "base64")).toHaveLength(32);
  });
});
