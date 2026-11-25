// The local tools (scripts/local-db.mjs, seed.ts, fake-lichess.ts, fake-telegram.ts, post-to-telegram.ts) refuse anything
// real before they touch it: a database not on this machine, a checkout whose .env.local holds real settings, a Postgres
// db:start did not make, a database without db:start's mark, and a Lichess or Telegram that is not the fake one. Each run of db:start here is in a temporary checkout, so that this checkout's own
// .env.local, the owner's real one included, is never read or changed.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { checkoutProblem, createOnce, MARK, notLocal } from "./local-db.mjs";

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
    for (const args of [["start", "--site-port", "3000"], ["stop", "--port", "55432"], ["--help"], []])
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
