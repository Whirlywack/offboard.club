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
// Line numbers are the file's as it is now. Each change gets one verdict:
//   RED       tests that pass without the change failed with it, and are named: each failing test is run again on the
//             code as it is, and one that fails there too says nothing of the change
//   GREEN     every test that ran passed, and none was skipped where the real-Postgres suites ran
//   BROKEN    the change does not parse, TypeScript refuses it, a file no longer loads, or a changed migration does not
//             apply: CI would refuse it before any test, so no test judged it
//   UNJUDGED  the tests cannot say: the failures were there without the change, or were timeouts, or vitest failed
//             outside any test, or no test ran, or a real-Postgres test was skipped
//   NOT MADE  the place is not in the file as named
// Each says which tests it rests on. The whole suite runs, stopped at its first failure, once it has passed without the
// change; with the real-Postgres suites too, on a throwaway database from `pnpm db:start`, when asked, when the file
// holds SQL, or when it has a <name>.postgres.test.ts beside it. A change inside SQL is judged by them alone, as
// lib/fake-db.ts refuses any statement it was not written with, and a change to a migration by them alone on a database
// migrated afresh with it. Exits 0 only if every place named went red; never when it proposed the places.
//
// Everything happens in a copy of the checkout in a temporary folder, with its own pnpm install, so a reviewer who may
// not edit the worktree can run it, and the worktree is as it was however the run ends (scripts/check.mjs). Neither
// DATABASE_URL nor ALLOW_DB_TESTS reaches the tests but its own, and it refuses a DATABASE_URL not on this machine.
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { cleanUp, copyCheckout, environmentProblem, git, readJson, relative, root, run, scratch, startDatabase, stopDatabase } from "./check.mjs";

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
    if (ts.isTemplateLiteral(node)) return sql(node, source);
    return ts.forEachChild(node, look) ?? false;
  };
  return look(source);
}
const sql = (template, source) =>
  /^\s*(with|select|insert|update|delete)\s|\b(where|and|or|set|on)\s+("|\$\d|\w+\.")/.test(template.getText(source).slice(1, -1));

const script = (file) => /\.(m?[jt]sx?)$/.test(file);

// Whether `text`, the file `file`, holds SQL in a template literal anywhere.
export function hasSql(file, text) {
  if (!script(file)) return false;
  const source = parsed(file, text);
  const look = (node) => (ts.isTemplateLiteral(node) && sql(node, source)) || (ts.forEachChild(node, look) ?? false);
  return look(source);
}

// What a parser says is wrong with `text`, the file `file`: TypeScript's for a script, JSON's for .json; null for any
// other file, which is not parsed.
export function parseErrors(file, text) {
  if (file.endsWith(".json")) {
    try {
      JSON.parse(text);
      return [];
    } catch (error) {
      return [error.message];
    }
  }
  if (!script(file)) return null;
  return parsed(file, text).parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
}

const quote =(text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);
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

// How a run of the tests ended (vitest's JSON report, its exit code, and whether the real-Postgres suites ran): red,
// with the tests that failed, still to be run again without the change; green; refused, when every test that failed did
// so only because lib/fake-db.ts did not know a statement; broken; or unjudged.
export function verdict(report, code, postgres) {
  if (code === null) return { kind: "unjudged", why: "the tests did not finish within 5 minutes and were stopped" };
  if (!report) return { kind: "broken", why: "vitest wrote no report" };
  const failed = [];
  const timedOut = [];
  let refused = 0;
  for (const file of report.testResults)
    for (const test of file.assertionResults.filter((test) => test.status === "failed")) {
      const message = test.failureMessages.join("\n");
      if (message.includes(FAKE_REFUSES)) refused++;
      else if (/Test timed out in \d+ms/.test(message)) timedOut.push(`${relative(file.name)} > ${test.fullName}`);
      // vitest's --testNamePattern matches the names of its describe blocks and its own, joined by " > ".
      else failed.push({ file: relative(file.name), name: test.fullName, path: [...(test.ancestorTitles ?? []), test.title ?? test.fullName].join(" > ") });
    }
  if (failed.length) return { kind: "red", failed };
  if (timedOut.length) return { kind: "unjudged", why: `only by timing out, which load alone can do: ${timedOut.slice(0, 2).join("; ")}` };
  if (refused) return { kind: "refused" };
  const unloaded = report.testResults.find((file) => file.status === "failed" && file.message);
  if (unloaded)
    return { kind: "broken", why: `${relative(unloaded.name)} no longer loads: ${unloaded.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0]}` };
  if (code !== 0) return { kind: "unjudged", why: "vitest failed the run with an error outside any test" };
  const tests = report.testResults.flatMap((file) => file.assertionResults.map((test) => ({ ...test, file: relative(file.name) })));
  const passed = tests.filter((test) => test.status === "passed").length;
  const skipped = tests.filter((test) => test.status !== "passed");
  if (passed === 0) return { kind: "unjudged", why: "no test ran" };
  if (postgres && skipped.length)
    return { kind: "unjudged", why: `${skipped.length} tests were skipped, first: ${skipped.slice(0, 2).map((test) => `${test.file} > ${test.fullName}`).join("; ")}` };
  return { kind: "green", why: `no test noticed: ${passed} passed` };
}

// A red run judged again by the same tests run without the change (`without`, their JSON report): red if some of the
// tests that failed pass without it, naming them, and unjudged if none does.
export function confirmed(red, without) {
  const passed = new Set(
    (without?.testResults ?? []).flatMap((file) => file.assertionResults.filter((test) => test.status === "passed").map((test) => `${relative(file.name)} > ${test.fullName}`)),
  );
  const names = red.failed.map(({ file, name }) => `${file} > ${name}`);
  const noticed = names.filter((name) => passed.has(name));
  if (noticed.length === 0) return { kind: "unjudged", why: `what failed with the change fails without it too, so it says nothing of the change: ${names.slice(0, 2).join("; ")}` };
  return { kind: "red", why: `${noticed.length} failed with the change and pass without it, first: ${noticed.slice(0, 2).join("; ")}` };
}

// A --testNamePattern for exactly the tests of these names, each its describe blocks' names and its own joined by " > ".
export const namePattern = (names) => `^(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;

const NAMES = { red: "RED", green: "GREEN", broken: "BROKEN", unjudged: "UNJUDGED" };

async function guards(args) {
  const { options, changes: named } = parse(args);
  const problem = environmentProblem();
  if (problem) throw new Error(problem);
  const proposed = named.length === 0;
  const changes = proposed ? proposals() : named;
  const PROPOSED =
    "These were only proposals, made by a few patterns: they judge no guard they did not name. Name each guard the branch adds or touches: pnpm guards <file>:<line>.";
  if (proposed)
    say(`No places were named, so ${changes.length === 1 ? "1 change is" : `${changes.length} changes are`} proposed for the lines changed since origin/main.`);
  if (changes.length === 0) {
    if (proposed) say(PROPOSED);
    return 1;
  }
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
      let broken = null;
      for (const [file, text] of texts) {
        const result = apply(text, located.filter((edit) => edit.file === file));
        if (result === null) return { change, problem: `${file}: two of the edits overlap` };
        if (result === text) return { change, problem: `${file}: the edit changes nothing` };
        changed.set(file, result);
        const [before, after] = [parseErrors(file, text), parseErrors(file, result)];
        if (after && after.length > before.length) broken ??= `${file} no longer parses: ${after.find((error) => !before.includes(error)) ?? after[0]}`;
      }
      const migration = change.some((edit) => edit.file.startsWith("migrations/"));
      const touchesFake = change.some((edit) => edit.file === "lib/fake-db.ts");
      const inside = (edit) => script(edit.file) && (inSql(edit.file, texts.get(edit.file), edit.start) || inSql(edit.file, texts.get(edit.file), Math.max(edit.start, edit.end - 1)));
      const sql = !touchesFake && located.some(inside);
      const holdsSql = change.some((edit) => hasSql(edit.file, texts.get(edit.file)));
      const beside = change.some((edit) => suites.includes(edit.file.replace(/\.m?[jt]sx?$/, ".postgres.test.ts")));
      const postgres = options.tests.length ? postgresTests.length > 0 : options.pg || beside || sql || holdsSql || migration;
      if ((sql || migration) && postgresTests.length === 0)
        return { change, problem: `a change to ${migration ? "a migration" : "SQL"} is judged by the real-Postgres suites, and none of the --tests is one` };
      const types = change.some((edit) => /\.tsx?$/.test(edit.file));
      return { change, texts, changed, located, broken, sql, migration, postgres, types };
    });

    let database = null;
    if (plans.some((plan) => plan.postgres)) {
      say("Starting a throwaway Postgres (pnpm db:start).");
      database = await startDatabase(folder, "tests", log);
      if (!database) throw new Error(`pnpm db:start failed (${log}).`);
    }
    const report = join(folder, "report.json");
    // Runs the test files `filters` (all of them if none) with `pnpm test`, on the database `url` if any, stopped at the
    // first failure or, given `names`, only the tests of those names (describe > test); gives vitest's report and exit code.
    const tests = async (filters, url, names = null) => {
      rmSync(report, { force: true });
      const env = url ? { ALLOW_DB_TESTS: "1", DATABASE_URL: url } : {};
      const flags = ["--reporter=json", `--outputFile=${report}`, names ? `--testNamePattern=${namePattern(names)}` : "--bail=1"];
      const code = await run("pnpm", ["test", ...flags, ...filters], { cwd: checkout, log, env, limit: 5 * 60_000 });
      return { report: readJson(report), code };
    };
    // The type errors TypeScript finds in the copy as it is now, when the checkout has a typecheck script.
    const scripts = readJson(join(checkout, "package.json"))?.scripts ?? {};
    const typesLog = join(folder, "types.log");
    const typeErrors = async () => {
      rmSync(typesLog, { force: true });
      await run("pnpm", ["typecheck"], { cwd: checkout, log: typesLog });
      return readFileSync(typesLog, "utf8").split("\n").filter((line) => /error TS\d+/.test(line));
    };
    const typesBefore = scripts.typecheck && plans.some((plan) => plan.types) ? await typeErrors() : null;

    const before = await tests(options.tests, database?.url);
    const baseline = verdict(before.report, before.code, database !== null);
    const scope = `${options.tests.length ? options.tests.join(", ") : "the whole suite"}${database ? " with the real-Postgres suites" : ""}`;
    if (baseline.kind !== "green")
      throw new Error(`The tests do not pass before any change, so no change can be judged: ${baseline.why ?? `${baseline.failed.length} failed, first: ${baseline.failed[0].file} > ${baseline.failed[0].name}`}`);
    say(`The tests pass as the code is (${scope}: ${baseline.why.replace("no test noticed: ", "")}).\n`);

    const outcomes = [];
    for (const [n, plan] of plans.entries()) {
      if (plan.problem) {
        say(`NOT MADE  ${label(plan.change)}\n         ${plan.problem}`);
        outcomes.push("not made");
        continue;
      }
      for (const [file, text] of plan.changed) writeFileSync(join(checkout, file), text);
      let result;
      let on = options.tests.length ? `the tests named (${options.tests.join(", ")})` : plan.postgres ? "the fast tests and the real-Postgres suites" : "the fast tests only: no real-Postgres suite ran";
      let url = plan.postgres ? database.url : null;
      try {
        const refused = plan.broken ? null : typesBefore && plan.types ? (await typeErrors()).find((line) => !typesBefore.includes(line)) : null;
        if (plan.broken) result = { kind: "broken", why: plan.broken };
        else if (refused) result = { kind: "broken", why: `TypeScript refuses the change, as CI's typecheck would: ${refused.trim()}` };
        else if (plan.migration) {
          on = "the real-Postgres suites alone, on a database migrated afresh with the change";
          const fresh = await startDatabase(folder, `change-${n + 1}`, log);
          if (!fresh) result = { kind: "broken", why: "the changed migrations do not apply to an empty database (pnpm db:start failed)" };
          else {
            url = fresh.url;
            const { report: r, code } = await tests(postgresTests, fresh.url);
            result = verdict(r, code, true);
            await stopDatabase(folder, fresh.dir, log);
          }
        } else {
          const whole = plan.sql ? null : await tests(options.tests, url);
          result = whole ? verdict(whole.report, whole.code, plan.postgres) : { kind: "refused" };
          if (result.kind === "refused" && plan.postgres) {
            on = "the real-Postgres suites alone, as lib/fake-db.ts refuses a changed statement";
            url = database.url;
            const { report: r, code } = await tests(postgresTests, database.url);
            result = verdict(r, code, true);
          } else if (result.kind === "refused")
            result = { kind: "unjudged", why: "the fast tests failed only because lib/fake-db.ts does not know the changed statement: run it again with --pg" };
        }
      } finally {
        for (const [file, text] of plan.texts) writeFileSync(join(checkout, file), text);
      }
      // A red run is run again, the failing tests alone, without the change: only a test that passes there noticed it.
      if (result.kind === "red") {
        const failing = [...new Set(result.failed.map((test) => test.file))];
        const without = await tests(failing, plan.migration ? database.url : url, result.failed.map((test) => test.path));
        result = confirmed(result, without.report);
      }
      say(`${NAMES[result.kind].padEnd(8)}  ${label(plan.change)}`);
      for (const edit of plan.located) say(shown(plan.texts.get(edit.file), edit));
      say(`         ${result.why}${result.kind === "broken" ? "" : `, on ${on}`}`);
      outcomes.push(result.kind);
    }
    const red = outcomes.filter((kind) => kind === "red").length;
    say(`\n${red} of ${changes.length} changes went red.`);
    for (const kind of ["green", "unjudged", "broken", "not made"]) {
      const these = plans.filter((_, i) => outcomes[i] === kind).map((plan) => label(plan.change));
      if (these.length) say(`${{ green: "No test noticed", unjudged: "Not judged", broken: "Broken", "not made": "Not made" }[kind]}: ${these.join("; ")}.`);
    }
    say("Each change was made in the copy only, which is now removed; this checkout was not written to.");
    if (proposed) say(PROPOSED);
    return !proposed && red === changes.length ? 0 : 1;
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
