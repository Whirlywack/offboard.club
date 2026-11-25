// pnpm guards (scripts/guards.mjs): what a named change does to a file, which changes only the real-Postgres suites can
// judge, what it proposes, and how it reads a run of the tests. At the end the whole command runs in a small checkout of
// its own, whose `pnpm test` stands in for vitest.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { apply, confirmed, FAKE_REFUSES, hasSql, inSql, label, locate, namePattern, parse, parseErrors, propose, shown, verdict } from "./guards.mjs";

const TEXT = "one\ntwo\nthree\n";
type Edit = { first?: number; last?: number; replace?: string[] };
const at = (text: string, place: Edit) => locate(text, { first: undefined, last: undefined, replace: undefined, ...place });
const edit = (text: string, place: Edit) => {
  const where = at(text, place);
  return "problem" in where ? where.problem : apply(text, [where]);
};

describe("a place named", () => {
  it("is a line or lines, a replacement in them or in a whole file, and + joins two into one change", () => {
    expect(parse(["lib/a.ts:48"])).toEqual({ options: { pg: false, tests: [] }, changes: [[{ file: "lib/a.ts", first: 48, last: 48 }]] });
    const args = ["lib/a.ts:20-24", "lib/b.ts", "--replace", "x", "y", "+", "lib/fake-db.ts:3", "--tests", "app/t.test.ts", "--pg"];
    expect(parse(args)).toEqual({
      options: { pg: true, tests: ["app/t.test.ts"] },
      changes: [
        [{ file: "lib/a.ts", first: 20, last: 24 }],
        [
          { file: "lib/b.ts", first: undefined, last: undefined, replace: ["x", "y"] },
          { file: "lib/fake-db.ts", first: 3, last: 3 },
        ],
      ],
    });
  });

  it("refuses an option it does not know, a + or a --replace with nothing to join, and a second --replace", () => {
    for (const args of [["--bogus"], ["--tests"], ["+", "a.ts:1"], ["a.ts:1", "+"], ["a.ts:1", "+", "+", "b.ts:1"], ["--replace", "a", "b"]])
      expect(() => parse(args), args.join(" ")).toThrow(/^Usage: pnpm guards/);
    expect(() => parse(["a.ts:1", "--replace", "a"])).toThrow(/^Usage/);
    expect(() => parse(["a.ts:1", "--replace", "a", "b", "--replace", "c", "d"])).toThrow(/^Usage/);
  });
});

describe("a change to a file", () => {
  it("deletes the line or lines named, the last one too without its line break", () => {
    expect(edit(TEXT, { first: 2 })).toBe("one\nthree\n");
    expect(edit(TEXT, { first: 2, last: 3 })).toBe("one\n");
    expect(edit("a\nb", { first: 2 })).toBe("a\n");
  });

  it("replaces text that is in the place once, the place a line, lines or the whole file", () => {
    expect(edit(TEXT, { first: 2, replace: ["w", "W"] })).toBe("one\ntWo\nthree\n");
    expect(edit(TEXT, { first: 1, last: 2, replace: ["e\nt", "e t"] })).toBe("one two\nthree\n");
    expect(edit(TEXT, { replace: ["three", "3"] })).toBe("one\ntwo\n3\n");
  });

  it("is not made when the text is not in the place exactly once, the lines are not the file's, or no line is named", () => {
    expect(edit(TEXT, { first: 3, replace: ["e", "E"] })).toBe('"e" is there 2 times, not once');
    expect(edit(TEXT, { first: 2, replace: ["one", "1"] })).toBe('"one" is there 0 times, not once');
    expect(edit(TEXT, { first: 1, replace: ["three", "3"] })).toBe('"three" is there 0 times, not once');
    expect(edit(TEXT, { first: 2, replace: ["", "1"] })).toBe('"" is there 0 times, not once');
    for (const lines of [{ first: 4 }, { first: 0 }, { first: 3, last: 2 }]) expect(edit(TEXT, lines)).toBe("it has 3 lines");
    expect(edit(TEXT, {})).toBe("a whole file is not a guard: name a line, lines or --replace");
  });

  it("makes several edits at once, whatever their order, unless two overlap", () => {
    const edits = [at(TEXT, { first: 3 }), at(TEXT, { first: 1, replace: ["one", "1"] })];
    expect(apply(TEXT, edits as never)).toBe("1\ntwo\n");
    expect(apply(TEXT, [at(TEXT, { first: 1, last: 2 }), at(TEXT, { first: 2 })] as never)).toBeNull();
  });

  it("is shown as the whole lines before and after", () => {
    expect(shown(TEXT, at(TEXT, { first: 2 }) as never)).toBe("         - two");
    expect(shown(TEXT, at(TEXT, { first: 2, replace: ["w", "W"] }) as never)).toBe("         - two\n         + tWo");
  });

  it("is labelled as the command that makes it again", () => {
    const change = [{ file: "lib/a.ts", first: 48, last: 48, replace: ["now, by)", "now)"] }, { file: "lib/b.ts", first: 2, last: 4 }];
    expect(label(change)).toBe("lib/a.ts:48 --replace 'now, by)' 'now)' + lib/b.ts:2-4");
    expect(label([{ file: "app/p.tsx", replace: ["don't", "do"] }])).toBe("app/p.tsx --replace 'don'\\''t' do");
  });
});

describe("a change to SQL", () => {
  const code = 'const n = <p>Don\'t</p>;\nawait db.query(`select "id" from "user" where id = $1`, [id]);\nsay(`Season ${n} is where it was.`);\n';
  const MEMBER = 'export const MEMBER_SQL = `u."consentAt" is not null and u."rulesAt" is not null`;\n';

  it("is one inside a template literal holding a statement or a part of one", () => {
    expect(inSql("app/p.tsx", code, code.indexOf("where id"))).toBe(true);
    expect(inSql("lib/members.ts", MEMBER, MEMBER.indexOf("and"))).toBe(true);
  });

  it("is not one elsewhere: the code around it, or a sentence in a template literal", () => {
    expect(inSql("app/p.tsx", code, code.indexOf("await"))).toBe(false);
    expect(inSql("app/p.tsx", code, code.indexOf("where it"))).toBe(false);
  });

  it("is judged by the real-Postgres suites alone, as lib/fake-db.ts refuses a statement it was not written with in these words", () => {
    expect(readFileSync("lib/fake-db.ts", "utf8")).toContain(`throw new Error(\`${FAKE_REFUSES}: \${statement}\`)`);
  });
});

describe("the changes proposed", () => {
  const text = [
    "export async function act(id: string) {",
    "  await requireOrganiser();",
    '  if (!id) return refusal("no id");',
    '  const { rows } = await db.query(`select "x" from "y" where id = $1`, [id]);',
    "  if (rows.length > 1 ||",
    "      rows.length === 0) {",
    '    throw new Error("none");',
    "  }",
    "  return rows;",
    "}",
    "",
  ].join("\n");

  it("make an if's condition false, delete a sign-in or Member check, and make a where clause true for every row", () => {
    const changes = propose("lib/act.ts", text, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(changes.map(label)).toEqual([
      "lib/act.ts:2",
      "lib/act.ts:3 --replace 'if (!id)' 'if (false)'",
      "lib/act.ts:4 --replace 'where ' 'where true or '",
      "lib/act.ts:5-6 --replace 'if (rows.length > 1 ||\n      rows.length === 0)' 'if (false)'",
    ]);
    const made = changes.map(([change]) => apply(text, [at(text, change) as never]));
    expect(made[3]).toContain("  if (false) {\n    throw");
  });

  it("are only in the lines changed", () => {
    expect(propose("lib/act.ts", text, new Set([3, 9])).map(label)).toEqual(["lib/act.ts:3 --replace 'if (!id)' 'if (false)'"]);
  });
});

describe("a file", () => {
  it("holds SQL when a template literal in it does", () => {
    expect(hasSql("lib/a.ts", 'export const a = (db) => db.query(`delete from "t" where "x" = $1`, [1]);\n')).toBe(true);
    expect(hasSql("lib/b.ts", "export const b = (n) => `Season ${n} starts on Sunday.`;\n")).toBe(false);
    expect(hasSql("migrations/001_a.sql", "create table t (x int);\n")).toBe(false);
  });

  it("is broken by a change that a parser refuses: TypeScript's, or JSON's", () => {
    expect(parseErrors("lib/a.ts", "export function a() {\n  return 1;\n}\n")).toEqual([]);
    expect(parseErrors("lib/a.ts", "export function a() {\n  return 1;\n")).toEqual(["'}' expected."]);
    expect(parseErrors("vercel.json", '{ "crons": [] }')).toEqual([]);
    expect(parseErrors("vercel.json", '{ "crons": [ }')).toHaveLength(1);
    expect(parseErrors("migrations/001_a.sql", "create table")).toBeNull();
  });
});

describe("a run of the tests", () => {
  type Test = { status: string; fullName?: string; failureMessages?: string[]; ancestorTitles?: string[]; title?: string };
  const report = (files: { name?: string; status?: string; message?: string; tests: Test[] }[]) => ({
    testResults: files.map((file) => ({
      name: `/tmp/offboard-guards-x/checkout/${file.name ?? "app/a.test.ts"}`,
      status: file.status ?? "passed",
      message: file.message ?? "",
      assertionResults: file.tests.map((test) => ({ fullName: "it works", failureMessages: [], ...test })),
    })),
  });
  const passed = { status: "passed" };
  const skipped = { status: "skipped", fullName: "reads Postgres" };
  const failed = { status: "failed", fullName: "refuses a stranger", failureMessages: ["AssertionError: expected 200 to be 403"] };
  const refused = { status: "failed", fullName: "saves", failureMessages: [`Error: ${FAKE_REFUSES}: select 1`] };
  const slow = { status: "failed", fullName: "waits", failureMessages: ["Error: Test timed out in 5000ms."] };

  it("is red, to be run again without the change, when a test failed, even beside files the first failure cancelled", () => {
    const run = report([{ status: "failed", tests: [] }, { name: "app/b.test.ts", status: "failed", tests: [passed, failed] }]);
    expect(verdict(run, 1, false)).toEqual({ kind: "red", failed: [{ file: "app/b.test.ts", name: "refuses a stranger", path: "refuses a stranger" }] });
    const nested = report([{ tests: [{ ...failed, fullName: "a page refuses a stranger", ancestorTitles: ["a page"], title: "refuses a stranger" } as Test] }]);
    expect(verdict(nested, 1, false)).toMatchObject({ failed: [{ name: "a page refuses a stranger", path: "a page > refuses a stranger" }] });
    expect(verdict(report([{ tests: [refused, failed] }]), 1, false).kind).toBe("red");
  });

  it("is green when every test that ran passed, the real-Postgres suites' skipped as they are without a database", () => {
    expect(verdict(report([{ tests: [passed, passed] }]), 0, true)).toEqual({ kind: "green", why: "no test noticed: 2 passed" });
    expect(verdict(report([{ tests: [passed, skipped] }]), 0, false)).toEqual({ kind: "green", why: "no test noticed: 1 passed" });
  });

  it("judges nothing when a test was skipped where the real-Postgres suites ran, or none ran at all", () => {
    expect(verdict(report([{ tests: [passed, skipped] }]), 0, true)).toEqual({ kind: "unjudged", why: "1 tests were skipped, first: app/a.test.ts > reads Postgres" });
    expect(verdict(report([{ tests: [skipped] }]), 0, false)).toEqual({ kind: "unjudged", why: "no test ran" });
  });

  it("judges nothing when it failed outside any test, timed out, or did not finish", () => {
    expect(verdict(report([{ tests: [passed] }]), 1, false)).toEqual({ kind: "unjudged", why: "vitest failed the run with an error outside any test" });
    expect(verdict(report([{ tests: [passed, slow] }]), 1, false)).toEqual({ kind: "unjudged", why: "only by timing out, which load alone can do: app/a.test.ts > waits" });
    expect(verdict(null, null, false)).toEqual({ kind: "unjudged", why: "the tests did not finish within 5 minutes and were stopped" });
  });

  it("leaves to Postgres a run whose only failures are the fake's refusals, and is broken when a file no longer loads or there is no report", () => {
    expect(verdict(report([{ tests: [refused, refused] }]), 1, false)).toEqual({ kind: "refused" });
    const unloaded = report([{ status: "failed", message: "\x1b[31mTransform failed with 1 error:\x1b[0m\nmore", tests: [] }]);
    expect(verdict(unloaded, 1, false)).toEqual({ kind: "broken", why: "app/a.test.ts no longer loads: Transform failed with 1 error:" });
    expect(verdict(null, 1, false)).toEqual({ kind: "broken", why: "vitest wrote no report" });
  });

  it("is run again for exactly the tests that failed, by names as vitest matches them", () => {
    const root = mkdtempSync(join(tmpdir(), "offboard-guards-names-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const suite = 'describe("a page, for a stranger", () => {\n  it("refuses (once) [all] of it?", () => {});\n  it("refuses", () => {});\n});\n';
    writeFileSync(join(root, "a.test.ts"), `${suite}it("refuses (once) [all] of it?", () => {});\n`);
    const out = join(root, "report.json");
    const pattern = namePattern(["a page, for a stranger > refuses (once) [all] of it?"]);
    const args = ["run", "--root", root, "--globals", "--reporter=json", `--outputFile=${out}`, `--testNamePattern=${pattern}`];
    spawnSync(join(process.cwd(), "node_modules/.bin/vitest"), args, { cwd: root, encoding: "utf8" });
    const ran = JSON.parse(readFileSync(out, "utf8")).testResults.flatMap((file: { assertionResults: { fullName: string; status: string }[] }) =>
      file.assertionResults.map((test) => `${test.status} ${test.fullName}`),
    );
    expect(ran.sort()).toEqual(["passed a page, for a stranger refuses (once) [all] of it?", "skipped a page, for a stranger refuses", "skipped refuses (once) [all] of it?"]);
  });

  it("stays red only for the tests that pass without the change", () => {
    const red = { kind: "red", failed: [{ file: "app/a.test.ts", name: "refuses a stranger" }, { file: "app/a.test.ts", name: "it works" }] };
    const without = report([{ tests: [{ ...failed, status: "passed" }, { status: "failed", fullName: "it works" }] }]);
    expect(confirmed(red, without)).toEqual({ kind: "red", why: "1 failed with the change and pass without it, first: app/a.test.ts > refuses a stranger" });
    const unjudged = confirmed(red, report([{ tests: [failed, { status: "failed", fullName: "it works" }] }]));
    expect(unjudged).toEqual({
      kind: "unjudged",
      why: "what failed with the change fails without it too, so it says nothing of the change: app/a.test.ts > refuses a stranger; app/a.test.ts > it works",
    });
    expect(confirmed(red, null).kind).toBe("unjudged");
  });
});

// The checkout: lib/a.ts with a guard a test notices, one none does and a query; a real-Postgres suite beside it; lib/b.ts
// with neither SQL nor a suite beside it; a migration with a check; and a `pnpm test` that judges the copy as it is when
// it runs and writes vitest's JSON report, stopping at its first failure when given --bail. Its fast test fails as
// lib/fake-db.ts would when the statement is not the one it knows. `pnpm typecheck` refuses lib/a.ts returning a
// number, db:start refuses a migration that says "broken", and every script records how it was run in $FAKE_LOG.
// $FAKE_FAIL=all fails every test, and $FAKE_FAIL=again fails "refuses a stranger" on every run but the first.
const A = [
  "const WHERE = '\"x\" = $1';",
  "export function a(ok, db) {",
  '  if (!ok) return "refused";',
  '  if (ok === 2) return "two";',
  '  return db.query(`select 1 from "t" where ${WHERE}`, [ok]);',
  "}",
  "",
].join("\n");
const B = ["export function b(n) {", "  if (n > 9) return 9;", "  return n;", "}", ""].join("\n");
const MIGRATION = "create table t (x int check (x > 0));\n";
const FAKE = [
  'import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
  "const [name, ...args] = process.argv.slice(2);",
  'appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, args, postgres: process.env.ALLOW_DB_TESTS === "1", url: process.env.DATABASE_URL ?? null, tmp: process.env.TMPDIR }) + "\\n");',
  'const dir = args[args.indexOf("--dir") + 1];',
  'const migration = readFileSync("migrations/001_a.sql", "utf8");',
  'if (name === "db:start") {',
  "  mkdirSync(dir, { recursive: true });",
  '  writeFileSync(dir + "/offboard.env", "DATABASE_URL=postgres://offboard@127.0.0.1:1/" + dir.split("/").pop() + "\\n");',
  '  writeFileSync(dir + "/postmaster.pid", "1\\n");',
  '  writeFileSync(dir + "/migrated.sql", migration);',
  '  process.exit(migration.includes("broken") ? 1 : 0);',
  "}",
  'if (name === "db:stop") rmSync(dir + "/postmaster.pid");',
  `if (name === "typecheck" && readFileSync("lib/a.ts", "utf8").includes("return 2;")) { console.log("lib/a.ts(4,25): error TS2322: Type 'number' is not assignable to type 'string'."); process.exit(2); }`,
  'if (name === "test") {',
  '  const code = readFileSync("lib/a.ts", "utf8") + readFileSync("lib/b.ts", "utf8");',
  `  const known = code.includes(${JSON.stringify(A.split("\n")[0])}) && code.includes(${JSON.stringify("where ${WHERE}")});`,
  '  const counter = process.env.TMPDIR + "/runs";',
  "  const runs = existsSync(counter) ? Number(readFileSync(counter, \"utf8\")) + 1 : 1;",
  "  writeFileSync(counter, String(runs));",
  '  const broken = process.env.FAKE_FAIL === "all" || (process.env.FAKE_FAIL === "again" && runs > 1);',
  '  const filters = args.filter((arg) => !arg.startsWith("--"));',
  "  const ran = (file) => filters.length === 0 || filters.includes(file);",
  "  const tests = [];",
  '  const guarded = !broken && /if \\(!ok[^)]*\\) return "refused";/.test(code);',
  '  if (ran("app/a.test.ts")) tests.push(["app/a.test.ts", "refuses a stranger", guarded ? null : "AssertionError: expected \'two\' to be \'refused\'"]);',
  `  if (ran("app/a.test.ts")) tests.push(["app/a.test.ts", "reads the row", known ? null : ${JSON.stringify(`Error: ${FAKE_REFUSES}: select 1`)}]);`,
  '  if (ran("app/a.test.ts")) tests.push(["app/a.test.ts", "counts", null]);',
  '  const postgres = process.env.ALLOW_DB_TESTS === "1";',
  '  const migrated = postgres ? readFileSync(process.cwd() + "/../" + process.env.DATABASE_URL.split("/").pop() + "/migrated.sql", "utf8") : "";',
  '  if (ran("lib/a.postgres.test.ts")) tests.push(["lib/a.postgres.test.ts", "finds only its row", !postgres ? "skipped" : known ? null : "AssertionError: expected 2 rows to be 1"]);',
  '  if (ran("lib/a.postgres.test.ts")) tests.push(["lib/a.postgres.test.ts", "refuses a negative x", !postgres ? "skipped" : migrated.includes("check (x > 0)") ? null : "AssertionError: expected the insert to be refused"]);',
  '  const first = tests.findIndex(([, , why]) => why && why !== "skipped");',
  '  const done = args.includes("--bail=1") && first !== -1 ? tests.slice(0, first + 1) : tests;',
  '  const status = (why) => (why === null ? "passed" : why === "skipped" ? "skipped" : "failed");',
  "  const results = (file) => done.filter(([f]) => f === file).map(([, title, why]) => ({ fullName: title, status: status(why), failureMessages: why && why !== \"skipped\" ? [why] : [] }));",
  '  const files = [...new Set(done.map(([file]) => file))].map((file) => ({ name: process.cwd() + "/" + file, status: "passed", message: "", assertionResults: results(file) }));',
  '  writeFileSync(args.find((arg) => arg.startsWith("--outputFile=")).split("=")[1], JSON.stringify({ testResults: files }));',
  "  process.exit(first === -1 ? 0 : 1);",
  "}",
  "",
].join("\n");

// Runs `file` as a child process without holding up the tests running beside it, and gives how it ended.
const exec = (file: string, args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(file, args, { env });
    let [stdout, stderr] = ["", ""];
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => done({ status, stdout, stderr }));
  });

// Removed when the test that made it ends (`finished`, its own onTestFinished), passed or failed.
function fakeCheckout(finished: (end: () => void) => void) {
  const root = mkdtempSync(join(tmpdir(), "offboard-guards-test-"));
  finished(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "lib", "app", "migrations", "tmp"]) mkdirSync(join(root, dir));
  for (const script of ["guards.mjs", "check.mjs", "local-db.mjs"]) copyFileSync(`scripts/${script}`, join(root, "scripts", script));
  const scripts = Object.fromEntries(["test", "typecheck", "db:start", "db:stop"].map((name) => [name, `node fake.mjs ${name}`]));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fake", private: true, scripts }));
  writeFileSync(join(root, "fake.mjs"), FAKE);
  writeFileSync(join(root, "lib/a.ts"), A);
  writeFileSync(join(root, "lib/b.ts"), B);
  writeFileSync(join(root, "migrations/001_a.sql"), MIGRATION);
  writeFileSync(join(root, "lib/a.postgres.test.ts"), "// the real-Postgres suite, in fake.mjs\n");
  writeFileSync(join(root, "app/a.test.ts"), "// the fast test, in fake.mjs\n");
  // guards.mjs reads TypeScript from node_modules; the copy it makes has an install of its own.
  writeFileSync(join(root, ".gitignore"), "node_modules\ntmp\nfake.log\n");
  symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"));
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.name=Pretend", "-c", "user.email=pretend@pretend.invalid", ...args], { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "--message", "first");
  const env = { ...process.env, DATABASE_URL: "", ALLOW_DB_TESTS: "", TMPDIR: join(root, "tmp"), FAKE_LOG: join(root, "fake.log") };
  const guards = (args: string[], more: Record<string, string> = {}) => exec(process.execPath, [join(root, "scripts/guards.mjs"), ...args], { ...env, ...more });
  const runs = () =>
    readFileSync(join(root, "fake.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; args: string[]; postgres: boolean; url: string | null; tmp: string });
  const tests = () => runs().filter((run) => run.name === "test");
  const filters = () => tests().map((run) => [run.args.includes("--bail=1") ? "bail" : "all", ...run.args.filter((arg) => !arg.startsWith("--"))].join(" "));
  // What is left: guards' folders in the temporary folder, git's status, and the files.
  const left = () => [
    readdirSync(join(root, "tmp")).filter((name) => name.startsWith("offboard-")),
    git("status", "--porcelain").stdout,
    readFileSync(join(root, "lib/a.ts"), "utf8") + readFileSync(join(root, "lib/b.ts"), "utf8") + readFileSync(join(root, "migrations/001_a.sql"), "utf8"),
  ];
  const AS_IT_WAS = [[], "", A + B + MIGRATION];
  return { root, git, guards, runs, tests, filters, left, AS_IT_WAS };
}
const POSTGRES = "on the fast tests and the real-Postgres suites";
const ALONE = "on the real-Postgres suites alone, as lib/fake-db.ts refuses a changed statement";

describe.concurrent("a run of pnpm guards", () => {
  it("says which changes went red, naming the tests that pass without them, judges SQL by the real-Postgres suites alone, and leaves the checkout as it was", async ({ onTestFinished }) => {
    const { guards, runs, filters, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const places = ["lib/a.ts:3", "lib/a.ts:4", "lib/a.ts:5", "--replace", "where ${WHERE}", "where true", "lib/a.ts:1", "--replace", '"x" = $1', "true"];
    const { status, stdout } = await guards(places);
    expect(stdout).toContain("The tests pass as the code is (the whole suite with the real-Postgres suites: 5 passed).");
    const noticed = (test: string) => `1 failed with the change and pass without it, first: ${test}`;
    expect(stdout).toContain(`RED       lib/a.ts:3\n         - if (!ok) return "refused";\n         ${noticed("app/a.test.ts > refuses a stranger")}, ${POSTGRES}\n`);
    expect(stdout).toContain(`GREEN     lib/a.ts:4\n         - if (ok === 2) return "two";\n         no test noticed: 5 passed, ${POSTGRES}\n`);
    expect(stdout).toContain(`RED       lib/a.ts:5 --replace 'where \${WHERE}' 'where true'\n`);
    const one = `RED       lib/a.ts:1 --replace '"x" = $1' true\n         - const WHERE = '"x" = $1';\n         + const WHERE = 'true';\n`;
    expect(stdout).toContain(`${one}         ${noticed("lib/a.postgres.test.ts > finds only its row")}, ${ALONE}\n`);
    expect(stdout).toContain("3 of 4 changes went red.\nNo test noticed: lib/a.ts:4.\n");
    expect(status).toBe(1);
    // Every red run is run again on the failing file without the change. The change inside the template literal goes to
    // the real-Postgres suite at once; the one outside it, once the fast tests have failed on the fake's refusal alone.
    expect(filters()).toEqual([
      "bail",
      "bail",
      "all app/a.test.ts",
      "bail",
      "bail lib/a.postgres.test.ts",
      "all lib/a.postgres.test.ts",
      "bail",
      "bail lib/a.postgres.test.ts",
      "all lib/a.postgres.test.ts",
    ]);
    expect(runs().filter((run) => run.name.startsWith("db:")).map((run) => run.name)).toEqual(["db:start", "db:stop"]);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("judges nothing by a test that fails without the change too", async ({ onTestFinished }) => {
    const { guards, filters, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const { status, stdout } = await guards(["lib/b.ts:2"], { FAKE_FAIL: "again" });
    expect(stdout).toContain(
      "UNJUDGED  lib/b.ts:2\n         - if (n > 9) return 9;\n         what failed with the change fails without it too, so it says nothing of the change: app/a.test.ts > refuses a stranger, on the fast tests only: no real-Postgres suite ran\n",
    );
    expect(stdout).toContain("0 of 1 changes went red.\nNot judged: lib/b.ts:2.\n");
    expect(status).toBe(1);
    expect(filters()).toEqual(["bail", "bail", "all app/a.test.ts"]);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("calls broken, and runs no test for, a change that does not parse or that TypeScript refuses", async ({ onTestFinished }) => {
    const { guards, filters, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const { status, stdout } = await guards(["lib/a.ts:6", "lib/a.ts:4", "--replace", '"two"', "2"]);
    expect(stdout).toContain("BROKEN    lib/a.ts:6\n         - }\n         lib/a.ts no longer parses: '}' expected.\n");
    expect(stdout).toContain(
      "BROKEN    lib/a.ts:4 --replace '\"two\"' 2\n         - if (ok === 2) return \"two\";\n         + if (ok === 2) return 2;\n         TypeScript refuses the change, as CI's typecheck would: lib/a.ts(4,25): error TS2322: Type 'number' is not assignable to type 'string'.\n",
    );
    expect(stdout).toContain("0 of 2 changes went red.\nBroken: lib/a.ts:6; lib/a.ts:4 --replace '\"two\"' 2.\n");
    expect(status).toBe(1);
    expect(filters()).toEqual(["bail"]);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("judges a change to a migration on a database migrated afresh with it, and one that does not apply as broken", async ({ onTestFinished }) => {
    const { guards, runs, filters, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const { status, stdout } = await guards(["migrations/001_a.sql", "--replace", "check (x > 0)", "check (true)", "migrations/001_a.sql:1", "--replace", "int", "broken"]);
    expect(stdout).toContain(
      "RED       migrations/001_a.sql --replace 'check (x > 0)' 'check (true)'\n         - create table t (x int check (x > 0));\n         + create table t (x int check (true));\n         1 failed with the change and pass without it, first: lib/a.postgres.test.ts > refuses a negative x, on the real-Postgres suites alone, on a database migrated afresh with the change\n",
    );
    expect(stdout).toContain("BROKEN    migrations/001_a.sql:1 --replace int broken\n");
    expect(stdout).toContain("the changed migrations do not apply to an empty database (pnpm db:start failed)\n");
    expect(status).toBe(1);
    const databases = runs().filter((run) => run.name === "db:start").map((run) => run.args.at(-1)!.split("/").pop());
    expect(databases).toEqual(["db-tests-1", "db-change-1-1", "db-change-2-1"]);
    // The change is judged on its own database; the test that noticed it, again on the one migrated without it.
    const urls = runs().filter((run) => run.name === "test").map((run) => run.url?.split("/").pop());
    expect(urls).toEqual(["db-tests-1", "db-change-1-1", "db-tests-1"]);
    expect(filters()).toEqual(["bail", "bail lib/a.postgres.test.ts", "all lib/a.postgres.test.ts"]);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("runs the real-Postgres suites for every change with --pg, puts each file back before the next change, and exits 0 when every change went red", async ({ onTestFinished }) => {
    const { guards, tests, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const { status, stdout } = await guards(["lib/b.ts:2", "--pg"]);
    expect(stdout).toContain(`GREEN     lib/b.ts:2\n         - if (n > 9) return 9;\n         no test noticed: 5 passed, ${POSTGRES}\n`);
    expect(status).toBe(1);
    expect(tests().every((run) => run.postgres)).toBe(true);
    // Had lib/a.ts not been put back, the change to lib/b.ts after it would not have been green.
    const both = await fakeCheckout(onTestFinished).guards(["lib/a.ts:3", "lib/b.ts:2"]);
    expect(both.stdout).toContain("GREEN     lib/b.ts:2\n");
    const red = await fakeCheckout(onTestFinished).guards(["lib/a.ts:3"]);
    expect(red.stdout).toContain("1 of 1 changes went red.\n");
    expect(red.status).toBe(0);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("gives the tests neither the caller's DATABASE_URL nor ALLOW_DB_TESTS, but a TMPDIR in its own folder, and refuses a DATABASE_URL not on this machine", async ({ onTestFinished }) => {
    const { root, guards, tests, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const local = await guards(["lib/b.ts:2"], { DATABASE_URL: "postgres://offboard@127.0.0.1:1/somebody_else", ALLOW_DB_TESTS: "1" });
    expect(local.stdout).toContain("on the fast tests only: no real-Postgres suite ran");
    expect(tests().map((run) => [run.postgres, run.url])).toEqual([
      [false, null],
      [false, null],
    ]);
    expect(tests().every((run) => run.tmp.startsWith(join(realpathSync(join(root, "tmp")), "offboard-guards-")))).toBe(true);
    const real = await guards(["lib/b.ts:2"], { DATABASE_URL: "postgres://someone:a-pretend-password@ep-pretend-123.eu-central-1.aws.neon.tech/neondb" });
    expect(real.stderr.trim()).toBe(
      "Refusing to run beside a real DATABASE_URL in the environment: DATABASE_URL's host is ep-pretend-123.eu-central-1.aws.neon.tech, not this machine (localhost, 127.0.0.1 or ::1). Unset it first.",
    );
    expect(real.status).toBe(1);
    expect(tests()).toHaveLength(2);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("judges nothing when the tests fail before any change", async ({ onTestFinished }) => {
    const { guards, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const { status, stdout, stderr } = await guards(["lib/a.ts:3"], { FAKE_FAIL: "all" });
    expect(stderr.trim()).toBe("The tests do not pass before any change, so no change can be judged: 1 failed, first: app/a.test.ts > refuses a stranger");
    expect(stdout).not.toMatch(/^(RED|GREEN)/m);
    expect(status).toBe(1);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("makes no change that is not in the file once, overlaps or changes nothing, nor one to SQL that --tests leaves to the fast tests, and needs no database then", async ({ onTestFinished }) => {
    const { guards, runs, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const places = ["lib/a.ts:9", "lib/none.ts:1", "lib/a.ts:3", "--replace", "nothing", "x", "lib/a.ts:5", "--replace", "where ${WHERE}", "where true"];
    const more = ["lib/a.ts:3", "+", "lib/a.ts:3-4", "lib/a.ts:4", "--replace", '"two"', '"two"'];
    const { status, stdout } = await guards([...places, ...more, "--tests", "app/a.test.ts"]);
    expect(stdout).toContain("NOT MADE  lib/a.ts:9\n         lib/a.ts: it has 6 lines\n");
    expect(stdout).toContain("NOT MADE  lib/none.ts:1\n         lib/none.ts: there is no such file\n");
    expect(stdout).toContain('NOT MADE  lib/a.ts:3 --replace nothing x\n         lib/a.ts: "nothing" is there 0 times, not once\n');
    expect(stdout).toContain("a change to SQL is judged by the real-Postgres suites, and none of the --tests is one");
    expect(stdout).toContain("NOT MADE  lib/a.ts:3 + lib/a.ts:3-4\n         lib/a.ts: two of the edits overlap\n");
    expect(stdout).toContain("lib/a.ts: the edit changes nothing\n");
    expect(stdout).toContain("0 of 6 changes went red.");
    expect(status).toBe(1);
    expect(runs().map((run) => run.name)).toEqual(["test"]);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("refuses --tests that names no file", async ({ onTestFinished }) => {
    const { guards, left, AS_IT_WAS } = fakeCheckout(onTestFinished);
    const { status, stderr } = await guards(["lib/a.ts:3", "--tests", "app/none.test.ts"]);
    expect(stderr.trim()).toBe("--tests app/none.test.ts: there is no such file.");
    expect(status).toBe(1);
    expect(left()).toEqual(AS_IT_WAS);
  }, 60_000);

  it("proposes changes for the lines changed since origin/main when no place is named, never exits 0 then, and ends saying it judged only those", async ({ onTestFinished }) => {
    const { root, git, guards, left } = fakeCheckout(onTestFinished);
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    const none = await guards([]);
    expect(none.stdout).toMatch(/^No places were named, so 0 changes are proposed for the lines changed since origin\/main\.\nThese were only proposals/);
    expect(none.status).toBe(1);
    const changed = A.replace("  if (ok === 2)", '  if (ok === 3) return "three";\n  if (ok === 2)').replace("  if (!ok)", "  if (!ok || ok < 0)");
    writeFileSync(join(root, "lib/a.ts"), changed);
    const { status, stdout } = await guards([]);
    expect(stdout).toMatch(/^No places were named, so 2 changes are proposed for the lines changed since origin\/main\.\n/);
    expect(stdout).toContain("RED       lib/a.ts:3 --replace 'if (!ok || ok < 0)' 'if (false)'\n");
    expect(stdout).toContain("GREEN     lib/a.ts:4 --replace 'if (ok === 3)' 'if (false)'\n");
    expect(stdout.trim().split("\n").at(-1)).toBe(
      "These were only proposals, made by a few patterns: they judge no guard they did not name. Name each guard the branch adds or touches: pnpm guards <file>:<line>.",
    );
    expect(status).toBe(1);
    expect(left()).toEqual([[], " M lib/a.ts\n", changed + B + MIGRATION]);
  }, 60_000);
});
