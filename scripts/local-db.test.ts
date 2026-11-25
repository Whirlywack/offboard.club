// The local tools (scripts/local-db.mjs, seed.ts, fake-lichess.ts) refuse anything real before they touch it: a
// database not on this machine, a checkout whose .env.local holds real settings, and a database db:start did not make.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
    for (const url of [
      REAL,
      "postgres://u@localhost.example.com/db",
      "postgres://u@127.0.0.2/db",
      "postgres://u@localhost/db?host=ep-pretend-123.neon.tech",
      ` ${LOCAL}`,
      `${LOCAL} `,
      "postgres://u@local\thost/db",
      "postgres:///db",
      "postgres://u@%2Ftmp/db",
      "//localhost/db",
      "mysql://localhost/db",
      "",
      undefined,
    ])
      expect(notLocal(url)).toMatch(/^DATABASE_URL/);
  });
});

describe("a checkout's .env.local", () => {
  it("holds real settings unless its DATABASE_URL is on this machine", () => {
    expect(checkoutProblem(null)).toBeNull();
    expect(checkoutProblem(`BETTER_AUTH_URL=http://localhost:3100\nDATABASE_URL=${LOCAL}\n`)).toBeNull();
    expect(checkoutProblem(`DATABASE_URL="${LOCAL}"\n`)).toBeNull();
    for (const text of [`DATABASE_URL=${REAL}\n`, `DATABASE_URL="${REAL}"\n`, 'LINKEDIN_CLIENT_ID="a-pretend-id"\n'])
      expect(checkoutProblem(text)).toMatch(/^This checkout's \.env\.local holds real settings/);
  });

  it("is created when there is none, and an existing one is never changed", () => {
    const dir = mkdtempSync(join(tmpdir(), "offboard-env-"));
    const file = join(dir, ".env.local");
    expect(createOnce(file, "DATABASE_URL=one\n")).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(createOnce(file, "DATABASE_URL=two\n")).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("DATABASE_URL=one\n");
  });
});

const run = (command: string, args: string[], env: Record<string, string | undefined> = {}) =>
  spawnSync(command, args, { env: { ...process.env, ...env }, encoding: "utf8" });
const oneLine = (stderr: string, pattern: RegExp) => expect(stderr.trim().split("\n")).toEqual([expect.stringMatching(pattern)]);
const tsx = "node_modules/.bin/tsx";

describe("refusing before touching anything", () => {
  it("db:start in a checkout whose .env.local holds real settings: nothing started or written", () => {
    const checkout = mkdtempSync(join(tmpdir(), "offboard-checkout-"));
    mkdirSync(join(checkout, "scripts"));
    copyFileSync("scripts/local-db.mjs", join(checkout, "scripts/local-db.mjs"));
    const real = `DATABASE_URL=${REAL}\nLINKEDIN_CLIENT_SECRET=the-owners\n`;
    writeFileSync(join(checkout, ".env.local"), real);
    const { status, stdout, stderr } = run(process.execPath, [join(checkout, "scripts/local-db.mjs"), "start"], { DATABASE_URL: undefined });
    expect(status).toBe(1);
    expect(stdout).toBe("");
    oneLine(stderr, /^This checkout's \.env\.local holds real settings.*belongs in a worktree/);
    expect(readFileSync(join(checkout, ".env.local"), "utf8")).toBe(real);
    expect(existsSync(join(checkout, ".local-db"))).toBe(false);
  });

  it("db:start beside a real DATABASE_URL in the environment", () => {
    const dir = join(tmpdir(), `offboard-never-made-${process.pid}`);
    const { status, stdout, stderr } = run(process.execPath, ["scripts/local-db.mjs", "start", "--dir", dir], { DATABASE_URL: REAL });
    expect(status).toBe(1);
    expect(stdout).toBe("");
    oneLine(stderr, /^Refusing.*ep-pretend-123.*not this machine/);
    expect(existsSync(dir)).toBe(false);
  });

  it("an unknown argument to db:start, the seed or the fake Lichess, while --help prints what they do", () => {
    const dir = join(tmpdir(), `offboard-never-made-${process.pid}`);
    expect(run(process.execPath, ["scripts/local-db.mjs", "start", "--site-port", "3000", "--dir", dir]).status).toBe(1);
    expect(existsSync(dir)).toBe(false);
    for (const [command, args] of [[tsx, ["scripts/seed.ts", "--bogus"]], [tsx, ["scripts/seed.ts", "constructor"]], [tsx, ["scripts/fake-lichess.ts", "--bogus"]]] as const) {
      const { status, stderr } = run(command, [...args], { DATABASE_URL: LOCAL });
      expect(status).toBe(1);
      expect(stderr).toMatch(/[Uu]nknown argument/);
    }
    for (const [command, args] of [[process.execPath, ["scripts/local-db.mjs", "--help"]], [tsx, ["scripts/seed.ts", "--help"]]] as const) {
      const { status, stdout } = run(command, [...args], { DATABASE_URL: REAL });
      expect(status).toBe(0);
      expect(stdout).toMatch(/pnpm (db:start|seed)/);
    }
  }, 30_000);

  it("the seed and the fake Lichess on a real DATABASE_URL, with a one-line reason", () => {
    for (const script of ["scripts/seed.ts", "scripts/fake-lichess.ts"]) {
      const { status, stdout, stderr } = run(tsx, [script], { DATABASE_URL: REAL });
      expect(status).toBe(1);
      expect(stdout).toBe("");
      oneLine(stderr, /^Refusing.*ep-pretend-123.*not this machine/);
    }
  }, 30_000);
});

describe("the mark", () => {
  it("is the one CI writes on the database it seeds", () => {
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain(`comment on database seeded is '${MARK}'`);
  });
});

// On a database of its own, made and dropped here, which db:start did not make and so has no mark, as a real database
// with nobody in it yet behind a forwarded port would not. Opt-in, as the other real-Postgres tests are.
describe.skipIf(process.env.ALLOW_DB_TESTS !== "1" || !process.env.DATABASE_URL)("a database db:start did not make", () => {
  it("is refused by the seed before its first statement changes anything", async () => {
    const name = `offboard_unmarked_${process.pid}`;
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(`create database ${name}`);
      const url = new URL(process.env.DATABASE_URL!);
      url.pathname = `/${name}`;
      const block = {
        DATABASE_URL: url.toString(),
        BETTER_AUTH_SECRET: "a-pretend-secret",
        BETTER_AUTH_URL: "http://localhost:3100",
        LICHESS_TEAM_ID: "pretend-team",
        ORGANISER_USER_ID: "org",
        LICHESS_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
      };
      const { status, stderr } = run(tsx, ["scripts/seed.ts"], block);
      expect(status).toBe(1);
      expect(stderr.trim()).toBe("Refusing: this database was not made by pnpm db:start, so the seed leaves it alone.");
    } finally {
      await admin.query(`drop database if exists ${name}`);
      await admin.end();
    }
  }, 30_000);
});
