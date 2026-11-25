// The mechanical part of "Every guard goes red" (CODING_STANDARDS.md): makes each change named, one at a time, runs the
// tests, and says which changes no test noticed.
//
//   pnpm guards <place> [<place> ...]
//     <file>:<line>, <file>:<first>-<last>  deletes that line, or those lines
//     <place> --replace <text> <with>       replaces <text>, which must be in the place once, with <with>, instead;
//                                           the place may also be a whole <file>
//     <place> + <place>                     one change made of both, such as a query and its copy in lib/fake-db.ts
//     --tests <file>                        runs only that test file, not the whole suite (repeatable)
//     --pg                                  runs the real-Postgres suites for every change too
//   pnpm guards                             proposes changes to the files changed since origin/main and makes them:
//                                           only a proposal, which misses any guard it does not recognise
//
// Line numbers are the file's as it is now. Each change runs the whole suite, stopped at its first failure, once the
// suite has passed without it. The real-Postgres suites run too, on a throwaway database from `pnpm db:start`, when
// asked or when the file changed has a <name>.postgres.test.ts beside it. A change to SQL is judged by them alone:
// lib/fake-db.ts refuses any statement it was not written with, so every fast test that sends a changed statement
// fails, whatever the change. Exits 0 only if every change went red.
//
// Everything happens in a copy of the checkout in a temporary folder, with its own pnpm install, so a reviewer who may
// not edit the worktree can run it, and the worktree is as it was however the run ends (scripts/check.mjs).
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { cleanUp, copyCheckout, git, readJson, relative, root, run, scratch, startDatabase } from "./check.mjs";

const USAGE = "Usage: pnpm guards [--pg] [--tests <file>] [<file>[:<line>[-<last>]] [--replace <text> <with>] [+ <place>]] ...";
// What lib/fake-db.ts throws on a statement it does not know.
export const FAKE_REFUSES = "The fake database does not know this statement";
const say = (line) => console.log(line);

// The options, and the changes named: each a list of edits made together.
export function parse(args) {
  const options = { pg: false, tests: [] };
  const changes = [];
  let joined = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const edit = changes.at(-1)?.at(-1);
    if (arg === "--pg") options.pg = true;
    else if (arg === "--tests" && args[i + 1] !== undefined) options.tests.push(args[++i]);
    else if (arg === "--replace" && edit && !edit.replace && !joined && args[i + 2] !== undefined) edit.replace = [args[++i], args[++i]];
    else if (arg === "+" && edit && !joined) joined = true;
    else {
      const place = arg !== "+" && /^([^-].*?)(?::(\d+)(?:-(\d+))?)?$/.exec(arg);
      if (!place) throw new Error(USAGE);
      const next = { file: place[1], first: place[2] && Number(place[2]), last: Number(place[3] ?? place[2]) || undefined };
      if (joined) changes.at(-1).push(next);
      else changes.push([next]);
      joined = false;
    }
  }
  if (joined) throw new Error(USAGE);
  return { options, changes };
}

// Where in `text` an edit falls: { start, end, by }, or { problem }.
export function locate(text, { first, last = first, replace }) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const lines = text.endsWith("\n") ? starts.length - 1 : starts.length;
  let [from, to] = [0, text.length];
  if (first !== undefined) {
    if (first < 1 || last < first || last > lines) return { problem: `it has ${lines} lines` };
    [from, to] = [starts[first - 1], starts[last] ?? text.length];
  } else if (!replace) return { problem: "a whole file is not a guard: name a line, lines or --replace" };
  if (!replace) return { start: from, end: to, by: "" };
  const [old, by] = replace;
  const found = old ? text.slice(from, to).split(old).length - 1 : 0;
  if (found !== 1) return { problem: `${JSON.stringify(old)} is there ${found} times, not once` };
  const start = from + text.slice(from, to).indexOf(old);
  return { start, end: start + old.length, by };
}

// `text` with the located edits made, or null if two overlap.
export function apply(text, located) {
  const sorted = [...located].sort((a, b) => b.start - a.start);
  if (sorted.some((edit, i) => i > 0 && edit.end > sorted[i - 1].start)) return null;
  return sorted.reduce((result, { start, end, by }) => result.slice(0, start) + by + result.slice(end), text);
}

// The whole lines an edit touches, before and after.
export function shown(text, { start, end, by }) {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const stop = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const to = text.indexOf("\n", stop) === -1 ? text.length : text.indexOf("\n", stop);
  const before = text.slice(from, to);
  const after = before.slice(0, start - from) + by + before.slice(end - from);
  const lines = (prefix, part) => part.split("\n").map((line) => `         ${prefix} ${line.trim()}`);
  return [...lines("-", before), ...(after.trim() ? lines("+", after) : [])].join("\n");
}

const parsed = (file, text) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

// Whether `offset` in `text` is in a template literal holding SQL: a statement, or a part of one with a quoted name or a
// parameter, as this code writes them.
export function inSql(file, text, offset) {
  const source = parsed(file, text);
  const look = (node) => {
    if (offset < node.getStart(source) || offset >= node.getEnd()) return false;
    if (ts.isTemplateLiteral(node))
      return /^\s*(with|select|insert|update|delete)\s|\b(where|and|or|set|on)\s+("|\$\d|\w+\.")/.test(node.getText(source).slice(1, -1));
    return ts.forEachChild(node, look) ?? false;
  };
  return look(source);
}

const quote = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);
export const label = (change) =>
  change
    .map(({ file, first, last, replace }) =>
      [`${file}${first ? `:${first}${last > first ? `-${last}` : ""}` : ""}`, ...(replace ? ["--replace", ...replace.map(quote)] : [])].join(" "),
    )
    .join(" + ");

// Changes to propose in `file` (its text) at the lines changed: an if's condition made false, a sign-in or Member check or
// a redirect deleted, and a where clause made true for every row.
export function propose(file, text, lines) {
  const source = parsed(file, text);
  const line = (position) => source.getLineAndCharacterOfPosition(position).line + 1;
  const changes = [];
  const visit = (node) => {
    const at = line(node.getStart(source));
    if (lines.has(at) && ts.isIfStatement(node)) {
      const close = node.getChildren(source).find((child) => child.kind === ts.SyntaxKind.CloseParenToken);
      const condition = text.slice(node.getStart(source), close.getEnd());
      changes.push([{ file, first: at, last: line(close.getEnd()), replace: [condition, "if (false)"] }]);
    }
    if (lines.has(at) && ts.isExpressionStatement(node)) {
      const call = ts.isAwaitExpression(node.expression) ? node.expression.expression : node.expression;
      if (ts.isCallExpression(call) && /^(require[A-Z]\w*|redirect|notFound|forbidden|unauthorized)$/.test(call.expression.getText(source)))
        changes.push([{ file, first: at, last: line(node.getEnd()) }]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const at of lines) {
    const start = source.getLineStarts()[at - 1];
    const code = text.slice(start, source.getLineStarts()[at] ?? text.length);
    if (code.split("where ").length === 2 && inSql(file, text, start + code.indexOf("where ")))
      changes.push([{ file, first: at, last: at, replace: ["where ", "where true or "] }]);
  }
  return changes.sort((a, b) => a[0].first - b[0].first);
}

// The proposals for every file changed since origin/main, tests and migrations aside.
function proposals() {
  const base = git(["merge-base", "origin/main", "HEAD"]).trim();
  const changed = new Map();
  let file = null;
  for (const line of git(["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-ext-diff", base]).split("\n")) {
    if (line.startsWith("+++ ")) file = line.startsWith("+++ b/") ? line.slice(6) : null;
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) for (let n = Number(hunk[1]); n < Number(hunk[1]) + Number(hunk[2] ?? 1); n++) changed.set(file, (changed.get(file) ?? new Set()).add(n));
  }
  for (const untracked of git(["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean))
    changed.set(untracked, new Set(readFileSync(join(root, untracked), "utf8").split("\n").map((_, i) => i + 1)));
  return [...changed]
    .filter(([name]) => /\.(ts|tsx|mjs)$/.test(name) && !/\.(test\.tsx?|d\.ts)$/.test(name) && existsSync(join(root, name)))
    .flatMap(([name, lines]) => propose(name, readFileSync(join(root, name), "utf8"), lines));
}

// How a run of the tests ended: red (with the first tests that failed), green, refused (every test that failed did so
// only because lib/fake-db.ts did not know a statement), or broken (a file that no longer loads, or no report).
export function verdict(report, code) {
  if (code === null) return { kind: "red", why: "the tests did not finish within 5 minutes and were stopped" };
  if (!report) return { kind: "broken", why: "vitest wrote no report" };
  const failed = [];
  let refused = 0;
  for (const file of report.testResults)
    for (const test of file.assertionResults.filter((test) => test.status === "failed"))
      if (test.failureMessages.some((message) => message.includes(FAKE_REFUSES))) refused++;
      else failed.push(`${relative(file.name)} > ${test.fullName}`);
  if (failed.length) return { kind: "red", why: `${failed.length} failed, first: ${failed.slice(0, 2).join("; ")}` };
  if (refused) return { kind: "refused" };
  const unloaded = report.testResults.find((file) => file.status === "failed" && file.message);
  if (unloaded)
    return { kind: "broken", why: `${relative(unloaded.name)} no longer loads: ${unloaded.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0]}` };
  if (code !== 0) return { kind: "red", why: "vitest failed the run with an error outside any test" };
  return { kind: "green", why: `no test noticed: ${report.numPassedTests} passed` };
}

async function guards(args) {
  const { options, changes: named } = parse(args);
  const proposed = named.length === 0;
  const changes = proposed ? proposals() : named;
  if (proposed)
    say(`No places were named, so these ${changes.length} are proposed from the files changed since origin/main. Only a proposal: a guard it does not recognise is not on it, and each guard the change adds or touches still needs naming.`);
  if (changes.length === 0) return 0;
  const folder = scratch("guards");
  const checkout = join(folder, "checkout");
  const log = join(folder, "guards.log");
  try {
    say(`Copying this checkout to ${checkout}, and installing.`);
    const files = copyCheckout(checkout);
    if ((await run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: checkout, log })) !== 0) throw new Error(`pnpm install failed (${log}).`);
    for (const file of options.tests) if (!files.includes(file)) throw new Error(`--tests ${file}: there is no such file.`);
    const suites = files.filter((file) => file.endsWith(".postgres.test.ts"));
    const postgresTests = options.tests.length ? options.tests.filter((file) => suites.includes(file)) : suites;

    // Each change, located and judged before anything runs.
    const plans = changes.map((change) => {
      const texts = new Map();
      const located = [];
      for (const edit of change) {
        const path = join(checkout, edit.file);
        if (!existsSync(path)) return { change, problem: `${edit.file}: there is no such file` };
        texts.set(edit.file, texts.get(edit.file) ?? readFileSync(path, "utf8"));
        const where = locate(texts.get(edit.file), edit);
        if (where.problem) return { change, problem: `${edit.file}: ${where.problem}` };
        located.push({ ...where, file: edit.file });
      }
      const changed = new Map();
      for (const [file, text] of texts) {
        const mine = located.filter((edit) => edit.file === file);
        const result = apply(text, mine);
        if (result === null) return { change, problem: `${file}: two of the edits overlap` };
        if (result === text) return { change, problem: `${file}: the edit changes nothing` };
        changed.set(file, result);
      }
      const touchesFake = change.some((edit) => edit.file === "lib/fake-db.ts");
      const sql = !touchesFake && located.some((edit) => inSql(edit.file, texts.get(edit.file), edit.start) || inSql(edit.file, texts.get(edit.file), Math.max(edit.start, edit.end - 1)));
      const beside = change.some((edit) => suites.includes(edit.file.replace(/\.m?[jt]sx?$/, ".postgres.test.ts")));
      const postgres = options.tests.length ? postgresTests.length > 0 : options.pg || beside || sql;
      if (sql && postgresTests.length === 0) return { change, problem: "a change to SQL is judged by the real-Postgres suites, and none of the --tests is one" };
      return { change, texts, changed, located, sql, postgres };
    });

    let database = null;
    if (plans.some((plan) => plan.postgres)) {
      say("Starting a throwaway Postgres (pnpm db:start).");
      database = await startDatabase(folder, "tests", log);
      if (!database) throw new Error(`pnpm db:start failed (${log}).`);
    }
    const report = join(folder, "report.json");
    // Runs the test files `filters` (all of them if none), stopped at the first failure, and judges the run.
    const tests = async (filters, postgres) => {
      rmSync(report, { force: true });
      const env = { ...process.env, ...(postgres ? { ALLOW_DB_TESTS: "1", DATABASE_URL: database } : {}) };
      const vitest = join(checkout, "node_modules/.bin/vitest");
      const code = await run(vitest, ["run", "--bail=1", "--reporter=json", `--outputFile=${report}`, ...filters], { cwd: checkout, log, env, limit: 5 * 60_000 });
      return verdict(readJson(report), code);
    };

    const before = await tests(options.tests, database !== null);
    const scope = `${options.tests.length ? options.tests.join(", ") : "the whole suite"}${database ? " with the real-Postgres suites" : ""}`;
    if (before.kind !== "green") throw new Error(`The tests fail before any change, so no change can be judged: ${before.why}`);
    say(`The tests pass as the code is (${scope}: ${before.why.replace("no test noticed: ", "")}).\n`);

    const outcomes = [];
    for (const plan of plans) {
      if (plan.problem) {
        say(`NOT MADE  ${label(plan.change)}\n         ${plan.problem}`);
        outcomes.push("not made");
        continue;
      }
      for (const [file, text] of plan.changed) writeFileSync(join(checkout, file), text);
      let result;
      try {
        result = plan.sql ? { kind: "refused" } : await tests(options.tests, plan.postgres);
        if (result.kind === "refused" && plan.postgres) result = { ...(await tests(postgresTests, true)), alone: true };
      } finally {
        for (const [file, text] of plan.texts) writeFileSync(join(checkout, file), text);
      }
      const name = { red: "RED", green: "GREEN", broken: "BROKEN", refused: "UNJUDGED" }[result.kind];
      say(`${name.padEnd(8)}  ${label(plan.change)}`);
      for (const edit of plan.located) say(shown(plan.texts.get(edit.file), edit));
      const why =
        result.kind === "refused"
          ? "the fast tests failed only because lib/fake-db.ts does not know the changed statement: run it again with --pg"
          : result.why;
      say(`         ${result.alone ? "by the real-Postgres suites alone, as lib/fake-db.ts refuses a changed statement: " : ""}${why}`);
      outcomes.push(result.kind);
    }
    const red = outcomes.filter((kind) => kind === "red").length;
    say(`\n${red} of ${changes.length} changes went red.`);
    const unnoticed = plans.filter((_, i) => outcomes[i] === "green").map((plan) => label(plan.change));
    if (unnoticed.length) say(`No test noticed: ${unnoticed.join("; ")}.`);
    say("Each change was made in the copy only, which is now removed; this checkout was not written to.");
    return red === changes.length ? 0 : 1;
  } finally {
    cleanUp(folder);
  }
}

// Run, not imported: the tests import what is exported above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  guards(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
