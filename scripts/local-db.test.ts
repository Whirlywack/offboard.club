// The local tools (scripts/local-db.mjs, seed.ts, fake-lichess.ts) refuse any database that is not on this machine,
// before they touch anything.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { notLocal } from "./local-db.mjs";

const REAL = "postgres://someone:a-pretend-password@ep-pretend-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";

describe("which databases count as on this machine", () => {
  it("lets through localhost, 127.0.0.1 and ::1", () => {
    for (const url of ["postgres://offboard@127.0.0.1:55432/offboard", "postgresql://u:p@localhost/db", "postgres://u@[::1]:5432/db"])
      expect(notLocal(url)).toBeNull();
  });

  it("refuses any other host, a host in the query string, which pg prefers, and anything that is not a postgres:// address", () => {
    for (const url of [
      REAL,
      "postgres://u@localhost.example.com/db",
      "postgres://u@127.0.0.2/db",
      "postgres://u@localhost/db?host=ep-pretend-123.neon.tech",
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

describe("a real DATABASE_URL", () => {
  const run = (command: string, ...args: string[]) =>
    spawnSync(command, args, { env: { ...process.env, DATABASE_URL: REAL }, encoding: "utf8" });
  const oneLine = (stderr: string) => expect(stderr.trim().split("\n")).toEqual([expect.stringMatching(/^Refusing.*ep-pretend-123.*not this machine/)]);

  it("stops the seed before it connects, with a one-line reason", () => {
    const { status, stdout, stderr } = run("node_modules/.bin/tsx", "scripts/seed.ts");
    expect(status).toBe(1);
    expect(stdout).toBe("");
    oneLine(stderr);
  }, 20_000);

  it("stops db:start before it makes or starts anything", () => {
    const dir = join(tmpdir(), `offboard-never-made-${process.pid}`);
    const { status, stdout, stderr } = run(process.execPath, "scripts/local-db.mjs", "start", "--dir", dir);
    expect(status).toBe(1);
    expect(stdout).toBe("");
    oneLine(stderr);
    expect(existsSync(dir)).toBe(false);
  }, 20_000);

  it("stops the fake Lichess", () => {
    const { status, stderr } = run("node_modules/.bin/tsx", "scripts/fake-lichess.ts");
    expect(status).toBe(1);
    oneLine(stderr);
  }, 20_000);
});
