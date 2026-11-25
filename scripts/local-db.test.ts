// The local tools (scripts/local-db.mjs, seed.ts, fake-lichess.ts, fake-telegram.ts, post-to-telegram.ts) refuse anything
// real before they touch it: a database not on this machine, a checkout whose .env.local holds real settings, a Postgres
// db:start did not make, a database without db:start's mark, and a Lichess or Telegram that is not the fake one. Each run of db:start here is in a temporary checkout, so that this checkout's own
// .env.local, the owner's real one included, is never read or changed, and each temporary checkout that starts anything
// is a git repository of its own, so that pnpm local:list and pnpm local:stop there see only what the test started.
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { checkoutProblem, createOnce, madeByDbStart, MARK, notLocal } from "./local-db.mjs";

const REAL = "postgres://someone:a-pretend-password@ep-pretend-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgres://offboard@127.0.0.1:55432/offboard";

describe("which databases count as on this machine", () => {
  it("lets through localhost, 127.0.0.1 and ::1", () => {
    for (const url of [LOCAL, "postgresql://u:p@localhost/db", "postgres://u@[::1]:5432/db"]) expect(notLocal(url)).toBeNull();
  });

  it("refuses any other host, a host in the query string, which pg prefers, spaces and anything not postgres://", () => {
    const refused = [REAL, "postgres://u@localhost.example.com/db", "postgres://u@127.0.0.2/db", "postgres://u@%2Ftmp/db"];
    refused.push("postgres://u@localhost/db?host=ep-pretend-123.neon.tech", ` ${LOCAL}`, `${LOCAL} `, "postgres://u@local\thost/db");
    refused.push("postgres:///db", "//localhost/db", "mysql://localhost/db", "");
    for (const url of [...refused, undefined]) expect(notLocal(url)).toMatch(/^DATABASE_URL/);
  });
});

describe("a checkout's .env.local", () => {
  it("holds real settings unless its DATABASE_URL is on this machine", () => {
    expect(checkoutProblem(null)).toBeNull();
    expect(checkoutProblem(`BETTER_AUTH_URL=http://localhost:3100\nDATABASE_URL=${LOCAL}\n`)).toBeNull();
    expect(checkoutProblem(`DATABASE_URL="${LOCAL}"\n`)).toBeNull();
    for (const text of [`DATABASE_URL=${REAL}\n`, `DATABASE_URL="${REAL}"\n`, 'LINKEDIN_CLIENT_ID="a-pretend-id"\n', ""])
      expect(checkoutProblem(text)).toMatch(/^This checkout's \.env\.local holds real settings/);
  });

  it("is created when there is none, and an existing one is never changed", () => {
    const file = join(mkdtempSync(join(tmpdir(), "offboard-env-")), ".env.local");
    expect(createOnce(file, "DATABASE_URL=one\n")).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(createOnce(file, "DATABASE_URL=two\n")).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("DATABASE_URL=one\n");
  });
});

const run = (command: string, args: string[], env: Record<string, string | undefined> = {}) =>
  spawnSync(command, args, { env: { ...process.env, DATABASE_URL: undefined, ...env }, encoding: "utf8" });
const tsx = "node_modules/.bin/tsx";

// A temporary checkout holding only scripts/local-db.mjs, which refuses before it needs anything else.
function checkout(envLocal?: string) {
  const root = mkdtempSync(join(tmpdir(), "offboard-checkout-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync("scripts/local-db.mjs", join(root, "scripts/local-db.mjs"));
  if (envLocal !== undefined) writeFileSync(join(root, ".env.local"), envLocal);
  return { root, script: join(root, "scripts/local-db.mjs") };
}

// Exits with 1, one line on stderr and nothing on stdout.
function refuses(command: string, args: string[], pattern: RegExp, env: Record<string, string> = {}) {
  const { status, stdout, stderr } = run(command, args, env);
  expect([status, stdout, stderr.trim().split("\n")]).toEqual([1, "", [expect.stringMatching(pattern)]]);
}

describe("refusing before touching anything", () => {
  it("db:start in a checkout whose .env.local holds real settings, or is a link to nothing", () => {
    const real = `DATABASE_URL=${REAL}\nLINKEDIN_CLIENT_SECRET=the-owners\n`;
    const owners = checkout(real);
    const dangling = checkout();
    symlinkSync(join(dangling.root, "nowhere"), join(dangling.root, ".env.local"));
    for (const { root, script } of [owners, dangling]) {
      refuses(process.execPath, [script, "start"], /^This checkout's \.env\.local holds real settings.*belongs in a worktree/);
      expect(existsSync(join(root, ".local-db"))).toBe(false);
    }
    expect(readFileSync(join(owners.root, ".env.local"), "utf8")).toBe(real);
  });

  it("db:start beside a real DATABASE_URL, a Postgres it did not make, dev:local without its block, unknown arguments", () => {
    const { root, script } = checkout();
    refuses(process.execPath, [script, "start"], /^Refusing.*ep-pretend-123.*not this machine/, { DATABASE_URL: REAL });
    const theirs = mkdtempSync(join(tmpdir(), "offboard-theirs-"));
    writeFileSync(join(theirs, "PG_VERSION"), "14\n");
    for (const command of ["start", "stop", "dev"])
      refuses(process.execPath, [script, command, "--dir", theirs], /holds a Postgres that db:start did not make/);
    refuses(process.execPath, [script, "dev"], /^\.env\.local is not .*offboard\.env, so the site was not started/);
    for (const args of [["start", "--site-port", "3000"], ["stop", "--port", "55432"], ["list", "--dir", root], ["stop-all", "--port", "55432"], ["--help"], []])
      refuses(process.execPath, [script, ...args], /^Usage: pnpm db:start/);
    expect(existsSync(join(root, ".local-db"))).toBe(false);
  });

  it("the seed, the fake Lichess and collecting results on a real DATABASE_URL, or with any argument they do not take", () => {
    const scripts = [
      ["scripts/seed.ts", /^Usage: pnpm seed/],
      ["scripts/fake-lichess.ts", /^Usage: pnpm fake-lichess/],
      ["scripts/collect-results.ts", /^Usage: pnpm collect-results/],
    ] as const;
    for (const [script, usage] of scripts) {
      refuses(tsx, [script], /^Refusing.*ep-pretend-123.*not this machine/, { DATABASE_URL: REAL });
      for (const arg of ["--help", "constructor"]) refuses(tsx, [script, arg], usage, { DATABASE_URL: LOCAL });
    }
  }, 30_000);

  it("the seed while a Blob store's token is set, as the seed runs the nightly backup", () => {
    const block = { DATABASE_URL: LOCAL, BETTER_AUTH_SECRET: "a-pretend-secret", BETTER_AUTH_URL: "http://localhost:3100", LICHESS_TEAM_ID: "pretend-team" };
    const organiser = { ORGANISER_USER_ID: "org", LICHESS_TOKEN_KEY: Buffer.alloc(32, 1).toString("base64") };
    refuses(tsx, ["scripts/seed.ts"], /^BLOB_READ_WRITE_TOKEN is set, and the seed backs up to no real store: unset it first\.$/, {
      ...block,
      ...organiser,
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_pretendstore_a-pretend-blob-token",
    });
  }, 30_000);

  it("collecting results from anything but a fake Lichess on this machine, which the site follows", () => {
    const refused = /^Refusing to collect results: the site does not follow LICHESS_URL to http:\/\/127\.0\.0\.1:<port>\./;
    const script = "scripts/collect-results.ts";
    refuses(tsx, [script], refused, { DATABASE_URL: LOCAL });
    refuses(tsx, [script], refused, { DATABASE_URL: LOCAL, LICHESS_URL: "https://fake.lichess.example" });
    refuses(tsx, [script], refused, { DATABASE_URL: LOCAL, LICHESS_URL: "http://127.0.0.1:8089", NODE_ENV: "production" });
  }, 30_000);

  it("posting to Telegram on a real DATABASE_URL, to anything but a fake Telegram on this machine, or as of no clear time", () => {
    const script = "scripts/post-to-telegram.ts";
    const fake = { TELEGRAM_URL: "http://127.0.0.1:8189" };
    refuses(tsx, [script], /^Refusing to post: DATABASE_URL's host is ep-pretend-123.*not this machine/, { DATABASE_URL: REAL, ...fake });
    const refused = /^Refusing to post: the site does not follow TELEGRAM_URL to http:\/\/127\.0\.0\.1:<port>\./;
    refuses(tsx, [script], refused, { DATABASE_URL: LOCAL });
    refuses(tsx, [script], refused, { DATABASE_URL: LOCAL, TELEGRAM_URL: "https://api.telegram.org" });
    refuses(tsx, [script], refused, { DATABASE_URL: LOCAL, ...fake, NODE_ENV: "production" });
    // A time without its offset could be any of three in Vilnius's year.
    for (const args of [["--help"], ["constructor"], ["2026-11-29T10:00"], ["2026-11-29T10:00+02:00", "again"]])
      refuses(tsx, [script, ...args], /^Usage: pnpm post-to-telegram/, { DATABASE_URL: LOCAL, ...fake });
  }, 30_000);

  it("the fake Telegram anywhere but on this machine, or with any argument", () => {
    const script = "scripts/fake-telegram.ts";
    refuses(tsx, [script], /^Refusing to start the fake Telegram: TELEGRAM_URL is not http:\/\/127\.0\.0\.1:<port>\./, { TELEGRAM_URL: "https://api.telegram.org" });
    refuses(tsx, [script, "--help"], /^Usage: pnpm fake-telegram/, { TELEGRAM_URL: "http://127.0.0.1:8189" });
  }, 30_000);

  it("the mark CI writes on the database it seeds is db:start's", () => {
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain(`comment on database seeded is '${MARK}'`);
  });
});

// On a database of its own, made and dropped here on a local server, which db:start did not make and so has no mark, as
// a real database with nobody in it yet behind a forwarded port would not. Opt-in, as the other real-Postgres tests are.
const local = process.env.ALLOW_DB_TESTS === "1" && notLocal(process.env.DATABASE_URL) === null;
describe.skipIf(!local)("a database db:start did not make", () => {
  it("is refused by the seed before its first statement changes anything", async () => {
    const name = `offboard_unmarked_${process.pid}`;
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(`create database ${name}`);
      const url = new URL(process.env.DATABASE_URL!);
      url.pathname = `/${name}`;
      const { status, stderr } = run(tsx, ["scripts/seed.ts"], {
        DATABASE_URL: url.toString(),
        BETTER_AUTH_SECRET: "a-pretend-secret",
        BETTER_AUTH_URL: "http://localhost:3100",
        LICHESS_TEAM_ID: "pretend-team",
        ORGANISER_USER_ID: "org",
        LICHESS_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
      });
      expect(status).toBe(1);
      expect(stderr.trim()).toBe("Refusing: this database was not made by pnpm db:start, so the seed leaves it alone.");
    } finally {
      await admin.query(`drop database if exists ${name}`);
      await admin.end();
    }
  }, 30_000);

  it("is refused by pnpm collect-results before it records a run, even when migrated", async () => {
    const name = `offboard_unmarked_collect_${process.pid}`;
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    const unmarked = new pg.Client({ connectionString: url.toString() });
    let connected = false;
    try {
      await admin.query(`create database ${name}`);
      expect(run(process.execPath, ["scripts/migrate.mjs"], { DATABASE_URL: url.toString() }).status).toBe(0);
      const { status, stderr } = run(tsx, ["scripts/collect-results.ts"], {
        DATABASE_URL: url.toString(),
        LICHESS_URL: "http://127.0.0.1:8089",
        LICHESS_TEAM_ID: "pretend-team",
      });
      expect(stderr.trim()).toBe("Refusing: this database was not made by pnpm db:start, so collecting results leaves it alone.");
      expect(status).toBe(1);
      await unmarked.connect();
      connected = true;
      expect((await unmarked.query(`select count(*)::int as n from "scheduledJob"`)).rows).toEqual([{ n: 0 }]);
    } finally {
      if (connected) await unmarked.end();
      await admin.query(`drop database if exists ${name}`);
      await admin.end();
    }
  }, 30_000);
});

describe("a run on another major version of Node.js", () => {
  it("says so in one line before anything else", () => {
    const { root, script } = checkout();
    const runtime = (version: string) => JSON.stringify({ devEngines: { runtime: { name: "node", version, onFail: "download" } } });
    writeFileSync(join(root, "package.json"), runtime("1.x"));
    const notice = `This is Node.js ${process.versions.node}, and CI runs Node.js 1: run it through pnpm, which uses the Node.js of package.json's devEngines.runtime.`;
    const { status, stderr } = run(process.execPath, [script, "--help"]);
    expect([status, stderr.trim().split("\n")]).toEqual([1, [notice, expect.stringMatching(/^Usage: pnpm db:start/)]]);
    writeFileSync(join(root, "package.json"), runtime(`${process.versions.node.split(".")[0]}.x`));
    refuses(process.execPath, [script, "--help"], /^Usage: pnpm db:start/);
  });

  it("is not how pnpm runs the tests: on package.json's devEngines.runtime, which CI's setup-node reads too", () => {
    const wanted = JSON.parse(readFileSync("package.json", "utf8")).devEngines.runtime;
    expect(wanted).toEqual({ name: "node", version: expect.stringMatching(/^\d+\.x$/), onFail: "download" });
    expect(`${process.versions.node.split(".")[0]}.x`).toBe(wanted.version);
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain("node-version-file: package.json");
  });
});

// A folder of pretend Postgres programs: pg_ctl reports `version`, and initdb refuses, which ends a db:start there.
function pretendPostgres(dir: string, version: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pg_ctl"), `#!/bin/sh\n[ "$1" = --version ] && echo "pg_ctl (PostgreSQL) ${version}" && exit 0\nexit 1\n`, { mode: 0o755 });
  writeFileSync(join(dir, "initdb"), "#!/bin/sh\necho 'pretend initdb' >&2\nexit 1\n", { mode: 0o755 });
  return dir;
}

// A checkout whose CI runs Postgres 98, which no machine has, so that only pretend programs are of its version.
function ciOn98() {
  const { root, script } = checkout();
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), "services:\n  postgres:\n    image: postgres:98\n");
  return { root, script };
}

describe("the Postgres db:start runs", () => {
  it("is of CI's major version when one is installed, even when another is first on PATH or newer, and it says which", () => {
    const { root, script } = ciOn98();
    const first = pretendPostgres(join(root, "path"), "14.22");
    const newer = pretendPostgres(join(root, "newer"), "99.0");
    const keg = pretendPostgres(join(root, "brew/opt/postgresql@98/bin"), "98.1");
    const PATH = `${first}:${newer}:/usr/bin:/bin`;
    const { status, stdout, stderr } = run(process.execPath, [script, "start"], { PATH, HOMEBREW_PREFIX: join(root, "brew") });
    expect(stdout.split("\n")[0]).toBe(`Postgres 98.1, CI's major version, from ${keg}.`);
    expect([status, stderr]).toEqual([1, expect.stringContaining("pretend initdb")]);
  });

  it("is the newest installed otherwise, and it says plainly that it is not CI's", () => {
    const { root, script } = ciOn98();
    const older = pretendPostgres(join(root, "older"), "14.22");
    const newer = pretendPostgres(join(root, "newer"), "97.3");
    const { stdout } = run(process.execPath, [script, "start"], { PATH: `${older}:${newer}:/usr/bin:/bin`, HOMEBREW_PREFIX: join(root, "no-brew") });
    expect(stdout.split("\n")[0]).toBe(
      `Postgres 97.3 from ${newer}, not CI's 98, as no Postgres 98 was found on PATH, in Homebrew or in /usr/lib/postgresql (brew install postgresql@98).`,
    );
  });
});

// Every temporary repository below, whose leftovers afterAll stops should a test fail part-way, and every process a
// test started itself.
const repositories: string[] = [];
const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) child.kill();
  for (const root of repositories) tool(root, "stop-all");
});

const tool = (root: string, ...args: string[]) => run(process.execPath, [join(root, "scripts/local-db.mjs"), ...args]);
const gitEnv = { ...process.env };
for (const name of Object.keys(gitEnv)) if (name.startsWith("GIT_")) delete gitEnv[name];
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=Pretend", "-c", "user.email=pretend@example.invalid", ...args], { env: gitEnv, stdio: "ignore" });
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const freePort = () =>
  new Promise<number>((done) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => done(port));
    });
  });

// The files db:start, the migrations and the fake Telegram read, and this checkout's node_modules, put in `root`.
function fill(root: string) {
  const files = ["scripts/local-db.mjs", "scripts/migrate.mjs", "scripts/fake-telegram.ts", "lib/fixtures/fake-telegram.ts", ".github/workflows/ci.yml", "package.json", "tsconfig.json"];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(file, join(root, file));
  }
  cpSync("migrations", join(root, "migrations"), { recursive: true });
  symlinkSync(resolve("node_modules"), join(root, "node_modules"));
  return root;
}

// A temporary checkout that is a git repository of its own, with a commit, so that it can have worktrees.
function repository() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "offboard-repository-")));
  git(root, "init", "-q");
  git(root, "commit", "-q", "--allow-empty", "-m", "pretend");
  repositories.push(root);
  return fill(root);
}

const blockIn = (dir: string) => readFileSync(join(dir, "offboard.env"), "utf8");
const databaseUrl = (text: string) => /^DATABASE_URL=(.*)$/m.exec(text)![1];
async function query(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return { rows: (await client.query(sql)).rows, marked: await madeByDbStart(client) };
  } finally {
    await client.end();
  }
}
// Holds `port` on 127.0.0.1 until released, as another worktree's Postgres or site would.
async function squat(port: number) {
  const server = net.createServer();
  await new Promise<void>((listening) => server.listen(port, "127.0.0.1", listening));
  return () => new Promise<void>((closed) => server.close(() => closed()));
}

describe("db:start in a folder it has used before", () => {
  const root = repository();
  const dir = join(root, ".local-db");
  const envLocal = join(root, ".env.local");
  let first = "";

  it("starts on the first free ports when its own have been taken since, and rewrites its block and the .env.local that was it", async () => {
    const started = tool(root, "start");
    expect(started.status, started.stderr).toBe(0);
    const [, version] = /^Postgres ([\d.]+)(?:, CI's major version,)? from \//m.exec(started.stdout)!;
    first = blockIn(dir);
    expect(readFileSync(envLocal, "utf8")).toBe(first);
    expect((await query(databaseUrl(first), "show server_version")).rows[0].server_version).toMatch(new RegExp(`^${version.replaceAll(".", "\\.")}\\b`));
    expect(tool(root, "stop").status).toBe(0);

    const release = await squat(Number(new URL(databaseUrl(first)).port));
    try {
      const again = tool(root, "start");
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toMatch(new RegExp(`^The ports ${dir} had are taken now, so it has the first free set: \\d+, \\d+, \\d+, \\d+\\.$`, "m"));
      expect(again.stdout).toContain(".env.local, which was its block, has the new ports.");
      const moved = blockIn(dir);
      expect(new URL(databaseUrl(moved)).port).not.toBe(new URL(databaseUrl(first)).port);
      expect(moved.replace(/:\d+\b/g, ":<port>")).toBe(first.replace(/:\d+\b/g, ":<port>")); // the same database and secrets
      expect(readFileSync(envLocal, "utf8")).toBe(moved);
      expect(await query(databaseUrl(moved), "select 1 as one")).toEqual({ rows: [{ one: 1 }], marked: true });
    } finally {
      await release();
    }
  }, 60_000);

  it("moves again without changing a .env.local that is not its block", async () => {
    expect(tool(root, "stop").status).toBe(0);
    const before = blockIn(dir);
    const theirs = `${before}# a line of the agent's own\n`;
    writeFileSync(envLocal, theirs);
    const release = await squat(Number(new URL(databaseUrl(before)).port));
    try {
      const again = tool(root, "start");
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toContain(`.env.local was left as it was: it is not this database's block (${dir}/offboard.env).`);
      expect(blockIn(dir)).not.toBe(before);
      expect(readFileSync(envLocal, "utf8")).toBe(theirs);
    } finally {
      await release();
    }
  }, 60_000);

  it("makes a folder of another major version again, empty, and starts it", async () => {
    const block = blockIn(dir);
    await query(databaseUrl(block), "create table left_behind ()");
    expect(tool(root, "stop").status).toBe(0);
    const major = readFileSync(join(dir, "PG_VERSION"), "utf8").trim();
    writeFileSync(join(dir, "PG_VERSION"), "9\n");
    const again = tool(root, "start");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain(`${dir} was made by Postgres 9, which Postgres ${major} cannot open, so it was made again, empty.`);
    expect(readFileSync(join(dir, "PG_VERSION"), "utf8").trim()).toBe(major);
    expect(blockIn(dir)).toBe(block);
    const { rows, marked } = await query(databaseUrl(block), "select to_regclass('left_behind') as table, (select count(*)::int from schema_migrations) as migrations");
    expect([rows, marked]).toEqual([[{ table: null, migrations: readdirSync("migrations").length }], true]);
    expect(tool(root, "stop").status).toBe(0);
  }, 60_000);
});

// The fake Telegram, started in `root` as pnpm fake-telegram starts it, once it says it is listening.
async function fakeTelegram(root: string) {
  const port = await freePort();
  const child = spawn(join(root, "node_modules/.bin/tsx"), ["scripts/fake-telegram.ts"], {
    cwd: root,
    env: { ...process.env, TELEGRAM_URL: `http://127.0.0.1:${port}` },
  });
  children.push(child);
  await new Promise<void>((listening, failed) => {
    child.stdout!.on("data", (chunk) => String(chunk).includes("The fake Telegram is at") && listening());
    child.once("exit", (code) => failed(new Error(`The fake Telegram exited with ${code}.`)));
  });
  return port;
}

// The lines of pnpm local:list, or of pnpm local:stop without their "Stopped: ".
const rows = (stdout: string) =>
  stdout
    .trim()
    .split("\n")
    .map((line) => {
      const row = /^(?:Stopped: )?(Postgres|site|fake Lichess|fake Telegram) +(\d+) +\d+ (?:min|h \d+ min|d \d+ h) +(\/.*?)( \(folder gone\))?$/.exec(line);
      return row ? { kind: row[1], port: Number(row[2]), folder: row[3], gone: Boolean(row[4]) } : { line };
    });

describe("pnpm local:list and pnpm local:stop", () => {
  it("list and stop what these tools started in each worktree of the repository, also once its folder is gone, and nothing else", async () => {
    const main = repository();
    const worktree = `${main}-worktree`;
    git(main, "worktree", "add", "-q", "--detach", worktree);
    fill(worktree);
    const other = repository(); // another project's

    const started = tool(worktree, "start");
    expect(started.status, started.stderr).toBe(0);
    const bin = / from (\/\S+?)[.,](?:\s|$)/m.exec(started.stdout)![1];
    const postgres = { port: Number(new URL(databaseUrl(blockIn(join(worktree, ".local-db")))).port), pid: Number(readFileSync(join(worktree, ".local-db/postmaster.pid"), "utf8").split("\n")[0]) };
    // A Postgres in the same worktree that db:start did not start, and a server standing in for the owner's site.
    let theirs = join(worktree, ".theirs");
    execFileSync(`${bin}/initdb`, ["-D", theirs, "-U", "theirs", "--auth=trust", "--no-locale", "-E", "UTF8"], { stdio: "ignore" });
    const options = `-c listen_addresses=127.0.0.1 -p ${await freePort()} -c unix_socket_directories=''`;
    execFileSync(`${bin}/pg_ctl`, ["-D", theirs, "-l", join(theirs, "log"), "-o", options, "-w", "start"], { stdio: "ignore" });
    const site = spawn(process.execPath, ["-e", "require('node:http').createServer().listen(0, '127.0.0.1')"], { cwd: worktree });
    children.push(site);
    try {
      const fakes = { main: await fakeTelegram(main), worktree: await fakeTelegram(worktree), other: await fakeTelegram(other) };
      const listed = tool(main, "list");
      expect(listed.status).toBe(0);
      const ours = [
        { kind: "Postgres", port: postgres.port, folder: join(worktree, ".local-db"), gone: false },
        { kind: "fake Telegram", port: fakes.main, folder: main, gone: false },
        { kind: "fake Telegram", port: fakes.worktree, folder: worktree, gone: false },
      ];
      expect(rows(listed.stdout)).toHaveLength(3);
      expect(rows(listed.stdout)).toEqual(expect.arrayContaining(ours));
      expect(rows(tool(other, "list").stdout)).toEqual([{ kind: "fake Telegram", port: fakes.other, folder: other, gone: false }]);

      // A record of another process, whose start or command line is not what it was recorded with, is not this tool's.
      const [, start, command] = /^(\w{3} \w{3} +\d+ [\d:]{8} \d{4}) +(.*)$/.exec(
        execFileSync("ps", ["-ww", "-o", "lstart=,command=", "-p", String(site.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim(),
      )!;
      const record = join(main, ".git/offboard-local", `${site.pid}.json`);
      for (const forged of [{ start: start.replace(/\d{4}$/, "2001"), command }, { start, command: `${command} --another` }]) {
        writeFileSync(record, JSON.stringify({ kind: "site", port: 3000, folder: worktree, pid: site.pid, ...forged }));
        expect(rows(tool(main, "list").stdout)).toHaveLength(3);
        expect(existsSync(record)).toBe(false);
      }

      // The worktree's folder gone from where it was, as a removed one would be: Postgres runs on in a moved one.
      renameSync(worktree, `${worktree}-moved`);
      theirs = join(`${worktree}-moved`, ".theirs");
      const orphans = ours.map((each) => (each.folder.startsWith(worktree) ? { ...each, gone: true } : each));
      expect(rows(tool(main, "list").stdout)).toEqual(expect.arrayContaining(orphans));

      const stopped = tool(main, "stop-all", "--dir", worktree);
      expect(stopped.status, stopped.stderr).toBe(0);
      expect(stopped.stdout).toMatch(/^Stopped: /);
      expect(rows(stopped.stdout)).toEqual(expect.arrayContaining(orphans.filter(({ gone }) => gone)));
      expect(rows(stopped.stdout)).toHaveLength(2);
      expect(alive(postgres.pid)).toBe(false);
      expect(rows(tool(main, "list").stdout)).toEqual([ours[1]]);
      expect(spawnSync(`${bin}/pg_ctl`, ["-D", theirs, "status"]).status).toBe(0);
      expect(alive(site.pid!)).toBe(true);

      expect(rows(tool(main, "stop-all").stdout)).toEqual([ours[1]]);
      expect(tool(main, "list").stdout).toBe("Nothing these tools started is running.\n");
      expect(rows(tool(other, "list").stdout)).toEqual([{ kind: "fake Telegram", port: fakes.other, folder: other, gone: false }]);
      expect(rows(tool(other, "stop-all").stdout)).toHaveLength(1);
      expect(tool(other, "list").stdout).toBe("Nothing these tools started is running.\n");
      expect(alive(site.pid!)).toBe(true);
    } finally {
      spawnSync(`${bin}/pg_ctl`, ["-D", theirs, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
      site.kill();
    }
  }, 120_000);
});
