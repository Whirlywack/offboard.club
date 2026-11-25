import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { finishConnection, startConnection } from "./connect-lichess";
import { createFakeLichess } from "./fixtures/fake-lichess";
import { forgetTeamRemoval, removeMember, removeSwitchedFrom, teamRemovals } from "./leaving";
import { finishOrganiserConnection, startOrganiserConnection } from "./organiser-lichess";

// Leaving the Club's real SQL against the database in DATABASE_URL, inside one transaction that is always rolled back,
// so nothing it does is kept: that the foreign keys of migrations/ take everything of the person's with them but their
// Games, as lib/fake-db.ts has it; and the same removal from the Club's Lichess team for an account a Member switched
// from, with the switch itself (lib/connect-lichess.ts). The app's database is one connection holding that transaction, and the removal's own
// transaction a savepoint within it. Inside it, it empties "organiserLichess", which has one row at most, and
// "teamRemoval", so it runs only when ALLOW_DB_TESTS=1 is set as well as DATABASE_URL, and a plain `pnpm test` skips it. Run it against a local
// database from `pnpm db:start`, never a shared or live one, before seeding (once that one is seeded, a second from
// `pnpm db:start --dir .local-db-tests`), with that database's address:
// ALLOW_DB_TESTS=1 DATABASE_URL=<that address> pnpm vitest run lib/leaving.postgres.test.ts
vi.mock("@/lib/db", async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const inner: Record<string, string> = {
    begin: "savepoint leaving",
    commit: "release savepoint leaving",
    rollback: "rollback to savepoint leaving",
  };
  // Nothing the app sends may end the test's transaction.
  const query = (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|start|commit|end|rollback|abort)\b/i.test(sql)) throw new Error(`refused inside the test's transaction: ${sql}`);
    return client.query(sql, params);
  };
  const connect = async () => ({
    query: (sql: string, params?: unknown[]) => (Object.hasOwn(inner, sql) ? client.query(inner[sql]) : query(sql, params)),
    release: () => {},
  });
  return { db: { client, query, connect } };
});

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("leaving the Club in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;
  const run = (sql: string, params: unknown[] = []) => client.query(sql, params);
  const count = async (sql: string, params: unknown[]) => (await run(sql, params)).rowCount;
  const addPerson = (id: string, lichessId = `${id}-on-lichess`) =>
    run(
      `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId", "lichessUsername")
       values ($1, $1, $2, false, now(), now(), $3, $3)`,
      [id, `${id}@example.invalid`, lichessId],
    );

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");
  }, 30_000);

  afterAll(async () => {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }, 30_000);

  it("deletes everything of the person's but their Games, which stay with their side empty", async () => {
    // Without the Club's team configured, removing them from it fails before asking Lichess anything.
    vi.stubEnv("LICHESS_TEAM_ID", "");
    vi.stubGlobal("fetch", () => Promise.reject(new Error("nothing may reach Lichess")));
    const GONE = "leaving-test-gone";
    const STAYS = "leaving-test-stays";
    // The one who stays first, so that a query reading the wrong person reads them.
    await addPerson(STAYS);
    await addPerson(GONE);
    await run(`delete from "teamRemoval"`);
    for (const id of [GONE, STAYS]) {
      await run(`insert into "session" (id, "expiresAt", token, "updatedAt", "userId") values ($1, now() + interval '1 day', $1, now(), $2)`, [`${id}-session`, id]);
      await run(`insert into "account" (id, "accountId", "providerId", "userId", "updatedAt") values ($1, $1, 'linkedin', $2, now())`, [`${id}-account`, id]);
    }
    // The person leaving connected the Organiser's permission.
    await run(`delete from "organiserLichess"`);
    await run(
      `insert into "organiserLichess" ("userId", "lichessId", "scopes", "token", "expiresAt") values ($1, 'leader', 'tournament:write team:lead', 'v1.sealed', now() + interval '1 year')`,
      [GONE],
    );
    // A Matchday in December 2099, after any real one, that both played, and their Game.
    await run(`insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values ('2099-12-06', 'LT991206', now())`);
    for (const [id, rank] of [[GONE, 1], [STAYS, 2]] as const)
      await run(`insert into "matchdayResult" ("matchdayDate", "userId", "rank", "points", "rating") values ('2099-12-06', $1, $2, 1, 1500)`, [id, rank]);
    await run(
      `insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt")
       values ('leavtst1', '2099-12-06', $1, $2, 'white', 'resign', 40, 1500, 1500, 600, now())`,
      [GONE, STAYS],
    );

    expect(await removeMember("leaving-test-nobody")).toBe(false);
    expect(await removeMember(GONE)).toBe(true);

    const theirs = (table: string, column = "userId") => count(`select 1 from "${table}" where "${column}" = $1`, [GONE]);
    expect(await count(`select 1 from "user" where id = $1`, [GONE])).toBe(0);
    for (const table of ["session", "account", "matchdayResult", "organiserLichess"]) expect(await theirs(table)).toBe(0);
    expect((await run(`select "whiteId", "blackId" from "game" where "lichessGameId" = 'leavtst1'`)).rows).toEqual([{ whiteId: null, blackId: STAYS }]);
    // The other person, and everything of theirs, is as it was.
    expect(await count(`select 1 from "user" where id = $1`, [STAYS])).toBe(1);
    for (const table of ["session", "account", "matchdayResult"])
      expect(await count(`select 1 from "${table}" where "userId" = $1`, [STAYS])).toBe(1);
    // Their account is kept to remove from the Club's Lichess team by hand, with why.
    const why = "LICHESS_TEAM_ID is not set, so the Club's Lichess team is not known.";
    expect(await teamRemovals()).toEqual([{ lichessId: `${GONE}-on-lichess`, problem: why }]);

    // Someone else leaves too; and someone who came back with the first one's Lichess account leaves again, which keeps
    // that account once.
    await addPerson("leaving-test-also");
    await addPerson("leaving-test-back", `${GONE}-on-lichess`);
    expect(await removeMember("leaving-test-also")).toBe(true);
    expect(await removeMember("leaving-test-back")).toBe(true);
    expect((await teamRemovals()).map((r) => r.lichessId).sort()).toEqual([`leaving-test-also-on-lichess`, `${GONE}-on-lichess`]);

    // The Organiser has removed one of them on Lichess: only that one is forgotten.
    await forgetTeamRemoval("leaving-test-also-on-lichess");
    expect(await teamRemovals()).toEqual([{ lichessId: `${GONE}-on-lichess`, problem: why }]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }, 60_000);

  it("switches a Member's account, forgetting the new one if it was kept for the Organiser, and then removes or keeps only an account nobody has", async () => {
    // A fake Lichess for the switch itself. Without LICHESS_TOKEN_KEY the Organiser's permission cannot be read, so the
    // removal from the team fails before asking Lichess anything.
    const lichess = createFakeLichess({ teamId: "switch-team", teamPassword: "pw", accounts: [{ id: "switch-test-new", username: "switch-test-new" }] });
    vi.stubGlobal("fetch", lichess.fetch);
    for (const [name, value] of Object.entries({
      LICHESS_URL: "https://fake.lichess.test",
      BETTER_AUTH_URL: "https://offboard.test",
      BETTER_AUTH_SECRET: "test secret",
      LICHESS_TEAM_ID: "switch-team",
      LICHESS_TEAM_PASSWORD: "pw",
      LICHESS_TOKEN_KEY: "",
    }))
      vi.stubEnv(name, value);
    const MEMBER = "switch-test-member";
    const OTHER = "switch-test-other";
    await addPerson(OTHER);
    await addPerson(MEMBER);
    await run(`delete from "teamRemoval"`);
    // The new account was kept for the Organiser once, when someone else gave it up; so was an account nobody has.
    for (const lichessId of ["switch-test-new", "switch-test-unheld"])
      await run(`insert into "teamRemoval" ("lichessId", "problem") values ($1, 'kept')`, [lichessId]);

    // Each switch is saved, and names the account it replaced, as the row was.
    const switchTo = async (account: string, person: { id: string; lichessId: string | null }) => {
      const { url, cookie } = startConnection(person.id);
      lichess.signedInAs = account;
      const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
      return finishConnection(person, back.searchParams, cookie);
    };
    expect(await switchTo("switch-test-new", { id: MEMBER, lichessId: `${MEMBER}-on-lichess` })).toEqual({
      to: `/profiles/${MEMBER}`,
      replaced: `${MEMBER}-on-lichess`,
    });
    expect((await run(`select id, "lichessId" from "user" where id in ($1, $2) order by id`, [MEMBER, OTHER])).rows).toEqual([
      { id: MEMBER, lichessId: "switch-test-new" },
      { id: OTHER, lichessId: `${OTHER}-on-lichess` },
    ]);
    expect(await teamRemovals()).toEqual([{ lichessId: "switch-test-unheld", problem: "kept" }]);
    // A second switch, from a session still naming the first account, names the account the row has now.
    for (const id of ["switch-test-third", "switch-test-unheld"]) lichess.accounts.set(id, { id, username: id });
    expect((await switchTo("switch-test-third", { id: MEMBER, lichessId: `${MEMBER}-on-lichess` })).replaced).toBe("switch-test-new");
    // Someone who deleted their account while connecting: nothing is saved, so nothing is forgotten, even if keeping
    // the account then fails; once that works, the account is kept with why (#43).
    const through = db.query.bind(db) as (sql: string, params?: unknown[]) => Promise<unknown>;
    const failing = vi.spyOn(db, "query").mockImplementation(((sql: string, params?: unknown[]) =>
      sql.includes(`insert into "teamRemoval"`) ? Promise.reject(new Error("Connection terminated unexpectedly")) : through(sql, params)) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await switchTo("switch-test-unheld", { id: "switch-test-gone", lichessId: null })).to).toBe("/welcome/lichess?lichess=failed");
    failing.mockRestore();
    expect(await teamRemovals()).toEqual([{ lichessId: "switch-test-unheld", problem: "kept" }]);
    expect(await switchTo("switch-test-unheld", { id: "switch-test-gone", lichessId: null })).toEqual({ to: "/welcome/profile", replaced: null });
    const never = "Its owner deleted their account on Offboard while it was joining the Club's team, so it was never connected.";
    expect(await teamRemovals()).toEqual([{ lichessId: "switch-test-unheld", problem: never }]);

    // The accounts switched from are nobody's now: kept, with why. The one in use, and another Member's, are left.
    const by = Date.now() + 25_000;
    for (const account of [`${MEMBER}-on-lichess`, "switch-test-new", "switch-test-third", `${OTHER}-on-lichess`])
      await removeSwitchedFrom(account, by);
    const why = "LICHESS_TOKEN_KEY is not set, so the Organiser's Lichess permission cannot be read.";
    expect((await teamRemovals()).sort((a, b) => (a.lichessId < b.lichessId ? -1 : 1))).toEqual([
      { lichessId: `${MEMBER}-on-lichess`, problem: why },
      { lichessId: "switch-test-new", problem: why },
      { lichessId: "switch-test-unheld", problem: never },
    ]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }, 60_000);

  it("keeps for the Organiser only an account nobody has once Lichess has answered", async () => {
    // The Organiser has connected their Lichess account, which leads the team; Lichess then fails every removal, slowly
    // enough that a Member can switch back to the account meanwhile.
    const lichess = createFakeLichess({ teamId: "switch-team", teamPassword: "pw", accounts: [{ id: "switch-boss", username: "switch-boss" }] });
    lichess.team.leaders.add("switch-boss");
    const ORGANISER = "switch-test-organiser";
    for (const [name, value] of Object.entries({
      LICHESS_URL: "https://fake.lichess.test",
      BETTER_AUTH_URL: "https://offboard.test",
      BETTER_AUTH_SECRET: "test secret",
      LICHESS_TEAM_ID: "switch-team",
      LICHESS_TOKEN_KEY: randomBytes(32).toString("base64"),
      ORGANISER_USER_ID: ORGANISER,
    }))
      vi.stubEnv(name, value);
    let duringRemoval = async () => {};
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/kick/")) return lichess.fetch(input, init);
      await duringRemoval();
      return new Response("", { status: 503 });
    });
    await addPerson(ORGANISER, "switch-boss-plays");
    await run(`delete from "organiserLichess"`);
    await run(`delete from "teamRemoval"`);
    const { url, cookie } = startOrganiserConnection(ORGANISER);
    lichess.signedInAs = "switch-boss";
    const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
    expect(await finishOrganiserConnection({ id: ORGANISER }, back.searchParams, cookie)).toBe("/organiser?lichess=connected");

    // A Member has switched from race-old to race-new, and switches back while Lichess is being asked to remove race-old.
    const MEMBER = "switch-test-racer";
    await addPerson(MEMBER, "race-new");
    duringRemoval = async () => void (await run(`update "user" set "lichessId" = 'race-old' where id = $1`, [MEMBER]));
    await removeSwitchedFrom("race-old", Date.now() + 25_000);
    // Someone else's old account, which nobody takes meanwhile.
    duringRemoval = async () => {};
    await removeSwitchedFrom("race-gone", Date.now() + 25_000);
    expect(await teamRemovals()).toEqual([{ lichessId: "race-gone", problem: "Lichess answered POST /api/team/{teamId}/kick/{userId} with 503." }]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }, 60_000);

  it("deletes everything of someone part-way through signing up, and asks nothing of Lichess (#43)", async () => {
    // With the Club's team configured, so that only the missing Lichess account keeps the site from asking. Some calls
    // swallow a failed request (revoke), so the requests are counted.
    vi.stubEnv("LICHESS_TEAM_ID", "pretend-team");
    const fetch = vi.fn(() => Promise.reject(new Error("nothing may reach Lichess")));
    vi.stubGlobal("fetch", fetch);
    const removalsBefore = await teamRemovals();
    // One has not agreed yet; the other has agreed and not connected Lichess. Each signed in once with LinkedIn.
    for (const [id, agreed] of [["leaving-test-new", false], ["leaving-test-half", true]] as const) {
      await run(
        `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt")
         values ($1, $1, $2, true, $3, $3)`,
        [id, `${id}@example.invalid`, agreed ? new Date() : null],
      );
      await run(`insert into "session" (id, "expiresAt", token, "updatedAt", "userId") values ($1, now() + interval '1 day', $1, now(), $2)`, [`${id}-session`, id]);
      await run(`insert into "account" (id, "accountId", "providerId", "userId", "updatedAt") values ($1, $1, 'linkedin', $2, now())`, [`${id}-account`, id]);
      expect(await removeMember(id)).toBe(true);
      expect(await count(`select 1 from "user" where id = $1`, [id])).toBe(0);
      for (const table of ["session", "account"]) expect(await count(`select 1 from "${table}" where "userId" = $1`, [id])).toBe(0);
    }
    expect(await teamRemovals()).toEqual(removalsBefore);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }, 60_000);
});
