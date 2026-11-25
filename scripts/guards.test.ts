// pnpm guards (scripts/guards.mjs): what a named change does to a file, which changes only the real-Postgres suites can
// judge, what it proposes, and how it reads a run of the tests. At the end the whole command runs in a small checkout of
// its own, whose `pnpm test` stands in for vitest.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { apply, FAKE_REFUSES, inSql, label, locate, parse, propose, shown, verdict } from "./guards.mjs";

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

describe("a run of the tests", () => {
  type Test = { status: string; fullName?: string; failureMessages?: string[] };
  const report = (files: { name?: string; status?: string; message?: string; tests: Test[] }[]) => ({
    numPassedTests: files.flatMap((file) => file.tests).filter((test) => test.status === "passed").length,
    testResults: files.map((file) => ({
      name: `/tmp/offboard-guards-x/checkout/${file.name ?? "app/a.test.ts"}`,
      status: file.status ?? "passed",
      message: file.message ?? "",
      assertionResults: file.tests.map((test) => ({ fullName: "it works", failureMessages: [], ...test })),
    })),
  });
  const passed = { status: "passed" };
  const failed = { status: "failed", fullName: "refuses a stranger", failureMessages: ["AssertionError: expected 200 to be 403"] };
  const refused = { status: "failed", fullName: "saves", failureMessages: [`Error: ${FAKE_REFUSES}: select 1`] };

  it("is red when a test failed, naming it, even beside files the first failure cancelled", () => {
    const run = report([{ status: "failed", tests: [] }, { name: "app/b.test.ts", status: "failed", tests: [passed, failed] }]);
    expect(verdict(run, 1)).toEqual({ kind: "red", why: "1 failed, first: app/b.test.ts > refuses a stranger" });
    expect(verdict(report([{ tests: [refused, failed] }]), 1).kind).toBe("red");
  });

  it("is red when it failed outside any test, or did not finish", () => {
    expect(verdict(report([{ tests: [passed] }]), 1)).toEqual({ kind: "red", why: "vitest failed the run with an error outside any test" });
    expect(verdict(null, null).kind).toBe("red");
  });

  it("is green when every test passed", () => {
    expect(verdict(report([{ tests: [passed, passed] }]), 0)).toEqual({ kind: "green", why: "no test noticed: 2 passed" });
  });

  it("cannot judge when the only failures are the fake's refusals of a statement, a file no longer loads, or there is no report", () => {
    expect(verdict(report([{ tests: [refused, refused] }]), 1)).toEqual({ kind: "refused" });
    const unloaded = report([{ status: "failed", message: "\x1b[31mTransform failed with 1 error:\x1b[0m\nmore", tests: [] }]);
    expect(verdict(unloaded, 1)).toEqual({ kind: "broken", why: "app/a.test.ts no longer loads: Transform failed with 1 error:" });
    expect(verdict(null, 1)).toEqual({ kind: "broken", why: "vitest wrote no report" });
  });
});

// The checkout: lib/a.ts with a guard a test notices, one none does and a query, a real-Postgres suite beside it, and a
// `pnpm test` that judges lib/a.ts as it is when it runs and writes vitest's JSON report, stopping at its first failure
// when given --bail. Its fast test fails as lib/fake-db.ts would when the statement is not the one it knows. Every script
// records how it was run in $FAKE_LOG; $FAKE_FAIL=all fails every test.
const A = [
  "const WHERE = '\"x\" = $1';",
  "export function a(ok, db) {",
  '  if (!ok) return "refused";',
  '  if (ok === 2) return "two";',
  '  return db.query(`select 1 from "t" where ${WHERE}`, [ok]);',
  "}",
  "",
].join("\n");
const FAKE = [
  'import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
  "const [name, ...args] = process.argv.slice(2);",
  'appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, args, postgres: process.env.ALLOW_DB_TESTS === "1" }) + "\\n");',
  'const dir = args[args.indexOf("--dir") + 1];',
  'if (name === "db:start") {',
  "  mkdirSync(dir, { recursive: true });",
  '  writeFileSync(dir + "/offboard.env", "DATABASE_URL=postgres://offboard@127.0.0.1:1/pretend\\n");',
  '  writeFileSync(dir + "/postmaster.pid", "1\\n");',
  "}",
  'if (name === "db:stop") rmSync(dir + "/postmaster.pid");',
  'if (name === "test") {',
  '  const code = readFileSync("lib/a.ts", "utf8");',
  `  const known = code.includes(${JSON.stringify(A.split("\n")[0])}) && code.includes(${JSON.stringify("where ${WHERE}")});`,
  '  const broken = process.env.FAKE_FAIL === "all";',
  '  const filters = args.filter((arg) => !arg.startsWith("--"));',
  "  const runs = (file) => filters.length === 0 || filters.includes(file);",
  "  const tests = [];",
  `  const guarded = !broken && code.includes(${JSON.stringify(A.split("\n")[2].trim())});`,
  '  if (runs("app/a.test.ts")) tests.push(["app/a.test.ts", "refuses a stranger", guarded ? null : "AssertionError: expected \'two\' to be \'refused\'"]);',
  `  if (runs("app/a.test.ts")) tests.push(["app/a.test.ts", "reads the row", known ? null : ${JSON.stringify(`Error: ${FAKE_REFUSES}: select 1`)}]);`,
  '  const postgres = process.env.ALLOW_DB_TESTS !== "1" ? "skipped" : known ? null : "AssertionError: expected 2 rows to be 1";',
  '  if (runs("lib/a.postgres.test.ts")) tests.push(["lib/a.postgres.test.ts", "finds only its row", postgres]);',
  '  const first = tests.findIndex(([, , why]) => why && why !== "skipped");',
  '  const ran = args.includes("--bail=1") && first !== -1 ? tests.slice(0, first + 1) : tests;',
  '  const status = (why) => (why === null ? "passed" : why === "skipped" ? "skipped" : "failed");',
  "  const results = (file) => ran.filter(([f]) => f === file).map(([, title, why]) => ({ fullName: title, status: status(why), failureMessages: why && why !== \"skipped\" ? [why] : [] }));",
  '  const files = [...new Set(ran.map(([file]) => file))].map((file) => ({ name: process.cwd() + "/" + file, status: "passed", message: "", assertionResults: results(file) }));',
  '  const report = { numPassedTests: ran.filter(([, , why]) => why === null).length, testResults: files };',
  '  writeFileSync(args.find((arg) => arg.startsWith("--outputFile=")).split("=")[1], JSON.stringify(report));',
  "  process.exit(first === -1 ? 0 : 1);",
  "}",
  "",
].join("\n");

// Removed when the test ends, passed or failed.
function fakeCheckout() {
  const root = mkdtempSync(join(tmpdir(), "offboard-guards-test-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "lib", "app", "tmp"]) mkdirSync(join(root, dir));
  for (const script of ["guards.mjs", "check.mjs", "local-db.mjs"]) copyFileSync(`scripts/${script}`, join(root, "scripts", script));
  const scripts = Object.fromEntries(["test", "db:start", "db:stop"].map((name) => [name, `node fake.mjs ${name}`]));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fake", private: true, scripts }));
  writeFileSync(join(root, "fake.mjs"), FAKE);
  writeFileSync(join(root, "lib/a.ts"), A);
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
  const env = { ...process.env, DATABASE_URL: "", TMPDIR: join(root, "tmp"), FAKE_LOG: join(root, "fake.log") };
  const guards = (args: string[], more: Record<string, string> = {}) =>
    spawnSync(process.execPath, [join(root, "scripts/guards.mjs"), ...args], { encoding: "utf8", env: { ...env, ...more } });
  const runs = () =>
    readFileSync(join(root, "fake.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; args: string[]; postgres: boolean });
  // What is left: guards' folders in the temporary folder, git's status, and lib/a.ts.
  const left = () => [
    readdirSync(join(root, "tmp")).filter((name) => name.startsWith("offboard-")),
    git("status", "--porcelain").stdout,
    readFileSync(join(root, "lib/a.ts"), "utf8"),
  ];
  return { guards, runs, left };
}

describe("a run of pnpm guards", () => {
  it("says which changes went red, judging one to SQL by the real-Postgres suites alone, and leaves the checkout as it was", () => {
    const { guards, runs, left } = fakeCheckout();
    const { status, stdout } = guards(["lib/a.ts:3", "lib/a.ts:4", "lib/a.ts:5", "--replace", "where ${WHERE}", "where true", "lib/a.ts:1", "--replace", '"x" = $1', "true"]);
    expect(stdout).toContain("The tests pass as the code is (the whole suite with the real-Postgres suites: 3 passed).");
    expect(stdout).toContain('RED       lib/a.ts:3\n         - if (!ok) return "refused";\n         1 failed, first: app/a.test.ts > refuses a stranger\n');
    // Had line 3 not been put back, this change would have gone red too.
    expect(stdout).toContain('GREEN     lib/a.ts:4\n         - if (ok === 2) return "two";\n         no test noticed: 3 passed\n');
    const alone = "by the real-Postgres suites alone, as lib/fake-db.ts refuses a changed statement: 1 failed, first: lib/a.postgres.test.ts > finds only its row";
    expect(stdout).toContain(`RED       lib/a.ts:5 --replace 'where \${WHERE}' 'where true'\n`);
    expect(stdout).toContain(`RED       lib/a.ts:1 --replace '"x" = $1' true\n         - const WHERE = '"x" = $1';\n         + const WHERE = 'true';\n         ${alone}\n`);
    expect(stdout).toContain("3 of 4 changes went red.\nNo test noticed: lib/a.ts:4.\n");
    expect(status).toBe(1);
    // The change inside the template literal goes to the real-Postgres suite at once; the one outside it, only once the
    // fast tests have failed on the fake's refusal alone.
    const tests = runs().filter((run) => run.name === "test");
    const filters = tests.map((run) => run.args.filter((arg) => !arg.startsWith("--")));
    expect(filters).toEqual([[], [], [], ["lib/a.postgres.test.ts"], [], ["lib/a.postgres.test.ts"]]);
    expect(tests.every((run) => run.postgres)).toBe(true);
    expect(runs().filter((run) => run.name.startsWith("db:")).map((run) => run.name)).toEqual(["db:start", "db:stop"]);
    expect(left()).toEqual([[], "", A]);
  }, 60_000);

  it("judges nothing when the tests fail before any change", () => {
    const { guards, left } = fakeCheckout();
    const { status, stdout, stderr } = guards(["lib/a.ts:3"], { FAKE_FAIL: "all" });
    expect(stderr.trim()).toBe("The tests fail before any change, so no change can be judged: 1 failed, first: app/a.test.ts > refuses a stranger");
    expect(stdout).not.toMatch(/^(RED|GREEN)/m);
    expect(status).toBe(1);
    expect(left()).toEqual([[], "", A]);
  }, 60_000);

  it("makes no change that is not in the file once, nor one to SQL that --tests leaves to the fast tests, and needs no database then", () => {
    const { guards, runs, left } = fakeCheckout();
    const places = ["lib/a.ts:9", "lib/none.ts:1", "lib/a.ts:3", "--replace", "nothing", "x", "lib/a.ts:5", "--replace", "where ${WHERE}", "where true"];
    const { status, stdout } = guards([...places, "--tests", "app/a.test.ts"]);
    expect(stdout).toContain("NOT MADE  lib/a.ts:9\n         lib/a.ts: it has 6 lines\n");
    expect(stdout).toContain("NOT MADE  lib/none.ts:1\n         lib/none.ts: there is no such file\n");
    expect(stdout).toContain('NOT MADE  lib/a.ts:3 --replace nothing x\n         lib/a.ts: "nothing" is there 0 times, not once\n');
    expect(stdout).toContain("a change to SQL is judged by the real-Postgres suites, and none of the --tests is one");
    expect(stdout).toContain("0 of 4 changes went red.");
    expect(status).toBe(1);
    expect(runs().map((run) => run.name)).toEqual(["test"]);
    expect(left()).toEqual([[], "", A]);
  }, 60_000);
});
