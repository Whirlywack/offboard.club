// The switch between people in the local site (app/sign-in-as/route.dev.ts) on real databases: on one on this machine
// that db:start did not make it lists nobody and signs nobody in; on one it made it lists everyone, and signs the browser
// in as the one chosen in a session Better Auth reads as theirs. The test makes both databases on the server in
// DATABASE_URL, marking one as db:start marks its own (MARK), migrates them with scripts/migrate.mjs and drops them
// again, so the database in DATABASE_URL is left as it was. Opt-in, as the other real-Postgres suites are:
// ALLOW_DB_TESTS=1 DATABASE_URL=<a local database's address> pnpm vitest run app/sign-in-as.postgres.test.ts
import { spawnSync } from "node:child_process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MARK } from "@/scripts/local-db.mjs";

const PREFIX = "offboard_switch_test_";
const form = (as: string) => new Request("http://localhost:3100/sign-in-as", { method: "POST", body: new URLSearchParams({ as }) });

describe.skipIf(process.env.ALLOW_DB_TESTS !== "1" || !process.env.DATABASE_URL)("the switch between people in Postgres", () => {
  const saved = { ...process.env };
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const urlOf = (name: string) => {
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    return url.toString();
  };
  // A new database, migrated, with the Organiser, a Member and one at each step of signing up in it.
  const database = async (name: string, marked: boolean) => {
    await admin.query(`create database ${name}`);
    if (marked) await admin.query(`comment on database ${name} is '${MARK}'`);
    const migrated = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: urlOf(name) }, encoding: "utf8" });
    if (migrated.status !== 0) throw new Error(migrated.stderr);
    const client = new pg.Client({ connectionString: urlOf(name) });
    await client.connect();
    try {
      for (const [id, person, agreed, lichess] of [["org", "Rasa Arbiter", true, true], ["ana", "Ana Fianchetto", true, true],
        ["step1", "Milda Opening", false, false], ["step2", "Tadas Development", true, false]] as const)
        await client.query(
          `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId", "lichessUsername")
           values ($1, $2, $3, true, $4, $4, $5, $5)`,
          [id, person, `${id}@seed.invalid`, agreed ? new Date() : null, lichess ? `pretend--${id}` : null],
        );
    } finally {
      await client.end();
    }
    return urlOf(name);
  };
  const sessions = async (url: string) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query<{ userId: string }>(`select "userId" from "session" order by "createdAt"`)).rows.map((row) => row.userId);
    } finally {
      await client.end();
    }
  };
  // The switch as `next dev` serves it beside the database at `url`, and Better Auth as the site reads sessions there.
  const switchOn = async (url: string) => {
    process.env.DATABASE_URL = url;
    vi.resetModules();
    return { ...(await import("./sign-in-as/route.dev")), ...(await import("@/lib/db")), ...(await import("@/lib/auth")) };
  };

  let marked: string;
  let unmarked: string;

  beforeAll(async () => {
    Object.assign(process.env, { BETTER_AUTH_SECRET: "a-pretend-secret-for-the-switch-test", BETTER_AUTH_URL: "http://localhost:3100", ORGANISER_USER_ID: "org" });
    await admin.connect();
    // Those a killed run of this left behind.
    const { rows } = await admin.query<{ datname: string }>(`select datname from pg_database where datname like $1`, [`${PREFIX}%`]);
    for (const { datname } of rows) await admin.query(`drop database ${datname} with (force)`);
    marked = await database(`${PREFIX}marked_${process.pid}`, true);
    unmarked = await database(`${PREFIX}unmarked_${process.pid}`, false);
  }, 60_000);

  afterAll(async () => {
    for (const url of [marked, unmarked]) if (url) await admin.query(`drop database if exists ${new URL(url).pathname.slice(1)} with (force)`);
    await admin.end();
    process.env = saved;
  });

  it("lists nobody and signs nobody in on a database on this machine that db:start did not make", async () => {
    const { GET, POST, db } = await switchOn(unmarked);
    try {
      const listed = await GET();
      expect(listed.status).toBe(403);
      expect(await listed.text()).toBe("Refusing: this database was not made by pnpm db:start, so the switch between people leaves it alone.");
      for (const as of ["ana", ""]) {
        const posted = await POST(form(as));
        expect(posted.status).toBe(403);
        expect(posted.headers.get("set-cookie")).toBeNull();
      }
    } finally {
      await db.end();
    }
    expect(await sessions(unmarked)).toEqual([]);
  });

  it("lists everyone in a database db:start made: the Organiser, the Members and those part-way through signing up", async () => {
    const { GET, db } = await switchOn(marked);
    try {
      const listed = await GET();
      expect(listed.status).toBe(200);
      const html = await listed.text();
      const order = ["A visitor", "<h2>The Organiser</h2>", "Rasa Arbiter", "<h2>Members</h2>", "Ana Fianchetto", "<h2>Part-way through signing up</h2>"];
      expect(order.map((part) => html.indexOf(part)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]))).toBe(true);
      expect(html).toContain('<button name="as" value="step1">Milda Opening</button> <code>step1</code>, has not agreed yet');
      expect(html).toContain('<button name="as" value="step2">Tadas Development</button> <code>step2</code>, has agreed, no Lichess yet');
    } finally {
      await db.end();
    }
  });

  it("signs the browser in as the one chosen, in a session of their own that Better Auth reads as theirs, and out for a visitor", async () => {
    const { POST, db, auth } = await switchOn(marked);
    try {
      for (const id of ["ana", "step1", "org"]) {
        const posted = await POST(form(id));
        expect([posted.status, posted.headers.get("location")]).toEqual([303, "/"]);
        const cookie = posted.headers.get("set-cookie")!.split(";")[0];
        expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id).toBe(id);
      }
      const out = await POST(form(""));
      expect([out.status, out.headers.get("location")]).toEqual([303, "/"]);
      expect(out.headers.get("set-cookie")).toBe("better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      const nobody = await POST(form("nobody"));
      expect(nobody.status).toBe(404);
      expect(nobody.headers.get("set-cookie")).toBeNull();
    } finally {
      await db.end();
    }
    expect(await sessions(marked)).toEqual(["ana", "step1", "org"]);
  });
});
