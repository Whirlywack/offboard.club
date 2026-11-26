// The switch between people in the local site (app/sign-in-as/route.dev.ts), which is a way round signing in: a
// production build of the site does not have it at all, and under `next dev` it refuses a database that is not on this
// machine before it reaches it. Its refusal of a database on this machine that db:start did not make, and what it does
// on one that db:start did, are in app/sign-in-as.postgres.test.ts.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./sign-in-as/route.dev";

const { query } = vi.hoisted(() => ({
  query: vi.fn(async (): Promise<never> => {
    throw new Error("the switch reached the database");
  }),
}));
vi.mock("@/lib/db", () => ({ db: { query } }));

const root = join(import.meta.dirname, "..");
const next = join(root, "node_modules/next/dist/bin/next");
const SAVED = process.env.DATABASE_URL;

afterEach(() => {
  process.env.DATABASE_URL = SAVED;
  query.mockClear();
});

const form = (as: string) => new Request("http://localhost:3100/sign-in-as", { method: "POST", body: new URLSearchParams({ as }) });

describe("the switch under next dev, beside a database that is not on this machine", () => {
  // The main checkout's settings, say, whose database is a copy of live with its real accounts.
  const elsewhere = "postgres://someone:a-pretend-password@db.pretend.invalid/neondb?sslmode=require";

  it("lists nobody, and does not reach it", async () => {
    process.env.DATABASE_URL = elsewhere;
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "Refusing: DATABASE_URL's host is db.pretend.invalid, not this machine (localhost, 127.0.0.1 or ::1). The switch between people works only on a database pnpm db:start made on this machine.",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("signs nobody in or out, and does not reach it", async () => {
    for (const as of ["org", ""]) {
      process.env.DATABASE_URL = elsewhere;
      const response = await POST(form(as));
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).toMatch(/^Refusing: DATABASE_URL's host is db\.pretend\.invalid/);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("is refused without any address, too", async () => {
    delete process.env.DATABASE_URL;
    expect((await GET()).status).toBe(403);
    expect((await POST(form("org"))).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});

// Every file under `dir`, for the build's output.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

describe("a production build", () => {
  it("has no switch between people: nothing of it is built, and its address answers 404 as an address the site does not have does", async () => {
    // Without vitest's NODE_ENV, as Vercel builds; with a database on this machine that is not there, so that nothing
    // real is reached whatever .env.local holds.
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgres://nobody@127.0.0.1:9/nothing", NEXT_TELEMETRY_DISABLED: "1" };
    delete (env as Record<string, string | undefined>).NODE_ENV;
    const build = spawnSync(process.execPath, [next, "build"], { cwd: root, env, encoding: "utf8" });
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
    const routes = Object.values(JSON.parse(readFileSync(join(root, ".next/app-path-routes-manifest.json"), "utf8")));
    expect(routes).toContain("/privacy");
    expect(routes).not.toContain("/sign-in-as");
    const built = [".next/server", ".next/static"].flatMap((dir) => (existsSync(join(root, dir)) ? files(join(root, dir)) : []));
    expect(built.filter((file) => readFileSync(file, "latin1").includes("The switch between people"))).toEqual([]);

    const port = await freePort();
    const server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env, stdio: "ignore" });
    try {
      const at = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, { ...init, redirect: "manual" });
      for (let tries = 0; !(await at("/privacy").then((r) => r.ok, () => false)); tries++) {
        if (tries === 100) throw new Error("next start did not answer in 20 s");
        await new Promise((done) => setTimeout(done, 200));
      }
      for (const [path, init] of [["/no-such-page"], ["/sign-in-as"], ["/sign-in-as", { method: "POST", body: new URLSearchParams({ as: "org" }) }]] as const) {
        const response = await at(path, init);
        expect([path, response.status]).toEqual([path, 404]);
        expect(await response.text()).toContain("Nothing at this address");
      }
    } finally {
      server.kill();
    }
  }, 180_000);
});
