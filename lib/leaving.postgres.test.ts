import type { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { finishConnection, startConnection } from "./connect-lichess";
import { createFakeLichess } from "./fixtures/fake-lichess";
import { waitingForLock } from "./fixtures/waiting-for-lock";
import { forgetTeamRemoval, isMember, membersToRemove, removeMember, removeSwitchedFrom, teamRemovals } from "./leaving";
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
//
// One case needs two connections of its own, outside that transaction, which see each other's statements: it commits a
// person of its own, part-way through signing up so that no other suite counts them, and deletes them whatever happens.
vi.mock("@/lib/db", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // The connection the app's statements go to: the test's transaction, unless a case runs them on one of its own.
  const on = new AsyncLocalStorage<pg.Client>();
  const inner: Record<string, string> = {
    begin: "savepoint leaving",
    commit: "release savepoint leaving",
    rollback: "rollback to savepoint leaving",
  };
  // Nothing the app sends may end the test's transaction.
  const query = (sql: string, params?: unknown[]) => {
    const own = on.getStore();
    if (own) return own.query(sql, params);
    if (/^\s*(begin|start|commit|end|rollback|abort)\b/i.test(sql)) throw new Error(`refused inside the test's transaction: ${sql}`);
    return client.query(sql, params);
  };
  const connect = async () => ({
    query: (sql: string, params?: unknown[]) => (Object.hasOwn(inner, sql) ? client.query(inner[sql]) : query(sql, params)),
    release: () => {},
  });
  return { db: { client, on, query, connect } };
});

describe.skipIf(!process.env.DATABASE_URL || process.env.ALLOW_DB_TESTS !== "1")("leaving the Club in Postgres", () => {
  const client = (db as unknown as { client: pg.Client }).client;
  const { on } = db as unknown as { on: AsyncLocalStorage<pg.Client> };
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
      `insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating", "blackRating", "winnerClockCentis", "finishedAt", "moves")
       values ('leavtst1', '2099-12-06', $1, $2, 'white', 'resign', 4, 1500, 1500, 600, now(), 'e4 e5 Qh5 Nc6')`,
      [GONE, STAYS],
    );

    expect(await removeMember("leaving-test-nobody")).toBe(false);
    expect(await removeMember(GONE)).toBe(true);

    const theirs = (table: string, column = "userId") => count(`select 1 from "${table}" where "${column}" = $1`, [GONE]);
    expect(await count(`select 1 from "user" where id = $1`, [GONE])).toBe(0);
    for (const table of ["session", "account", "matchdayResult", "organiserLichess"]) expect(await theirs(table)).toBe(0);
    // With its Lichess id, ratings and moves, as /privacy says.
    expect((await run(`select "whiteId", "blackId", "whiteRating", "blackRating", "moves" from "game" where "lichessGameId" = 'leavtst1'`)).rows).toEqual([
      { whiteId: null, blackId: STAYS, whiteRating: 1500, blackRating: 1500, moves: "e4 e5 Qh5 Nc6" },
    ]);
    // The other person, and everything of theirs, is as it was.
    expect(await count(`select 1 from "user" where id = $1`, [STAYS])).toBe(1);
    for (const table of ["session", "account", "matchdayResult"])
      expect(await count(`select 1 from "${table}" where "userId" = $1`, [STAYS])).toBe(1);
    // Their account is kept to remove from the Club's Lichess team by hand, with why.
    const why = "LICHESS_TEAM_ID is not set, so the Club's Lichess team is not known.";
    expect(await teamRemovals()).toEqual([{ lichessId: `${GONE}-on-lichess`, problem: why, heldBy: null }]);

    // Someone else leaves too; and someone who came back with the first one's Lichess account leaves again, which keeps
    // that account once.
    await addPerson("leaving-test-also");
    await addPerson("leaving-test-back", `${GONE}-on-lichess`);
    expect(await removeMember("leaving-test-also")).toBe(true);
    expect(await removeMember("leaving-test-back")).toBe(true);
    expect((await teamRemovals()).map((r) => r.lichessId).sort()).toEqual([`leaving-test-also-on-lichess`, `${GONE}-on-lichess`]);

    // The Organiser has removed one of them on Lichess: only that one is forgotten.
    await forgetTeamRemoval("leaving-test-also-on-lichess");
    expect(await teamRemovals()).toEqual([{ lichessId: `${GONE}-on-lichess`, problem: why, heldBy: null }]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }, 60_000);

  it("offers the Organiser every Member to remove but themselves, and nobody part-way through signing up", async () => {
    const add = (id: string, name: string, member = true) =>
      run(
        `insert into "user" (id, name, email, "emailVerified", "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId", "lichessUsername")
         values ($1, $2, $1 || '@example.invalid', false, now(), now(), $3, $3)`,
        [id, name, member ? `${id}-on-lichess` : null],
      );
    // The Organiser first, so that a query reading the wrong person reads them.
    await add("removable-test-organiser", "Removable Organiser");
    await add("removable-test-zita", "Removable Žilvinas");
    await add("removable-test-ana", "Removable Ana");
    await add("removable-test-half", "Removable Half", false);
    const listed = (await membersToRemove("removable-test-organiser")).filter((m) => m.id.startsWith("removable-test-"));
    expect(listed).toEqual([
      { id: "removable-test-ana", name: "Removable Ana", lichessUsername: "removable-test-ana-on-lichess" },
      { id: "removable-test-zita", name: "Removable Žilvinas", lichessUsername: "removable-test-zita-on-lichess" },
    ]);
    // Only a Member may be removed.
    expect(await isMember("removable-test-ana")).toBe(true);
    expect(await isMember("removable-test-half")).toBe(false);
    expect(await isMember("removable-test-nobody")).toBe(false);
  });

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
    expect(await teamRemovals()).toEqual([{ lichessId: "switch-test-unheld", problem: "kept", heldBy: null }]);
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
    expect(await teamRemovals()).toEqual([{ lichessId: "switch-test-unheld", problem: "kept", heldBy: null }]);
    expect(await switchTo("switch-test-unheld", { id: "switch-test-gone", lichessId: null })).toEqual({ to: "/welcome/profile", replaced: null });
    const never = "Its owner deleted their account on Offboard while it was joining the Club's team, so it was never connected.";
    expect(await teamRemovals()).toEqual([{ lichessId: "switch-test-unheld", problem: never, heldBy: null }]);

    // The accounts switched from are nobody's now: kept, with why. The one in use, and another Member's, are left.
    const by = Date.now() + 25_000;
    for (const account of [`${MEMBER}-on-lichess`, "switch-test-new", "switch-test-third", `${OTHER}-on-lichess`])
      await removeSwitchedFrom(account, by);
    const why = "LICHESS_TOKEN_KEY isn't set, so your Lichess permission can't be read.";
    expect((await teamRemovals()).sort((a, b) => (a.lichessId < b.lichessId ? -1 : 1))).toEqual([
      { lichessId: `${MEMBER}-on-lichess`, problem: why, heldBy: null },
      { lichessId: "switch-test-new", problem: why, heldBy: null },
      { lichessId: "switch-test-unheld", problem: never, heldBy: null },
    ]);

    // Someone else who deleted their account while connecting, whose account another Member connected while it was
    // joining the team: it is that Member's now, so nothing is kept to remove.
    lichess.accounts.set("switch-test-shared", { id: "switch-test-shared", username: "switch-test-shared" });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/join")) await run(`update "user" set "lichessId" = 'switch-test-shared' where id = $1`, [OTHER]);
      return lichess.fetch(input, init);
    });
    expect(await switchTo("switch-test-shared", { id: "switch-test-vanished", lichessId: null })).toEqual({ to: "/welcome/profile", replaced: null });
    expect((await teamRemovals()).map((r) => r.lichessId)).not.toContain("switch-test-shared");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }, 60_000);

  // Two switches of one person saved at once, each on its own connection, as two of the site's servers would save them:
  // the first holds its save, in a transaction, until the second waits for it.
  it("names, of two switches saved at once, the account each replaced", async () => {
    const tag = randomBytes(6).toString("hex");
    const person = `switch-race-${tag}`;
    const [was, first, second] = ["was", "one", "two"].map((n) => `race-${n}-${tag}`);
    const lichess = createFakeLichess({ teamId: "switch-team", teamPassword: "pw", accounts: [first, second].map((id) => ({ id, username: id })) });
    vi.stubGlobal("fetch", lichess.fetch);
    for (const [name, value] of Object.entries({
      LICHESS_URL: "https://fake.lichess.test",
      BETTER_AUTH_URL: "https://offboard.test",
      BETTER_AUTH_SECRET: "test secret",
      LICHESS_TEAM_ID: "switch-team",
      LICHESS_TEAM_PASSWORD: "pw",
    }))
      vi.stubEnv(name, value);
    const [one, two, watcher] = [0, 1, 2].map(() => new pg.Client({ connectionString: process.env.DATABASE_URL }));
    await Promise.all([one.connect(), two.connect(), watcher.connect()]);
    try {
      await watcher.query(
        `insert into "user" (id, name, email, "emailVerified", "lichessId", "lichessUsername") values ($1, $1, $1 || '@example.invalid', false, $2, $2)`,
        [person, was],
      );
      const switchOn = async (connection: pg.Client, account: string) => {
        const { url, cookie } = startConnection(person);
        lichess.signedInAs = account;
        const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
        // Both from a session read before either switch, naming the account the person had.
        return on.run(connection, () => finishConnection({ id: person, lichessId: was }, back.searchParams, cookie));
      };
      await one.query("begin");
      expect(await switchOn(one, first)).toEqual({ to: `/profiles/${person}`, replaced: was });
      const { rows } = await two.query<{ pid: number }>(`select pg_backend_pid() as pid`);
      const saving = switchOn(two, second);
      await waitingForLock(watcher, rows[0].pid);
      await one.query("commit");
      expect(await saving).toEqual({ to: `/profiles/${person}`, replaced: first });
      expect((await watcher.query(`select "lichessId" from "user" where id = $1`, [person])).rows).toEqual([{ lichessId: second }]);
    } finally {
      await one.query("rollback").catch(() => {});
      await watcher.query(`delete from "user" where id = $1`, [person]);
      await Promise.all([one.end(), two.end(), watcher.end()]);
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  }, 30_000);

  // The Organiser `organiser` connects their Lichess account, which leads the team, to a fake Lichess, with nothing kept
  // for the Organiser yet. Each request to remove an account from the team then runs `removal.during`, as another
  // request at the same moment would, and is answered by `removal.answer`, as Lichess would by default.
  async function connectOrganiser(organiser: string) {
    const lichess = createFakeLichess({ teamId: "switch-team", teamPassword: "pw", accounts: [{ id: "switch-boss", username: "switch-boss" }] });
    lichess.team.leaders.add("switch-boss");
    for (const [name, value] of Object.entries({
      LICHESS_URL: "https://fake.lichess.test",
      BETTER_AUTH_URL: "https://offboard.test",
      BETTER_AUTH_SECRET: "test secret",
      LICHESS_TEAM_ID: "switch-team",
      LICHESS_TOKEN_KEY: randomBytes(32).toString("base64"),
      ORGANISER_USER_ID: organiser,
    }))
      vi.stubEnv(name, value);
    const removal = { during: async () => {}, answer: (input: RequestInfo | URL, init?: RequestInit) => lichess.fetch(input, init) };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/kick/")) return lichess.fetch(input, init);
      await removal.during();
      return removal.answer(input, init);
    });
    await addPerson(organiser, `${organiser}-plays`);
    await run(`delete from "organiserLichess"`);
    await run(`delete from "teamRemoval"`);
    const { url, cookie } = startOrganiserConnection(organiser);
    lichess.signedInAs = "switch-boss";
    const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
    expect(await finishOrganiserConnection({ id: organiser }, back.searchParams, cookie)).toBe("/organiser?lichess=connected");
    return { lichess, removal };
  }

  it("keeps for the Organiser only an account nobody has once Lichess has answered", async () => {
    // Lichess fails every removal, slowly enough that a Member can switch back to the account meanwhile.
    const { removal } = await connectOrganiser("switch-test-organiser");
    removal.answer = async () => new Response("", { status: 503 });

    // A Member has switched from race-old to race-new, and switches back while Lichess is being asked to remove race-old.
    const MEMBER = "switch-test-racer";
    await addPerson(MEMBER, "race-new");
    removal.during = async () => void (await run(`update "user" set "lichessId" = 'race-old' where id = $1`, [MEMBER]));
    await removeSwitchedFrom("race-old", Date.now() + 25_000);
    // Someone else's old account, which nobody takes meanwhile.
    removal.during = async () => {};
    await removeSwitchedFrom("race-gone", Date.now() + 25_000);
    expect(await teamRemovals()).toEqual([{ lichessId: "race-gone", problem: "Lichess answered POST /api/team/{teamId}/kick/{userId} with 503.", heldBy: null }]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }, 60_000);

  it("once Lichess has removed an account, keeps it only while someone has it, and names them", async () => {
    const { lichess, removal } = await connectOrganiser("rejoin-test-organiser");
    for (const id of ["rejoin-old", "rejoin-new", "leave-old", "leave-new"]) lichess.team.members.add(id);
    const outOfTeam = "Lichess removed it from the Club's team just as it was connected again.";

    // A Member has switched from rejoin-old to rejoin-new, and switches back while Lichess removes rejoin-old.
    const BACK = "rejoin-test-back";
    await addPerson(BACK, "rejoin-new");
    removal.during = async () => void (await run(`update "user" set "lichessId" = 'rejoin-old' where id = $1`, [BACK]));
    await removeSwitchedFrom("rejoin-old", Date.now() + 25_000);
    expect(lichess.team.members.has("rejoin-old")).toBe(false);
    // Kept for its Member to connect again, by name. An account kept for someone who is no Member names nobody.
    await run(
      `insert into "user" (id, name, email, "emailVerified", "lichessId") values ('rejoin-test-half', 'Half', 'rejoin-test-half@example.invalid', false, 'rejoin-half')`,
    );
    await run(`insert into "teamRemoval" ("lichessId", "problem") values ('rejoin-half', 'kept')`);
    // (Each is kept at the same now(), the test's transaction's, so they come by account.)
    expect(await teamRemovals()).toEqual([
      { lichessId: "rejoin-half", problem: "kept", heldBy: null },
      { lichessId: "rejoin-old", problem: outOfTeam, heldBy: BACK },
    ]);

    // They switch to another account, and Lichess removes rejoin-old again: nobody has it, so nothing is left to do.
    removal.during = async () => {};
    await run(`update "user" set "lichessId" = 'rejoin-third' where id = $1`, [BACK]);
    await removeSwitchedFrom("rejoin-old", Date.now() + 25_000);
    expect((await teamRemovals()).map((r) => r.lichessId)).toEqual(["rejoin-half"]);

    // Someone leaves while their switch to leave-new is saved: that account, in the team, is kept for the Organiser.
    const LEAVER = "rejoin-test-leaver";
    await addPerson(LEAVER, "leave-old");
    removal.during = async () => void (await run(`update "user" set "lichessId" = 'leave-new' where id = $1`, [LEAVER]));
    expect(await removeMember(LEAVER)).toBe(true);
    expect(await teamRemovals()).toEqual([
      {
        lichessId: "leave-new",
        problem: "Its owner connected it to Offboard while their account was being deleted, so the site didn't remove it from the Club's team.",
        heldBy: null,
      },
      { lichessId: "rejoin-half", problem: "kept", heldBy: null },
    ]);
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
