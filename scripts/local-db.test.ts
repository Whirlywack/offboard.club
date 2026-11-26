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
  rmSync,
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

// Every temporary folder a test makes, which afterAll (at the end) removes, failed or not, and then checks is gone.
const temporary: string[] = [];
function scratch(name: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `offboard-${name}-`)));
  temporary.push(dir);
  return dir;
}

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
    const file = join(scratch("env"), ".env.local");
    expect(createOnce(file, "DATABASE_URL=one\n")).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(createOnce(file, "DATABASE_URL=two\n")).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("DATABASE_URL=one\n");
  });
});

// What a child of these tests is given of this process's environment, with `extra`: nothing the caller exported that
// could point it at a real database or at another checkout's processes: no registry, no database, no PG* and no GIT_*
// variable, such as the GIT_DIR git gives a hook run in a worktree, which names the repository's own git folder.
function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const name of Object.keys(env))
    if (!Object.hasOwn(extra, name) && (/^(PG|GIT_)/.test(name) || ["DATABASE_URL", "ALLOW_DB_TESTS", "OFFBOARD_LOCAL_REGISTRY"].includes(name))) delete env[name];
  return env;
}
const run = (command: string, args: string[], env: Record<string, string | undefined> = {}, cwd?: string) =>
  spawnSync(command, args, { cwd, env: childEnv(env), encoding: "utf8" });
const tsx = "node_modules/.bin/tsx";

// A temporary checkout holding only scripts/local-db.mjs, which refuses before it needs anything else.
function checkout(envLocal?: string) {
  const root = scratch("checkout");
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
    const theirs = scratch("theirs");
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


// A folder of pretend Postgres programs: pg_ctl reports `version`, and initdb, if there is one, refuses, which ends a
// db:start there.
function pretendPostgres(dir: string, version: string, { initdb = true } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pg_ctl"), `#!/bin/sh\n[ "$1" = --version ] && echo "pg_ctl (PostgreSQL) ${version}" && exit 0\nexit 1\n`, { mode: 0o755 });
  // It writes down what it was given, and the zone it was given it in, in initdb.args.
  const script = `#!/bin/sh\necho "$@" > "${dir}/initdb.args"\necho "TZ=$TZ" >> "${dir}/initdb.args"\necho 'pretend initdb' >&2\nexit 1\n`;
  if (initdb) writeFileSync(join(dir, "initdb"), script, { mode: 0o755 });
  return dir;
}

// A checkout whose CI runs Postgres 98, which no machine has, so that only pretend programs are of its version: a git
// repository, unless `git` is false, so that db:start gets as far as its Postgres.
function ciOn98({ image = "image: postgres:98", git: repository = true } = {}) {
  const { root, script } = checkout();
  if (repository) git(root, "init", "-q");
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), `services:\n  postgres:\n    ${image}\n`);
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

  it("is never one in a folder PATH names relatively, which is wherever it is run from, nor one without initdb", () => {
    const { root, script } = ciOn98();
    pretendPostgres(join(root, "relative"), "98.1");
    const client = pretendPostgres(join(root, "client"), "98.2", { initdb: false });
    const installed = pretendPostgres(join(root, "installed"), "97.0");
    const { stdout } = run(process.execPath, [script, "start"], { PATH: `relative:${client}:${installed}:/usr/bin:/bin`, HOMEBREW_PREFIX: join(root, "no-brew") }, root);
    expect(stdout.split("\n")[0]).toMatch(new RegExp(`^Postgres 97\\.0 from ${installed}, not CI's 98,`));
  });

  it("makes a database that sorts by code point in UTC: the builtin C.UTF-8 from Postgres 17, C before, and says which", () => {
    const cases = [
      ["18.7", "--locale-provider=builtin --builtin-locale=C.UTF-8 --locale=C.UTF-8", "It sorts text by code point (the builtin C.UTF-8) and keeps time in UTC, as the live database does."],
      ["16.4", "--no-locale", "It sorts text by code point (C, as Postgres 16 has no builtin C.UTF-8, so upper() and lower() change ASCII letters alone, where the live database's change every letter) and keeps time in UTC."],
    ];
    for (const [version, options, said] of cases) {
      const { root, script } = ciOn98({ image: `image: postgres:${version.split(".")[0]}` });
      const pretend = pretendPostgres(join(root, "pg"), version);
      const { stdout } = run(process.execPath, [script, "start"], { PATH: `${pretend}:/usr/bin:/bin`, HOMEBREW_PREFIX: join(root, "no-brew") });
      expect(stdout.split("\n")[1]).toBe(said);
      expect(readFileSync(join(pretend, "initdb.args"), "utf8")).toMatch(new RegExp(` ${options.replaceAll(".", "\\.")}\nTZ=UTC\n$`));
    }
  });

  it("is refused when CI's workflow names no Postgres image", () => {
    const { root, script } = ciOn98({ image: "image: redis:7" });
    const PATH = `${pretendPostgres(join(root, "pg"), "98.1")}:/usr/bin:/bin`;
    const refused = /^No `image: postgres:<major>` was found in \.github\/workflows\/ci\.yml\.$/;
    refuses(process.execPath, [script, "start"], refused, { PATH, HOMEBREW_PREFIX: join(root, "no-brew") });
  });
});

// Every temporary repository below, whose leftovers afterAll stops should a test fail part-way, and every process a
// test started itself. Then every temporary folder is removed, and a run that leaves one fails.
const repositories: string[] = [];
const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) child.kill();
  for (const root of repositories) tool(root, "stop-all", "--all");
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  expect(temporary.filter((dir) => existsSync(dir))).toEqual([]);
});

const tool = (root: string, ...args: string[]) => run(process.execPath, [join(root, "scripts/local-db.mjs"), ...args]);
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=Pretend", "-c", "user.email=pretend@example.invalid", ...args], { env: childEnv(), stdio: "ignore" });
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
// `pid` and every process under it.
function descendants(pid: number) {
  const pairs = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const found = [pid];
  for (let i = 0; i < found.length; i++) for (const [child, parent] of pairs) if (parent === found[i]) found.push(child);
  return found;
}

// The files db:start, the migrations, the fake Telegram and next dev read, and this checkout's node_modules, put in `root`.
function fill(root: string) {
  const files = ["scripts/local-db.mjs", "scripts/migrate.mjs", "scripts/fake-telegram.ts", "lib/fixtures/fake-telegram.ts", ".github/workflows/ci.yml", "package.json", "tsconfig.json"];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(file, join(root, file));
  }
  cpSync("migrations", join(root, "migrations"), { recursive: true });
  symlinkSync(resolve("node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app/layout.tsx"), "export default function Layout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n");
  writeFileSync(join(root, "app/page.tsx"), "export default function Page() {\n  return <p>pretend</p>;\n}\n");
  return root;
}

// A temporary checkout that is a git repository of its own, with a commit, so that it can have worktrees.
function repository() {
  const root = scratch("repository");
  git(root, "init", "-q");
  git(root, "commit", "-q", "--allow-empty", "-m", "pretend");
  repositories.push(root);
  return fill(root);
}

// The fake Telegram, started in `root` as pnpm fake-telegram starts it, on `port` or a free one, once it is listening.
async function fakeTelegram(root: string, { port = 0, env = {} }: { port?: number; env?: Record<string, string> } = {}) {
  const at = port || (await freePort());
  const child = spawn(join(root, "node_modules/.bin/tsx"), ["scripts/fake-telegram.ts"], {
    cwd: root,
    env: childEnv({ TELEGRAM_URL: `http://127.0.0.1:${at}`, ...env }),
  });
  children.push(child);
  await new Promise<void>((listening, failed) => {
    child.stdout!.on("data", (chunk) => String(chunk).includes("The fake Telegram is at") && listening());
    child.once("exit", (code) => failed(new Error(`The fake Telegram exited with ${code}.`)));
  });
  return at;
}

describe("what these tools start is recorded", () => {
  it("only in a git checkout: outside one, db:start and the fakes start nothing", async () => {
    const { root, script } = ciOn98({ git: false });
    const PATH = `${pretendPostgres(join(root, "pg"), "98.1")}:/usr/bin:/bin`;
    const why = `${realpathSync(root)} is not a git checkout, where these tools record what they start, so nothing was started.`;
    refuses(process.execPath, [script, "start"], new RegExp(`^${why.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), { PATH, HOMEBREW_PREFIX: join(root, "no-brew") });
    expect(existsSync(join(root, ".local-db"))).toBe(false);

    // Its port held, so that a fake that listened first would fail on that instead.
    const plain = fill(scratch("checkout"));
    const port = await freePort();
    const release = await squat(port);
    try {
      const fake = run(join(plain, "node_modules/.bin/tsx"), ["scripts/fake-telegram.ts"], { TELEGRAM_URL: `http://127.0.0.1:${port}` }, plain);
      expect([fake.status, fake.stdout, fake.stderr]).toEqual([1, "", expect.stringContaining(`${plain} is not a git checkout`)]);
    } finally {
      await release();
    }
  }, 30_000);

  it("in a checkout that is a fresh git repository, with no commit and no remote, as pnpm check makes its copy", () => {
    const root = fill(scratch("checkout"));
    git(root, "init", "-q");
    repositories.push(root);
    const started = tool(root, "start");
    expect(started.status, started.stderr).toBe(0);
    const postgres = { kind: "Postgres", port: portIn(blockIn(join(root, ".local-db")), "DATABASE_URL"), folder: join(root, ".local-db"), gone: false };
    expect(rows(tool(root, "list").stdout)).toEqual([postgres]);
    expect(tool(root, "stop").status).toBe(0);
    expect(tool(root, "list").stdout).toBe("Nothing these tools started is running.\n");
    expect(tool(root, "start").status).toBe(0);
    // On the ports it has now, which another checkout's db:start may have taken from it while it was stopped.
    const again = { ...postgres, port: portIn(blockIn(join(root, ".local-db")), "DATABASE_URL") };
    expect(rows(tool(root, "stop-all", "--dir", root).stdout)).toEqual([again]);
  }, 60_000);

  it("from a copy that is no git checkout, where OFFBOARD_LOCAL_REGISTRY names the repository's, with the repository's", () => {
    const repo = repository();
    const copy = fill(scratch("checkout"));
    const script = join(copy, "scripts/local-db.mjs");
    const started = run(process.execPath, [script, "start"], { OFFBOARD_LOCAL_REGISTRY: join(repo, ".git/offboard-local") });
    expect(started.status, started.stderr).toBe(0);
    expect(tool(repo, "list").stdout).toContain(`${join(copy, ".local-db")}, from worktree ${copy}\n`);
    const postgres = { kind: "Postgres", port: portIn(blockIn(join(copy, ".local-db")), "DATABASE_URL"), folder: join(copy, ".local-db"), gone: false };
    expect(rows(tool(repo, "stop-all", "--all").stdout)).toEqual([postgres]);
    refuses(process.execPath, [script, "start"], /^OFFBOARD_LOCAL_REGISTRY is "offboard-local", not an absolute path, so nothing was started\.$/, { OFFBOARD_LOCAL_REGISTRY: "offboard-local" });
  }, 60_000);

  it("by these tests in their own repositories' registries, whatever OFFBOARD_LOCAL_REGISTRY their caller exported", () => {
    const repo = repository();
    const exported = scratch("registry");
    const running = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: childEnv() });
    children.push(running);
    const [, start, command] = /^(\w{3} \w{3} +\d+ [\d:]{8} \d{4}) +(.*)$/.exec(
      execFileSync("ps", ["-ww", "-o", "lstart=,command=", "-p", String(running.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(),
    )!;
    // A true record there of a running process, as the repository's own registry holds every worktree's.
    writeFileSync(join(exported, `${running.pid}.json`), JSON.stringify({ kind: "site", port: 3000, folder: exported, worktree: exported, pid: running.pid, start, command }));
    process.env.OFFBOARD_LOCAL_REGISTRY = exported;
    try {
      expect(tool(repo, "list").stdout).toBe("Nothing these tools started is running.\n");
      expect(tool(repo, "stop-all", "--all").stdout).toBe("Nothing these tools started is running.\n");
      expect(alive(running.pid!)).toBe(true);
    } finally {
      delete process.env.OFFBOARD_LOCAL_REGISTRY;
    }
  });

  it("by these tests in their own repositories' registries, whatever GIT_DIR their caller exported, as git does for a hook", () => {
    const repo = repository();
    const another = repository(); // with a true record of a running process in its git folder, as the main checkout's is
    const running = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: childEnv() });
    children.push(running);
    const [, start, command] = /^(\w{3} \w{3} +\d+ [\d:]{8} \d{4}) +(.*)$/.exec(
      execFileSync("ps", ["-ww", "-o", "lstart=,command=", "-p", String(running.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(),
    )!;
    mkdirSync(join(another, ".git/offboard-local"));
    writeFileSync(join(another, ".git/offboard-local", `${running.pid}.json`), JSON.stringify({ kind: "site", port: 3000, folder: another, worktree: another, pid: running.pid, start, command }));
    process.env.GIT_DIR = join(another, ".git");
    try {
      expect(tool(repo, "list").stdout).toBe("Nothing these tools started is running.\n");
      expect(tool(repo, "stop-all", "--all").stdout).toBe("Nothing these tools started is running.\n");
      expect(alive(running.pid!)).toBe(true);
    } finally {
      delete process.env.GIT_DIR;
    }
  });

  it("only while its process runs", () => {
    const root = repository();
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    const code = `const { recorder } = await import(${JSON.stringify(join(root, "scripts/local-db.mjs"))}); recorder()("site", 3000, { pid: ${gone} });`;
    const { status, stderr } = run(process.execPath, ["--input-type=module", "-e", code]);
    expect([status, stderr]).toEqual([1, expect.stringContaining(`site (process ${gone}) is not running, so it was not recorded.`)]);
    expect(existsSync(join(root, ".git/offboard-local", `${gone}.json`))).toBe(false);
  });
});

const blockIn = (dir: string) => readFileSync(join(dir, "offboard.env"), "utf8");
const urlIn = (text: string, name: string) => new URL(new RegExp(`^${name}=(.*)$`, "m").exec(text)![1]);
const databaseUrl = (text: string) => urlIn(text, "DATABASE_URL").toString();
const portIn = (text: string, name: string) => Number(urlIn(text, name).port);
async function query(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return { rows: (await client.query(sql)).rows, marked: await madeByDbStart(client) };
  } finally {
    await client.end();
  }
}
// Holds `port` on 127.0.0.1 until released, as another worktree's Postgres or site would. It tries for 3 s, past another
// db:start's passing test of the port; a port another checkout's process holds that long is left to that one to hold.
async function squat(port: number) {
  const server = net.createServer();
  for (let tries = 0; ; tries++) {
    const listening = await new Promise<boolean>((done) => server.once("error", () => done(false)).listen(port, "127.0.0.1", () => done(true)));
    if (listening) return () => new Promise<void>((closed) => server.close(() => closed()));
    if (tries === 60) return async () => {};
    await new Promise((done) => setTimeout(done, 50));
  }
}

describe("db:start in a folder it has used before", () => {
  const root = repository();
  const dir = join(root, ".local-db");
  const envLocal = join(root, ".env.local");

  it("keeps its data, its block and .env.local when its ports are free or held by its own fakes, and refuses another --port", async () => {
    const started = tool(root, "start");
    expect(started.status, started.stderr).toBe(0);
    const [, version] = /^Postgres ([\d.]+)(?:, CI's major version,)? from \//m.exec(started.stdout)!;
    const first = blockIn(dir);
    expect(readFileSync(envLocal, "utf8")).toBe(first);
    expect((await query(databaseUrl(first), "show server_version")).rows[0].server_version).toMatch(new RegExp(`^${version.replaceAll(".", "\\.")}\\b`));
    await query(databaseUrl(first), "create table kept ()");
    // Its own fake, on a port of its set; when another process holds that port already, the set is held all the same.
    const ours = await fakeTelegram(root, { port: portIn(first, "TELEGRAM_URL") }).then(() => true, () => false);
    let stopped: string[] = [];
    try {
      expect(tool(root, "stop").status).toBe(0);
      const again = tool(root, "start");
      expect(again.status, again.stderr).toBe(0);
      // With its own fake holding a port of its set, no other checkout's db:start takes the set, so its ports are as
      // free as it left them, and it stays on them.
      if (ours) expect(again.stdout).not.toContain("taken now");
      // It moves only off a port another process holds, and names it, never off its own fake's. Another checkout's
      // db:start can take a stopped folder's ports, and then it moves, as it must, keeping its data and .env.local in step.
      const takenNow = /had are taken now \(([\d, ]*)\)/.exec(again.stdout)?.[1];
      if (takenNow !== undefined) expect(takenNow).toMatch(/^\d+(, \d+)*$/);
      if (ours) expect(takenNow?.split(", ").map(Number) ?? []).not.toContain(portIn(first, "TELEGRAM_URL"));
      if (!/taken now|taken a moment ago/.test(again.stdout)) expect(blockIn(dir)).toBe(first);
      expect(readFileSync(envLocal, "utf8")).toBe(blockIn(dir));
      expect((await query(databaseUrl(blockIn(dir)), "select to_regclass('kept')::text as kept")).rows).toEqual([{ kept: "kept" }]);
      const postgres = portIn(blockIn(dir), "DATABASE_URL");
      const another = postgres === 55531 ? 55530 : postgres + 1;
      const refused = new RegExp(`^${dir.replaceAll(".", "\\.")} uses port ${postgres}: leave out --port, or give another --dir\\.$`);
      refuses(process.execPath, [join(root, "scripts/local-db.mjs"), "start", "--port", String(another)], refused);
    } finally {
      // What it started, stopped even when it fails, so that the tests after it find the folder as they expect; checked
      // only after, so that a failure above is the one reported.
      stopped = rows(tool(root, "stop-all", "--dir", root).stdout).map(({ kind }) => String(kind));
    }
    expect(stopped.sort()).toEqual(ours ? ["Postgres", "fake Telegram"] : ["Postgres"]);
  }, 60_000);

  it("starts on the first free ports when its own have been taken since, and rewrites its block and the .env.local that was it", async () => {
    // One of its ports held, as another worktree's fake would hold it: so the set is taken, by this test, whatever else runs.
    const first = blockIn(dir);
    const release = await squat(portIn(first, "LICHESS_URL"));
    try {
      const again = tool(root, "start");
      expect(again.status, again.stderr).toBe(0);
      const lichess = portIn(first, "LICHESS_URL");
      expect(again.stdout).toMatch(new RegExp(`^The ports ${dir} had are taken now \\([\\d, ]*\\b${lichess}\\b[\\d, ]*\\), so it has the first free set: \\d+, \\d+, \\d+, \\d+\\.$`, "m"));
      expect(again.stdout).toContain(".env.local, which was its block, has the new ports.");
      const moved = blockIn(dir);
      expect(portIn(moved, "DATABASE_URL")).not.toBe(portIn(first, "DATABASE_URL"));
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
    const release = await squat(portIn(before, "LICHESS_URL"));
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
    // The same database and secrets; its ports may have moved, should another worktree have taken them meanwhile.
    expect(blockIn(dir).replace(/:\d+\b/g, ":<port>")).toBe(block.replace(/:\d+\b/g, ":<port>"));
    const { rows, marked } = await query(databaseUrl(blockIn(dir)), "select to_regclass('left_behind') as table, (select count(*)::int from schema_migrations) as migrations");
    expect([rows, marked]).toEqual([[{ table: null, migrations: readdirSync("migrations").length }], true]);
  }, 60_000);

  it("makes a folder made to sort or keep time otherwise again, empty, sorting by code point in UTC as the live database does", async () => {
    const block = blockIn(dir);
    await query(databaseUrl(block), "create table left_behind ()");
    expect(tool(root, "stop").status).toBe(0);
    rmSync(join(dir, "offboard.initdb")); // as a folder made before it was written has none
    const again = tool(root, "start");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain(`${dir} was made to sort or keep time otherwise than the live database does, so it was made again, empty.`);
    const sql = `select d.datlocprovider as provider, d.datcollate as collate, d.datctype as ctype, current_setting('server_version_num')::int >= 170000 as builtin,
      current_setting('TimeZone') as zone, to_regclass('left_behind') as table from pg_database d where d.datname = current_database()`;
    const [made] = (await query(databaseUrl(blockIn(dir)), sql)).rows;
    // As live, where the builtin provider is; C before Postgres 17 (as on CI's runner, whose Postgres is 16).
    const sorts = made.builtin ? { provider: "b", collate: "C.UTF-8", ctype: "C.UTF-8" } : { provider: "c", collate: "C", ctype: "C" };
    expect(made).toEqual({ ...sorts, builtin: made.builtin, zone: "UTC", table: null });
    expect(readFileSync(join(dir, "offboard.initdb"), "utf8")).toMatch(/ TZ=UTC\n$/);
  }, 60_000);

  it("dev:local runs the site, on a port held for a moment only as it starts, which is listed and stopped with its server", async () => {
    writeFileSync(envLocal, blockIn(dir));
    // Its site's port held as dev:local starts, as another db:start trying it would, and let go 100 ms later: before
    // dev:local asks again whether it is taken, however soon after starting it first asks.
    const release = await squat(portIn(blockIn(dir), "BETTER_AUTH_URL"));
    const dev = spawn(process.execPath, [join(root, "scripts/local-db.mjs"), "dev"], { cwd: root, env: childEnv() });
    setTimeout(() => void release(), 100);
    children.push(dev);
    const exited = new Promise((done) => dev.once("exit", done));
    await new Promise<void>((ready, failed) => {
      dev.stdout!.on("data", (chunk) => String(chunk).includes("Ready in") && ready());
      dev.once("exit", (code) => failed(new Error(`dev:local exited with ${code}.`)));
    });
    const site = { kind: "site", port: portIn(blockIn(dir), "BETTER_AUTH_URL"), folder: root, gone: false };
    // In either order: the two may have started within the same second, which is as finely as ps gives a start.
    const both = [expect.objectContaining({ kind: "Postgres" }), site];
    const listed = rows(tool(root, "list").stdout);
    expect([listed.length, listed]).toEqual([2, expect.arrayContaining(both)]);
    const record = readdirSync(join(root, ".git/offboard-local")).map((name) => JSON.parse(readFileSync(join(root, ".git/offboard-local", name), "utf8")));
    const servers = descendants(record.find(({ kind }) => kind === "site").pid);
    expect(servers.length).toBeGreaterThan(1); // next dev, and the server it starts
    const stopped = rows(tool(root, "stop-all", "--dir", root).stdout);
    expect([stopped.length, stopped]).toEqual([2, expect.arrayContaining(both)]);
    await exited;
    for (let waited = 0; servers.some(alive) && waited < 5_000; waited += 100) await new Promise((done) => setTimeout(done, 100));
    expect(servers.filter(alive)).toEqual([]);
  }, 60_000);
});

describe("db:start beside others starting at the same time", () => {
  let bin = ""; // the folder of the Postgres db:start runs on this machine

  it("gives four at once a set of ports each", async () => {
    const roots = [repository(), repository(), repository(), repository()];
    const starts = roots.map(
      (root) =>
        new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
          const child = spawn(process.execPath, [join(root, "scripts/local-db.mjs"), "start"], { env: childEnv() });
          let [stdout, stderr] = ["", ""];
          child.stdout!.on("data", (chunk) => (stdout += chunk));
          child.stderr!.on("data", (chunk) => (stderr += chunk));
          child.once("exit", (status) => done({ status, stdout, stderr }));
        }),
    );
    const results = await Promise.all(starts);
    // First, as each says which Postgres it runs even when it fails, so that a failure here is no failure of the next tests.
    bin = results.map(({ stdout }) => / from (\/\S+?)[.,](?:\s|$)/m.exec(stdout)?.[1]).find(Boolean) ?? "";
    expect(results.map(({ status }) => status), results.map(({ stderr }) => stderr).join("\n")).toEqual([0, 0, 0, 0]);
    const ports = roots.flatMap((root) => ["DATABASE_URL", "BETTER_AUTH_URL", "LICHESS_URL", "TELEGRAM_URL"].map((name) => portIn(blockIn(join(root, ".local-db")), name)));
    expect(new Set(ports).size).toBe(16);
    for (const root of roots) expect(await query(databaseUrl(blockIn(join(root, ".local-db"))), "select 1 as one")).toEqual({ rows: [{ one: 1 }], marked: true });
    for (const root of roots) expect(tool(root, "stop").status).toBe(0);
  }, 120_000);

  // A folder whose Postgres has run and is stopped, while its own fake Telegram holds a port of its set: so no other
  // checkout's db:start takes the set meanwhile, and what happens to it is what the test does.
  // When another process held that port before the fake could, it is another folder, up to three times.
  async function stoppedButHeld() {
    for (let tries = 1; ; tries++) {
      const root = repository();
      const started = tool(root, "start");
      expect(started.status, started.stderr).toBe(0);
      const ours = await fakeTelegram(root, { port: portIn(blockIn(join(root, ".local-db")), "TELEGRAM_URL") }).then(() => true, () => false);
      expect(tool(root, "stop").status).toBe(0);
      if (ours || tries === 3) return { root, block: blockIn(join(root, ".local-db")), ours };
      tool(root, "stop-all", "--dir", root);
    }
  }

  // A child of db:start's, and its output, and a promise of how it ended.
  function starting(root: string, env: Record<string, string> = {}) {
    const child = spawn(process.execPath, [join(root, "scripts/local-db.mjs"), "start"], { env: childEnv(env) });
    children.push(child);
    const output = { stdout: "", stderr: "" };
    child.stdout!.on("data", (chunk) => (output.stdout += chunk));
    child.stderr!.on("data", (chunk) => (output.stderr += chunk));
    return { child, output, ended: new Promise<number | null>((done) => child.once("exit", done)) };
  }

  it("stays on its ports when one was taken for a moment only as it started, as another db:start trying it takes it", async () => {
    const { root, block, ours } = await stoppedButHeld();
    // Its Lichess port held, and let go 60 ms after db:start's first line: after it first asks whether the port is
    // taken, and before it asks again.
    const release = await squat(portIn(block, "LICHESS_URL"));
    const { child, output, ended } = starting(root);
    child.stdout!.once("data", () => setTimeout(() => void release(), 60));
    const status = await ended;
    // Not moved for it: a start that then loses its port to a holder moves, as it must, but says "taken a moment ago".
    expect([status, output.stdout], output.stderr).toEqual([0, ours ? expect.not.stringContaining("taken now") : expect.any(String)]);
    expect(tool(root, "stop-all", "--dir", root).status).toBe(0);
  }, 60_000);

  it("chooses a new folder's ports after initdb, so that a set taken while initdb runs is not the one it gets", async () => {
    const root = repository();
    const slow = join(root, "slow");
    const holding = join(slow, "holding");
    mkdirSync(slow);
    // An initdb that, once the real one is done, has the first free set's site port taken, as another db:start that
    // chose the set meanwhile would; it writes down "<pid> <port>".
    const hold = [
      `const net = require("node:net");`,
      `const free = (port) => new Promise((done) => { const s = net.createServer().once("error", () => done(false)).listen({ port, host: "127.0.0.1", exclusive: true }, () => s.close(() => done(true))); });`,
      `(async () => { for (let n = 0; n < 100; n++) {`,
      `  let all = true; for (const port of [55432 + n, 3100 + n, 8089 + n, 8189 + n]) if (!(await free(port))) { all = false; break; }`,
      `  if (all) return net.createServer().listen(3100 + n, "127.0.0.1", () => require("node:fs").writeFileSync(process.argv[1], process.pid + " " + (3100 + n)));`,
      `} })();`,
    ].join(" ");
    const lines = [
      "#!/bin/sh",
      `"${bin}/initdb" "$@" || exit 1`,
      `"${process.execPath}" -e '${hold}' "${holding}" > /dev/null 2>&1 &`, // holding no pipe of db:start's open
      `for i in $(seq 1 300); do [ -e "${holding}" ] && break; sleep 0.01; done`,
    ];
    writeFileSync(join(slow, "initdb"), `${lines.join("\n")}\n`, { mode: 0o755 });
    writeFileSync(join(slow, "pg_ctl"), `#!/bin/sh\nexec "${bin}/pg_ctl" "$@"\n`, { mode: 0o755 });
    try {
      const started = run(process.execPath, [join(root, "scripts/local-db.mjs"), "start"], { PATH: `${slow}:${process.env.PATH}` });
      expect(started.status, started.stderr).toBe(0);
      const site = Number(readFileSync(holding, "utf8").split(" ")[1]);
      expect(portIn(blockIn(join(root, ".local-db")), "BETTER_AUTH_URL")).not.toBe(site);
      expect(tool(root, "stop-all", "--dir", root).status).toBe(0);
    } finally {
      const holder = existsSync(holding) && Number(readFileSync(holding, "utf8").split(" ")[0]);
      if (holder) process.kill(holder);
    }
  }, 60_000);

  it("moves to another free set when its Postgres port is taken between its choice and its start", async () => {
    const { root } = await stoppedButHeld();
    // A pg_ctl that, asked to start, first has the port taken, as another db:start would a moment before, then is pg_ctl.
    const racing = join(root, "racing");
    const taken = join(racing, "taken");
    mkdirSync(racing);
    // It writes its pid once listening, or "held" when it cannot for 3 s, as when another checkout's server took the port
    // first, so that the pg_ctl waiting on it never waits long; either way the port is taken when pg_ctl tries it.
    const squatter = [
      `const write = (what) => require("node:fs").writeFileSync(process.argv[2], what);`,
      `const listen = (tries) => require("node:net").createServer().once("error", () => (tries ? setTimeout(() => listen(tries - 1), 50) : write("held")))`,
      `  .listen(Number(process.argv[1]), "127.0.0.1", () => write(String(process.pid)));`,
      `listen(60);`,
    ].join(" ");
    const lines = [
      "#!/bin/sh",
      `case " $* " in *" start "*) starting=1 ;; esac`,
      `if [ -n "$starting" ] && [ ! -e "${taken}" ]; then`,
      `  port=$(echo "$*" | sed -n 's/.* -p \\([0-9]*\\) .*/\\1/p')`,
      `  "${process.execPath}" -e '${squatter}' "$port" "${taken}" > /dev/null 2>&1 &`, // holding no pipe of db:start's open
      `  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -e "${taken}" ] && break; sleep 0.25; done`,
      "fi",
      `exec "${bin}/pg_ctl" "$@"`,
    ];
    writeFileSync(join(racing, "pg_ctl"), `${lines.join("\n")}\n`, { mode: 0o755 });
    writeFileSync(join(racing, "initdb"), `#!/bin/sh\nexec "${bin}/initdb" "$@"\n`, { mode: 0o755 });
    try {
      const raced = run(process.execPath, [join(root, "scripts/local-db.mjs"), "start"], { PATH: `${racing}:${process.env.PATH}` });
      expect(raced.status, `${raced.stdout}\n${raced.stderr}`).toBe(0);
      const squatted = Number(/^Port (\d+) was taken a moment ago, so .* has another free set: [\d, ]+\.$/m.exec(raced.stdout)?.[1]);
      const block = blockIn(join(root, ".local-db"));
      expect(squatted, raced.stdout).toBeGreaterThan(0); // the port it had, or had just moved to off one taken since
      expect(portIn(block, "DATABASE_URL")).not.toBe(squatted);
      expect(readFileSync(join(root, ".env.local"), "utf8")).toBe(block);
      expect(await query(databaseUrl(block), "select 1 as one")).toEqual({ rows: [{ one: 1 }], marked: true });
      expect(tool(root, "stop-all", "--dir", root).status).toBe(0);
    } finally {
      const squatting = existsSync(taken) && Number(readFileSync(taken, "utf8")); // NaN, so nothing, when it held none
      if (squatting) process.kill(squatting);
    }
  }, 60_000);

  it("carries on, on its own ports, when pg_ctl stops waiting but the server comes up all the same", async () => {
    const root = repository();
    const slow = join(root, "slow");
    mkdirSync(slow);
    // A pg_ctl that starts the server, then says it gave up waiting, as one does when a start takes longer than it waits.
    const giveUp = `"${bin}/pg_ctl" "$@" > /dev/null; echo 'pg_ctl: server did not start in time' >&2; exit 1`;
    writeFileSync(join(slow, "pg_ctl"), `#!/bin/sh\ncase " $* " in *" start "*) ${giveUp} ;; esac\nexec "${bin}/pg_ctl" "$@"\n`, { mode: 0o755 });
    writeFileSync(join(slow, "initdb"), `#!/bin/sh\nexec "${bin}/initdb" "$@"\n`, { mode: 0o755 });
    const started = run(process.execPath, [join(root, "scripts/local-db.mjs"), "start"], { PATH: `${slow}:${process.env.PATH}` });
    expect(started.status, started.stderr).toBe(0);
    const block = blockIn(join(root, ".local-db")); // whichever set it ended on, here and in its record alike
    expect(readFileSync(join(root, ".env.local"), "utf8")).toBe(block);
    expect(rows(tool(root, "list").stdout)).toEqual([{ kind: "Postgres", port: portIn(block, "DATABASE_URL"), folder: join(root, ".local-db"), gone: false }]);
    expect(await query(databaseUrl(block), "select 1 as one")).toEqual({ rows: [{ one: 1 }], marked: true });
    expect(tool(root, "stop").status).toBe(0);
  }, 60_000);

  const addressInUse = `LOG:  could not bind IPv4 address "127.0.0.1": Address already in use`;

  it("does not try a port again when its start fails for another reason, whatever an earlier start left in its log", async () => {
    const { root } = await stoppedButHeld();
    const failing = join(root, "failing");
    mkdirSync(failing);
    // A pg_ctl whose every start fails for a reason of its own; it writes down the port of each.
    const fail = `echo "$*" | sed -n 's/.* -p \\([0-9]*\\) .*/\\1/p' >> "${failing}/ports"; echo 'pretend failure' >&2; exit 1`;
    writeFileSync(join(failing, "pg_ctl"), `#!/bin/sh\ncase " $* " in *" start "*) ${fail} ;; esac\nexec "${bin}/pg_ctl" "$@"\n`, { mode: 0o755 });
    writeFileSync(join(failing, "initdb"), `#!/bin/sh\nexec "${bin}/initdb" "$@"\n`, { mode: 0o755 }); // so that db:start takes the folder for a Postgres
    writeFileSync(join(root, ".local-db/postgres.log"), `${addressInUse}\n`, { flag: "a" }); // from a start before this one
    const failed = run(process.execPath, [join(root, "scripts/local-db.mjs"), "start"], { PATH: `${failing}:${process.env.PATH}` });
    // Each port tried once: none again for this failure, though one lost to a real holder meanwhile is left for another.
    const ports = readFileSync(join(failing, "ports"), "utf8").split("\n").filter(Boolean);
    expect([failed.status, ports.length > 0, new Set(ports).size], failed.stdout).toEqual([1, true, ports.length]);
    expect(failed.stderr).toContain("pretend failure");
    expect(tool(root, "stop-all", "--dir", root).status).toBe(0);
  }, 60_000);

  it("tries the same port again, and stays on it, when it lost it for an instant only, to another db:start trying it", async () => {
    const { root } = await stoppedButHeld();
    const tried = join(root, "tried");
    mkdirSync(tried);
    // A pg_ctl whose first start fails as Postgres's does when the port is held at that instant, then is pg_ctl. It
    // writes down the port it was given, in "once", and has it held for 80 ms, as another db:start trying it would,
    // which is after db:start first asks whether it is taken and before it asks again.
    const log = join(root, ".local-db/postgres.log");
    const holding = join(tried, "holding");
    const hold = [
      `const write = (what) => require("node:fs").writeFileSync(process.argv[2], what);`,
      `const server = require("node:net").createServer().once("error", () => write("held"))`,
      `  .listen(Number(process.argv[1]), "127.0.0.1", () => { write(String(process.pid)); setTimeout(() => server.close(), 80); });`,
    ].join(" ");
    const lose = [
      `[ -e "${tried}/once" ] || {`,
      `  port=$(echo "$*" | sed -n 's/.* -p \\([0-9]*\\) .*/\\1/p'); echo "$port" > "${tried}/once"`,
      `  "${process.execPath}" -e '${hold}' "$port" "${holding}" > /dev/null 2>&1 &`,
      `  for i in $(seq 1 200); do [ -e "${holding}" ] && break; sleep 0.01; done`,
      `  echo '${addressInUse}' >> "${log}"; exit 1; }`,
    ].join("\n");
    writeFileSync(join(tried, "pg_ctl"), `#!/bin/sh\ncase " $* " in *" start "*)\n${lose}\n;; esac\nexec "${bin}/pg_ctl" "$@"\n`, { mode: 0o755 });
    writeFileSync(join(tried, "initdb"), `#!/bin/sh\nexec "${bin}/initdb" "$@"\n`, { mode: 0o755 });
    const started = run(process.execPath, [join(root, "scripts/local-db.mjs"), "start"], { PATH: `${tried}:${process.env.PATH}` });
    expect([started.status, started.stdout], started.stderr).toEqual([0, expect.not.stringContaining("taken a moment ago")]);
    expect(readFileSync(holding, "utf8")).toMatch(/^\d+$/);
    const block = blockIn(join(root, ".local-db"));
    expect(portIn(block, "DATABASE_URL"), started.stdout).toBe(Number(readFileSync(join(tried, "once"), "utf8")));
    expect(await query(databaseUrl(block), "select 1 as one")).toEqual({ rows: [{ one: 1 }], marked: true });
    expect(tool(root, "stop-all", "--dir", root).status).toBe(0);
  }, 60_000);

  it("gives up after 10 starts that lost their port, and says where to look", async () => {
    const { root } = await stoppedButHeld();
    const lose = join(root, "lose");
    mkdirSync(lose);
    const dir = join(root, ".local-db");
    const log = join(dir, "postgres.log");
    // A pg_ctl whose every start fails as Postgres's does when its port is held at that instant; it counts its starts.
    writeFileSync(join(lose, "pg_ctl"), `#!/bin/sh\ncase " $* " in *" start "*) echo start >> "${lose}/starts"; echo '${addressInUse}' >> "${log}"; exit 1 ;; esac\nexec "${bin}/pg_ctl" "$@"\n`, { mode: 0o755 });
    writeFileSync(join(lose, "initdb"), `#!/bin/sh\nexec "${bin}/initdb" "$@"\n`, { mode: 0o755 });
    // With a deadline of its own, as a db:start that never gave up would never end.
    const failed = spawnSync(process.execPath, [join(root, "scripts/local-db.mjs"), "start"], { env: childEnv({ PATH: `${lose}:${process.env.PATH}` }), encoding: "utf8", timeout: 30_000 });
    const port = portIn(blockIn(dir), "DATABASE_URL");
    expect([failed.status, readFileSync(join(lose, "starts"), "utf8").split("\n").filter(Boolean).length]).toEqual([1, 10]);
    expect(failed.stderr.trim().split("\n").at(-1)).toBe(`Postgres lost its port as it started, 10 times in a row, the last time ${port}, so ${dir} was not started. Its log: ${log}.`);
    expect(tool(root, "stop-all", "--dir", root).status).toBe(0);
  }, 60_000);
});

// The lines of pnpm local:list, or of pnpm local:stop without their "Stopped: ".
const rows = (stdout: string) =>
  stdout
    .trim()
    .split("\n")
    .map((line) => {
      const row = /^(?:Stopped: )?(Postgres|site|fake Lichess|fake Telegram) +(\d+) +\d+ (?:min|h \d+ min|d \d+ h) +(\/.*?)( \(folder gone\))?(?:, from worktree \/.*)?$/.exec(line);
      return row ? { kind: row[1], port: Number(row[2]), folder: row[3], gone: Boolean(row[4]) } : { line };
    });

describe("pnpm local:list and pnpm local:stop", () => {
  it("list and stop what these tools started from each worktree of the repository, also once its folder is gone, and nothing else", async () => {
    const main = repository();
    const worktree = join(main, ".claude/worktrees/agent"); // inside the main checkout, as the agents' are
    git(main, "worktree", "add", "-q", "--detach", worktree);
    fill(worktree);
    const other = repository(); // another project's
    const registry = join(main, ".git/offboard-local");

    const started = tool(worktree, "start");
    expect(started.status, started.stderr).toBe(0);
    const bin = / from (\/\S+?)[.,](?:\s|$)/m.exec(started.stdout)![1];
    const postgres = {
      port: portIn(blockIn(join(worktree, ".local-db")), "DATABASE_URL"),
      pid: Number(readFileSync(join(worktree, ".local-db/postmaster.pid"), "utf8").split("\n")[0]),
    };
    // A Postgres in the same worktree that db:start did not start, and a server standing in for the owner's site.
    let theirs = join(worktree, ".theirs");
    execFileSync(`${bin}/initdb`, ["-D", theirs, "-U", "theirs", "--auth=trust", "--no-locale", "-E", "UTF8"], { stdio: "ignore", env: childEnv() });
    const options = `-c listen_addresses=127.0.0.1 -p ${await freePort()} -c unix_socket_directories=''`;
    execFileSync(`${bin}/pg_ctl`, ["-D", theirs, "-l", join(theirs, "log"), "-o", options, "-w", "start"], { stdio: "ignore", env: childEnv() });
    const site = spawn(process.execPath, ["-e", "require('node:http').createServer().listen(0, '127.0.0.1')"], { cwd: worktree, env: childEnv() });
    children.push(site);
    try {
      // Recorded in one time zone and listed in another, as ps gives each caller its own.
      const fakes = { main: await fakeTelegram(main, { env: { TZ: "Pacific/Kiritimati" } }), worktree: await fakeTelegram(worktree), other: await fakeTelegram(other) };
      const listed = run(process.execPath, [join(main, "scripts/local-db.mjs"), "list"], { TZ: "Pacific/Pago_Pago" });
      expect([listed.status, listed.stderr]).toEqual([0, ""]);
      const ours = {
        postgres: { kind: "Postgres", port: postgres.port, folder: join(worktree, ".local-db"), gone: false },
        main: { kind: "fake Telegram", port: fakes.main, folder: main, gone: false },
        worktree: { kind: "fake Telegram", port: fakes.worktree, folder: worktree, gone: false },
      };
      const all = [ours.postgres, ours.main, ours.worktree];
      expect(rows(listed.stdout)).toHaveLength(3);
      expect(rows(listed.stdout)).toEqual(expect.arrayContaining(all));
      expect(rows(tool(other, "list").stdout)).toEqual([{ kind: "fake Telegram", port: fakes.other, folder: other, gone: false }]);
      // A Postgres's line names its worktree, which is what --dir takes; its own folder is answered with how to stop it.
      expect(listed.stdout).toMatch(new RegExp(`^Postgres .* ${join(worktree, ".local-db").replaceAll(".", "\\.")}, from worktree ${worktree.replaceAll(".", "\\.")}$`, "m"));
      const notWorktree = tool(main, "stop-all", "--dir", join(worktree, ".local-db"));
      expect([notWorktree.status, notWorktree.stdout]).toEqual([
        0,
        `Nothing these tools started is running from the worktree ${join(worktree, ".local-db")}. --dir takes a worktree: in pnpm local:list, the one after "from worktree", or the folder of a site or a fake.\n`,
      ]);
      expect(rows(tool(main, "list").stdout)).toHaveLength(3);

      // A record of another process, whose start or command line is not what it was recorded with, is not this tool's.
      const [, start, command] = /^(\w{3} \w{3} +\d+ [\d:]{8} \d{4}) +(.*)$/.exec(
        execFileSync("ps", ["-ww", "-o", "lstart=,command=", "-p", String(site.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(),
      )!;
      const record = join(registry, `${site.pid}.json`);
      for (const forged of [{ start: start.replace(/\d{4}$/, "2001"), command }, { start, command: `${command} --another` }]) {
        writeFileSync(record, JSON.stringify({ kind: "site", port: 3000, folder: worktree, worktree, pid: site.pid, ...forged }));
        expect(rows(tool(main, "list").stdout)).toHaveLength(3);
        expect(existsSync(record)).toBe(false);
      }

      // A file that is not a record is left alone and said so, and the records beside it still count.
      const strays = [join(registry, "no-pid.json"), join(registry, "not-json.json")];
      writeFileSync(strays[0], JSON.stringify({ kind: "site", port: 3000, folder: worktree, worktree, start, command }));
      writeFileSync(strays[1], "{ not a record");
      const beside = tool(main, "list");
      expect(rows(beside.stdout)).toEqual(expect.arrayContaining(all));
      expect(beside.stderr.trim().split("\n").sort()).toEqual(strays.map((file) => `${file} is not a record these tools write, so it was left alone.`));
      expect(strays.every((file) => existsSync(file))).toBe(true);
      // When ps itself fails, no record is believed or removed.
      const failing = join(main, "failing-ps");
      mkdirSync(failing);
      writeFileSync(join(failing, "ps"), "#!/bin/sh\necho 'ps: pretend failure' >&2\nexit 1\n", { mode: 0o755 });
      const blind = run(process.execPath, [join(main, "scripts/local-db.mjs"), "list"], { PATH: `${failing}:${process.env.PATH}` });
      expect([blind.stdout, blind.stderr]).toEqual(["Nothing these tools started is running.\n", expect.stringMatching(/^ps could not say whether process \d+ runs/m)]);
      expect(rows(tool(main, "list").stdout)).toHaveLength(3);

      // Alone, pnpm local:stop stops nothing; with the main checkout it stops the main checkout's, not its worktrees'.
      refuses(process.execPath, [join(main, "scripts/local-db.mjs"), "stop-all"], /^Usage: pnpm db:start/);
      expect(rows(tool(main, "stop-all", "--dir", main).stdout)).toEqual([ours.main]);
      expect(rows(tool(main, "list").stdout)).toEqual(expect.arrayContaining([ours.postgres, ours.worktree]));

      // The worktree's folder gone from where it was, as a removed one would be: Postgres runs on in a moved one.
      renameSync(worktree, `${worktree}-moved`);
      theirs = join(`${worktree}-moved`, ".theirs");
      const orphans = [{ ...ours.postgres, gone: true }, { ...ours.worktree, gone: true }];
      expect(rows(tool(main, "list").stdout)).toEqual(expect.arrayContaining(orphans));
      const stopped = tool(main, "stop-all", "--dir", worktree);
      expect(stopped.status, stopped.stderr).toBe(0);
      expect(stopped.stdout).toMatch(/^Stopped: /);
      expect(rows(stopped.stdout)).toHaveLength(2);
      expect(rows(stopped.stdout)).toEqual(expect.arrayContaining(orphans));
      expect(alive(postgres.pid)).toBe(false);
      expect(tool(main, "list").stdout).toBe("Nothing these tools started is running.\n");
      expect(spawnSync(`${bin}/pg_ctl`, ["-D", theirs, "status"]).status).toBe(0);
      expect(alive(site.pid!)).toBe(true);

      expect(rows(tool(other, "stop-all", "--all").stdout)).toEqual([{ kind: "fake Telegram", port: fakes.other, folder: other, gone: false }]);
      expect(tool(other, "list").stdout).toBe("Nothing these tools started is running.\n");
      expect(alive(site.pid!)).toBe(true);
    } finally {
      spawnSync(`${bin}/pg_ctl`, ["-D", theirs, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
      site.kill();
    }
  }, 120_000);
});
