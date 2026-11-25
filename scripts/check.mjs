// Everything a branch must pass before it is handed over, in one run, as CI (.github/workflows/ci.yml) runs it and a
// little more: no merged migration edited, every migration applied to an empty database, lint, typecheck, every test
// including the real-Postgres suites, the build, and the three seeds with the settings CI gives them. It fails if any
// test was skipped or a test file is one vitest never runs (*.test.tsx).
//
//   pnpm check  Prints each step as it ends, the output of a step that failed, and at the end the tallies a report needs,
//               with the Node.js and Postgres it ran on beside CI's and the commit it checked. Exits 1 if any step failed.
//
// It runs in a copy of this checkout's working tree (the tracked files as they are now and the untracked ones git does
// not ignore, so neither .env.local nor node_modules), made a git checkout of its own, in a temporary folder, with its
// own pnpm install and two throwaway Postgres servers from `pnpm db:start --dir`, so it changes nothing in the checkout
// and runs in several worktrees at once. CI tests the commit only: an uncommitted or untracked file passes here and is
// not there, which the tallies say. Every step's TMPDIR is in the folder. Whatever ends it, a watcher in a session of
// its own stops those servers and removes the folder once it has gone. It refuses a checkout whose .env.local holds real
// settings, by db:start's own test, and a DATABASE_URL in the environment that is not on this machine; it passes on to
// the steps neither DATABASE_URL nor ALLOW_DB_TESTS but its own.
//
// pnpm guards (scripts/guards.mjs) uses the copy, the watcher and the databases from here.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync } from "node:fs";
import { readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutProblem, notLocal } from "./local-db.mjs";

export const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const self = fileURLToPath(import.meta.url);
export const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const say = (line) => console.log(line);

// Why neither tool may run here, or null: a checkout whose .env.local holds real settings, or a DATABASE_URL in the
// environment that is not a database on this machine, which a test could reach.
export function environmentProblem() {
  const envLocal = join(root, ".env.local");
  const url = process.env.DATABASE_URL;
  return (
    checkoutProblem(lstatSync(envLocal, { throwIfNoEntry: false }) ? readFileSync(envLocal, "utf8") : null) ??
    (url && notLocal(url) ? `Refusing to run beside a real DATABASE_URL in the environment: ${notLocal(url)}. Unset it first.` : null)
  );
}

// The processes running now, each the first of a process group of its own, so that it and everything it started can be
// stopped together; listed in <folder>/running too, for the watcher.
const children = new Set();
let running = null;
let temporary = null;
// pnpm's store, found once at the start: a pnpm run at the clean-up would write its compile cache into TMPDIR.
let store = "";
// Where db:start and db:stop record what they start in the copy: the repository's own registry (ticket #58), so that
// `pnpm local:list` and `pnpm local:stop --all` there find it too. Given to those two alone: a test of them that was
// given it would list and stop every server the repository's worktrees have started.
let registry = "";
const list = () => running && writeFileSync(running, [...children].map((child) => child.pid).join("\n"));

// A temporary folder for one run, `<folder>/checkout` the copy, `<folder>/db-*` its databases and `<folder>/tmp` every
// step's TMPDIR. The watcher is started through a shell that exits at once, so it belongs to launchd and its own
// session: stopping this process and every process it started, as an agent's tool does, leaves it running, and it stops
// the databases and removes the folder.
export function scratch(name) {
  // Its real path, which pnpm's store links name, so that they can be found once the folder is gone.
  const folder = realpathSync(mkdtempSync(join(tmpdir(), `offboard-${name}-`)));
  running = join(folder, "running");
  temporary = join(folder, "tmp");
  registry = process.env.OFFBOARD_LOCAL_REGISTRY || `${git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()}/offboard-local`;
  store = spawnSync("pnpm", ["store", "path"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "";
  mkdirSync(temporary);
  spawn("/bin/sh", ["-c", '"$0" "$1" clean-up "$2" "$3" "$4" "$5" >/dev/null 2>&1 &', process.execPath, self, String(process.pid), folder, store, registry], {
    detached: true,
    stdio: "ignore",
  }).unref();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(signal, () => {
      for (const child of children) stopGroup(child);
      console.error(`\nInterrupted. The databases are being stopped and ${folder} removed.`);
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  return folder;
}

const stopGroup = (child) => {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // already gone
  }
};

// Stops what the run left running in `folder` and every database db:start made there, takes out of pnpm's store, which
// links each project it installed, the copy and any project of a run inside it, then removes the folder. Run at the end
// of a run, and by the watcher, which finds the run's processes running still when only the run itself was killed.
export function cleanUp(folder, storeFolder = store, registryFolder = registry) {
  const checkout = join(folder, "checkout");
  if (existsSync(folder)) {
    const pids = existsSync(join(folder, "running")) ? readFileSync(join(folder, "running"), "utf8").split("\n").filter(Boolean) : [];
    for (const pid of pids) stopGroup({ pid: Number(pid) });
    for (const name of readdirSync(folder))
      if (name.startsWith("db-") && existsSync(join(folder, name, "postmaster.pid")))
        spawnSync("pnpm", ["db:stop", "--dir", join(folder, name)], { cwd: checkout, stdio: "ignore", env: { ...outside(), ...recording(registryFolder) } });
  }
  forget(folder, storeFolder);
  rmSync(folder, { recursive: true, force: true });
}

// Removes the links in pnpm's store `storeFolder` (in its projects folder) to projects in `folder`, gone or not.
function forget(folder, storeFolder) {
  const projects = storeFolder && join(storeFolder, "projects");
  for (const name of projects && existsSync(projects) ? readdirSync(projects) : []) {
    const link = join(projects, name);
    let target = "";
    try {
      target = resolve(projects, readlinkSync(link));
    } catch {
      // not a link, or another run's clean-up removed it meanwhile
    }
    if (target === folder || target.startsWith(`${folder}/`)) rmSync(link, { force: true });
  }
}

// The watcher: once the process `pid` has gone, however it ended, cleans up after it.
function cleanUpAfter(pid, folder, storeFolder, registryFolder) {
  const timer = setInterval(() => {
    try {
      process.kill(Number(pid), 0);
    } catch (error) {
      if (error.code !== "ESRCH") return;
      clearInterval(timer);
      cleanUp(folder, storeFolder, registryFolder);
    }
  }, 250);
}

// This checkout's working tree as `git add --all` would commit it, copied into `into`, which is made a git checkout of
// its own (with nothing committed), as db:start wants one; the files copied.
export function copyCheckout(into) {
  const files = new Set(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean));
  const copied = [];
  for (const file of files) {
    const from = join(root, file);
    const stat = lstatSync(from, { throwIfNoEntry: false });
    if (!stat) continue; // deleted and not yet committed
    const to = join(into, file);
    mkdirSync(dirname(to), { recursive: true });
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to, constants.COPYFILE_FICLONE);
    copied.push(file);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: into, stdio: "ignore" });
  return copied;
}

// This process's environment without DATABASE_URL, ALLOW_DB_TESTS and OFFBOARD_LOCAL_REGISTRY, and with TMPDIR in the
// run's folder.
function outside() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { DATABASE_URL, ALLOW_DB_TESTS, OFFBOARD_LOCAL_REGISTRY, ...rest } = process.env;
  return { ...rest, ...(temporary ? { TMPDIR: temporary } : {}) };
}
const recording = (folder) => (folder ? { OFFBOARD_LOCAL_REGISTRY: folder } : {});

// Runs `command` in a process group of its own, its output added to `log`, with this process's environment but for
// DATABASE_URL, ALLOW_DB_TESTS and OFFBOARD_LOCAL_REGISTRY, which only `env` may give, and TMPDIR in the run's folder. Resolves to its exit code,
// or null if it was stopped after `limit` ms. Anything it leaves running in its group is stopped when it ends.
export function run(command, args, { cwd, env = {}, log, limit = 20 * 60_000 }) {
  const environment = { ...outside(), ...env };
  return new Promise((done) => {
    const out = openSync(log, "a");
    const child = spawn(command, args, { cwd, env: environment, stdio: ["ignore", out, out], detached: true });
    closeSync(out);
    children.add(child);
    list();
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      stopGroup(child);
    }, limit);
    const end = (code) => {
      clearTimeout(timer);
      stopGroup(child);
      children.delete(child);
      list();
      done(stopped ? null : code);
    };
    child.on("error", () => end(127));
    child.on("exit", (code) => end(code ?? 1));
  });
}

// A fresh, empty, migrated database from `pnpm db:start --dir <folder>/db-<name>-<try>`, run in the copy: its address
// and folder, or null if it could not be started. Before ticket #58, db:start chooses ports that are free when it looks,
// so of runs starting at once all but one can lose them, and the losers then race for the next ones: each tries again in
// another folder, after a pause of its own. (With #58 db:start tries again itself, and this is not needed.) A failure
// with the server running, such as a migration that does not apply, is not tried again. The .env.local db:start gives
// the copy is removed: CI has none, and the build and the seeds would read it.
export async function startDatabase(folder, name, log) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const dir = join(folder, `db-${name}-${attempt}`);
    const code = await run("pnpm", ["db:start", "--dir", dir], { cwd: join(folder, "checkout"), log, env: recording(registry) });
    rmSync(join(folder, "checkout", ".env.local"), { force: true });
    if (code === 0) return { url: /^DATABASE_URL=(.*)$/m.exec(readFileSync(join(dir, "offboard.env"), "utf8"))[1], dir };
    if (existsSync(join(dir, "postmaster.pid"))) return null;
    await new Promise((resume) => setTimeout(resume, Math.random() * 3000));
  }
  return null;
}

// Stops the database db:start made in `dir`.
export const stopDatabase = (folder, dir, log) => run("pnpm", ["db:stop", "--dir", dir], { cwd: join(folder, "checkout"), log, env: recording(registry) });

// The version of the Postgres server running in `dir`, from the command line it was started with.
function serverVersion(dir) {
  const binary = existsSync(join(dir, "postmaster.opts")) ? readFileSync(join(dir, "postmaster.opts"), "utf8").split(" ")[0] : null;
  const said = binary && existsSync(binary) ? spawnSync(binary, ["--version"], { encoding: "utf8" }).stdout : "";
  return /\(PostgreSQL\) ([\d.]+)/.exec(said ?? "")?.[1] ?? "of an unknown version";
}

export const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

export const relative = (file) => file.replace(/^.*?\/checkout\//, "");

// What the tests' JSON report (vitest's json reporter) tallies, and the problem with it, or null.
export function testTally(report) {
  if (!report) return { problem: "vitest wrote no report", line: "" };
  const files = report.testResults;
  const tests = files.flatMap((file) => file.assertionResults.map((test) => ({ ...test, file: relative(file.name) })));
  const postgres = files.filter((file) => file.name.endsWith(".postgres.test.ts"));
  const failed = tests.filter((test) => test.status === "failed");
  const skipped = tests.filter((test) => test.status !== "passed" && test.status !== "failed");
  const unloaded = files.filter((file) => file.status === "failed" && file.message);
  const line =
    `${files.length} files, ${tests.length} tests: ${tests.length - failed.length - skipped.length} passed, ${failed.length} failed, ` +
    `${skipped.length} skipped; ${postgres.length} of the files real-Postgres suites (${postgres.reduce((n, file) => n + file.assertionResults.length, 0)} tests)`;
  const names = (list) => list.slice(0, 5).map((test) => `${test.file} > ${test.fullName}`).join("; ");
  const problem = unloaded.length
    ? `${unloaded.map((file) => relative(file.name)).join(", ")} did not load`
    : failed.length
      ? `failed: ${names(failed)}`
      : skipped.length
        ? `skipped, which a check may not: ${names(skipped)}`
        : null;
  return { problem, line };
}

// The output's last lines, indented, for a step that failed.
const tail = (log, lines = 60) =>
  (existsSync(log) ? readFileSync(log, "utf8") : "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trimEnd()
    .split("\n")
    .slice(-lines)
    .map((line) => `    ${line}`)
    .join("\n");

const seconds = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

// CI's settings for the seeds (the step "Seed each local scenario into a second database"), its database aside.
export const SCENARIOS = ["club", "season-over", "empty"];
export const seedSettings = () => ({
  BETTER_AUTH_URL: "http://localhost:3100",
  LICHESS_TEAM_ID: "pretend-team",
  ORGANISER_USER_ID: "org",
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  LICHESS_TOKEN_KEY: randomBytes(32).toString("base64"),
});

// What CI runs on (the Node.js version of setup-node and the Postgres image) beside what this run did, and which commit
// was checked with what else: CI tests only what is committed.
function provenance(checkout, database) {
  const workflow = join(checkout, ".github/workflows/ci.yml");
  const ci = existsSync(workflow) ? readFileSync(workflow, "utf8") : "";
  const node = spawnSync("pnpm", ["exec", "node", "--version"], { cwd: checkout, encoding: "utf8" }).stdout?.trim() || "an unknown version";
  // setup-node's version, or the one package.json gives pnpm when CI reads it from there.
  const runtime = /node-version-file: package.json/.test(ci) ? readJson(join(checkout, "package.json"))?.devEngines?.runtime?.version : null;
  const ciNode = /node-version: (\d+)/.exec(ci)?.[1] ?? runtime ?? "?";
  const versions = `Ran on Node.js ${node} and Postgres ${database ? serverVersion(database.dir) : "(none started)"}; CI runs Node.js ${ciNode} and Postgres ${/image: postgres:(\d+)/.exec(ci)?.[1] ?? "?"}.`;
  let commit;
  try {
    const head = git(["log", "-1", "--format=%h %s"]).trim();
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"]).split("\n").filter(Boolean);
    const untracked = status.filter((line) => line.startsWith("??")).length;
    commit =
      status.length === 0
        ? `Checked ${head}, as committed: what CI tests.`
        : `Checked ${head} with ${status.length - untracked} uncommitted and ${untracked} untracked files, which CI will not see: it tests only what is committed.`;
  } catch {
    commit = "Checked a checkout git could not describe.";
  }
  return [versions, commit];
}

async function check() {
  const problem = environmentProblem();
  if (problem) {
    console.error(problem);
    return 1;
  }
  const began = Date.now();
  const folder = scratch("check");
  const checkout = join(folder, "checkout");
  const results = [];
  let files = [];
  say(`pnpm check, in a copy of this checkout at ${checkout}`);
  // Runs one step, prints how it ended, and keeps its result: `body` resolves to { problem, line } or to an exit code.
  const step = async (name, body) => {
    const log = join(folder, `${name}.log`);
    const started = Date.now();
    let outcome = await body(log);
    if (typeof outcome !== "object") outcome = { problem: outcome === 0 ? null : outcome === null ? "stopped: it ran too long" : `exit ${outcome}` };
    results.push({ name, ...outcome });
    say(`${outcome.problem ? "✗" : "✓"} ${name} (${seconds(Date.now() - started)})`);
    if (outcome.problem) say(`  ${outcome.problem}\n${tail(log)}`);
    return !outcome.problem;
  };
  const pnpm = (args, log, env) => run("pnpm", args, { cwd: checkout, log, env });

  await step("migrations", async () => {
    try {
      const base = git(["merge-base", "origin/main", "HEAD"]).trim();
      const edited = git(["diff", "--name-status", "--diff-filter=a", base, "--", "migrations/"]).trim();
      return edited
        ? { problem: `a merged migration was edited, renamed or removed; add a new one instead:\n    ${edited.replace(/\n/g, "\n    ")}` }
        : { problem: null, line: "none that has merged was edited, against origin/main as last fetched" };
    } catch (error) {
      return { problem: `git could not compare with origin/main: ${String(error.stderr ?? error.message).trim()}` };
    }
  });
  const ready = await step("install", (log) => {
    files = copyCheckout(checkout);
    return pnpm(["install", "--frozen-lockfile", "--prefer-offline"], log);
  });
  let tests = null;
  let seeded = null;
  if (ready)
    await step("empty databases", async (log) => {
      tests = await startDatabase(folder, "tests", log);
      seeded = tests && (await startDatabase(folder, "seeded", log));
      return { problem: seeded ? null : "pnpm db:start failed", line: "two, every migration applied to each" };
    });
  if (ready) await step("lint", (log) => pnpm(["lint"], log));
  if (ready) await step("typecheck", (log) => pnpm(["typecheck"], log));
  if (tests)
    await step("tests", async (log) => {
      const report = join(folder, "tests.json");
      const code = await pnpm(["test", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`], log, {
        ALLOW_DB_TESTS: "1",
        DATABASE_URL: tests.url,
      });
      const tally = testTally(readJson(report));
      const unrun = files.filter((file) => file.endsWith(".test.tsx"));
      const exit = code === 0 ? null : `vitest exited ${code ?? "after too long"}`;
      return { ...tally, problem: tally.problem ?? (unrun.length ? `never run, as vitest runs *.test.ts only: ${unrun.join(", ")}` : exit) };
    });
  if (ready) await step("build", (log) => pnpm(["build"], log));
  if (seeded)
    await step("seeds", async (log) => {
      const settings = { ...seedSettings(), DATABASE_URL: seeded.url };
      const kept = [];
      let failed = null;
      for (const scenario of SCENARIOS) {
        const code = await pnpm(["seed", scenario], log, settings);
        const promised = [...readFileSync(log, "utf8").matchAll(/(\d+) of (\d+) states the "([\w-]+)" scenario promises are there/g)].at(-1);
        kept.push(promised?.[3] === scenario ? `${scenario} ${promised[1]} of ${promised[2]} states` : `${scenario} unknown`);
        if (code !== 0) failed ??= `pnpm seed ${scenario} failed`;
      }
      return { problem: failed, line: kept.join(", ") };
    });

  const about = ready ? provenance(checkout, tests) : [];
  cleanUp(folder);
  const names = ["migrations", "install", "empty databases", "lint", "typecheck", "tests", "build", "seeds"];
  const failed = names.filter((name) => results.find((result) => result.name === name)?.problem !== null);
  say(`\npnpm check ${failed.length ? `failed: ${failed.join(", ")}` : "passed"}, in ${seconds(Date.now() - began)}.`);
  for (const result of results) say(`  ${result.problem ? "✗" : "✓"} ${result.name}${result.line ? `: ${result.line}` : ""}`);
  for (const name of names.filter((name) => !results.some((result) => result.name === name))) say(`  ✗ ${name}: not run`);
  for (const line of about) say(line);
  return failed.length ? 1 : 0;
}

// Run, not imported: pnpm guards imports what is exported above.
if (process.argv[1] && realpathSync(process.argv[1]) === self) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "clean-up") cleanUpAfter(...rest);
  else if (command === undefined)
    check().then(
      (code) => process.exit(code),
      (error) => {
        console.error(error.message);
        process.exit(1);
      },
    );
  else {
    console.error("Usage: pnpm check");
    process.exit(1);
  }
}
