// pnpm check (scripts/check.mjs): it refuses a checkout with real settings before it does anything, fails on a test
// that failed or was skipped, and seeds as CI does.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCENARIOS, seedSettings, testTally } from "./check.mjs";

describe("a checkout whose .env.local holds real settings", () => {
  it("is refused before anything is copied or started", () => {
    const root = mkdtempSync(join(tmpdir(), "offboard-check-refused-"));
    mkdirSync(join(root, "scripts"));
    for (const script of ["check.mjs", "local-db.mjs"]) copyFileSync(`scripts/${script}`, join(root, "scripts", script));
    writeFileSync(join(root, ".env.local"), "DATABASE_URL=postgres://someone:a-pretend-password@ep-pretend-123.eu-central-1.aws.neon.tech/neondb\n");
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith("offboard-check-") && !name.startsWith("offboard-check-refused-"));
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(root, "scripts/check.mjs")], { encoding: "utf8" });
    rmSync(root, { recursive: true });
    expect(stderr.trim()).toMatch(/^This checkout's \.env\.local holds real settings/);
    expect(stdout).toBe("");
    expect(status).toBe(1);
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith("offboard-check-") && !name.startsWith("offboard-check-refused-"));
    expect(after.filter((name) => !before.includes(name))).toEqual([]);
  });
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
