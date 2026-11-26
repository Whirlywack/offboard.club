// Connecting Lichess, through the site's own entry points: the connectLichess action that sends the person to Lichess,
// and the callback Lichess sends them back to. Faked: the session, the database, the browser's cookie jar, and
// Lichess itself (lib/fixtures/fake-lichess.ts, standing in for fetch). Everything else is the app's own code.
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeLichess, type FakeAccount } from "@/lib/fixtures/fake-lichess";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";
import { fromDatabase } from "@/lib/fake-db";
import { codeChallenge, REVOKED_BY_MS } from "@/lib/connect-lichess";
import { connectLichess } from "./actions";
import { GET as comeBackFromLichess } from "./api/lichess/callback/route";

const { getSession, query, jar } = vi.hoisted(() => {
  // The browser's cookies for the site. Paths are ignored: only the callback ever reads this cookie.
  const values = new Map<string, string>();
  const jar = {
    values,
    sets: [] as Record<string, unknown>[],
    get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
    set: (cookie: { name: string; value: string }) => {
      jar.sets.push(cookie);
      values.set(cookie.name, cookie.value);
    },
    delete: (cookie: { name: string }) => void values.delete(cookie.name),
  };
  return { getSession: vi.fn(), query: vi.fn(), jar };
});
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => jar }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  // As Next.js's: passes on what redirect throws, and nothing else.
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("redirect ")) throw error;
  },
}));
vi.mock("@/lib/db", () => ({ db: { query } }));
// What the callback does once the person has been sent on is app/switching-lichess.test.ts's; here it never runs.
vi.mock("next/server", () => ({ after: () => {} }));

// --- The "user" table ---

type Person = {
  id: string;
  name: string;
  email: string;
  position: string | null;
  publicDisplayConsentAt: Date | null;
  houseRulesAcceptedAt: Date | null;
  lichessId: string | null;
  lichessUsername: string | null;
  lichessBlitzRating: number | null;
  lichessConnectedAt: Date | null;
  lichessMarked: boolean;
  lichessClosed: boolean;
};
const at = new Date("2026-11-24T18:00:00Z");
let people: Map<string, Person>;
let teamRemovals: Map<string, string>; // "teamRemoval": each account's problem, by Lichess id

const person = (id: string, more: Partial<Person> = {}): Person => ({
  id,
  name: `Person ${id}`,
  email: `${id}@example.com`,
  position: "CTO",
  publicDisplayConsentAt: at,
  houseRulesAcceptedAt: at,
  lichessId: null,
  lichessUsername: null,
  lichessBlitzRating: null,
  lichessConnectedAt: null,
  lichessMarked: false,
  lichessClosed: false,
  ...more,
});

// The statements the connection makes, answered as Postgres would, unique "lichessId" included.
async function fakeQuery(sql: string, params: unknown[] = []) {
  if (/^select 1 from "user" where "lichessId" = \$1 and id <> \$2$/.test(sql)) {
    const [lichessId, id] = params;
    return { rows: [...people.values()].filter((p) => p.lichessId === lichessId && p.id !== id).map(() => ({})) };
  }
  const text = sql.replace(/\s+/g, " ").trim();
  // The save, with the account it replaced, and forgetting the new one from the Organiser's list once saved.
  if (text === `with saved as ( update "user" u set "lichessId" = $2, "lichessUsername" = $3, "lichessBlitzRating" = $4, "lichessMarked" = false, "lichessClosed" = false, "lichessConnectedAt" = coalesce("lichessConnectedAt", now()), "updatedAt" = now() from (select id, "lichessId" from "user" where id = $1 for update) before where u.id = before.id returning before."lichessId" as "replaced" ), forgotten as (delete from "teamRemoval" where "lichessId" = $2 and exists (select 1 from saved)) select "replaced" from saved`) {
    const [id, lichessId, lichessUsername, lichessBlitzRating] = params as [string, string, string, number | null];
    if ([...people.values()].some((p) => p.lichessId === lichessId && p.id !== id))
      throw Object.assign(new Error('duplicate key value violates unique constraint "user_lichessId_key"'), { code: "23505" });
    const row = people.get(id);
    if (!row) return { rows: [], rowCount: 0 };
    const replaced = row.lichessId;
    teamRemovals.delete(lichessId);
    Object.assign(row, {
      lichessId,
      lichessUsername,
      lichessBlitzRating,
      lichessMarked: false,
      lichessClosed: false,
      lichessConnectedAt: row.lichessConnectedAt ?? new Date(),
    });
    return { rows: [{ replaced }], rowCount: 1 };
  }
  // The account kept for the Organiser to remove from the team by hand, once, and not while anyone has it, as
  // lib/fake-db.ts has it.
  if (text === `insert into "teamRemoval" ("lichessId", "problem") select $1, $2 where not exists (select 1 from "user" where "lichessId" = $1) on conflict ("lichessId") do update set "at" = now(), "problem" = excluded."problem"`) {
    const [lichessId, problem] = params as [string, string];
    if ([...people.values()].some((p) => p.lichessId === lichessId)) return { rows: [], rowCount: 0 };
    teamRemovals.set(lichessId, problem);
    return { rows: [], rowCount: 1 };
  }
  throw new Error(`unexpected query: ${sql}`);
}

const statements = () => query.mock.calls.map(([sql]) => (sql as string).split(" ").slice(0, 2).join(" "));
// The failed requests the callback tried to record (lib/request-failures.ts), which fakeQuery does not keep.
const failuresRecorded = () => query.mock.calls.filter(([sql]) => (sql as string).includes(`"requestFailure"`)).map(([, params]) => params);
const updates = () => query.mock.calls.filter(([sql]) => (sql as string).includes(`update "user"`));

// --- Lichess ---

const accounts: FakeAccount[] = [
  { id: "bobby", username: "Bobby", perfs: { blitz: { games: 674, rating: 1623, rd: 64, prog: 43 } } },
  { id: "newbie", username: "Newbie" },
  { id: "closed", username: "Closed", disabled: true },
  { id: "marked", username: "Marked", tosViolation: true },
  { id: "taken", username: "Taken" },
  { id: "oldie", username: "Oldie", perfs: { blitz: { games: 20, rating: 1500, rd: 120, prog: 0 } } },
];
let lichess: ReturnType<typeof createFakeLichess>;

const apiCalls = () => lichess.calls.map((c) => `${c.method} ${c.path}`);
const revoked = () => [...lichess.tokens.values()].every((t) => t.revoked);

// --- The browser ---

let signedIn: string | null;

async function redirectedTo(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const to = /^redirect (.+)$/.exec((error as Error).message)?.[1];
    if (to) return to;
    throw error;
  }
  throw new Error("expected a redirect");
}

// Presses "Connect Lichess": where the browser is sent.
const pressConnect = async () => new URL(await redirectedTo(() => connectLichess()));

// Lichess's authorization page, approving as whoever is signed in to Lichess (or declining): where it sends the browser.
async function approveOnLichess(at: URL, as: string | null) {
  lichess.signedInAs = as;
  const response = await lichess.handle(new Request(at));
  return new URL(response.headers.get("location")!);
}

// The browser arriving back at the site: where the site sends it next.
const arrive = (at: URL) => redirectedTo(() => comeBackFromLichess(new Request(at)));

async function connectAs(account: string | null) {
  return arrive(await approveOnLichess(await pressConnect(), account));
}

beforeEach(() => {
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test secret");
  vi.stubEnv("LICHESS_TEAM_ID", "offboard-team");
  vi.stubEnv("LICHESS_TEAM_PASSWORD", "team password");
  lichess = createFakeLichess({ teamId: "offboard-team", teamPassword: "team password", accounts });
  vi.stubGlobal("fetch", lichess.fetch);
  people = new Map(
    [
      person("newcomer"),
      person("unwelcomed", { publicDisplayConsentAt: null, houseRulesAcceptedAt: null }),
      person("member", { lichessId: "oldie", lichessUsername: "Oldie", lichessBlitzRating: 1500, lichessConnectedAt: at }),
      person("other", { lichessId: "taken", lichessUsername: "Taken", lichessConnectedAt: at }),
    ].map((p) => [p.id, p]),
  );
  teamRemovals = new Map();
  lichess.team.members.add("taken");
  signedIn = "newcomer";
  getSession.mockReset().mockImplementation(async () => {
    const user = signedIn ? people.get(signedIn) : undefined;
    return user ? { user: { ...user } } : null;
  });
  query.mockReset().mockImplementation(fakeQuery);
  jar.values.clear();
  jar.sets.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PKCE", () => {
  it("derives the S256 challenge as in RFC 7636, appendix B", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("starting to connect", () => {
  it("sends a newcomer to Lichess to approve joining a team, and nothing more", async () => {
    const to = await pressConnect();
    expect(`${to.origin}${to.pathname}`).toBe("https://fake.lichess.test/oauth");
    const p = to.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe("offboard.club");
    expect(p.get("redirect_uri")).toBe("https://offboard.test/api/lichess/callback");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(p.get("scope")).toBe("team:write");
    expect(p.get("state")).toMatch(/^[\w-]{43}$/);
    expect(lichess.calls).toEqual([]); // the site itself asks Lichess nothing yet
  });

  it("keeps the attempt in an httpOnly, SameSite=Lax cookie sent only to the callback, for ten minutes", async () => {
    await pressConnect();
    expect(jar.sets).toEqual([
      expect.objectContaining({ name: "offboard-lichess", httpOnly: true, sameSite: "lax", path: "/api/lichess/callback", maxAge: 600, secure: false }),
    ]);
  });

  it("marks the cookie Secure and uses lichess.org in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const to = await pressConnect();
    expect(to.origin).toBe("https://lichess.org");
    expect(jar.sets[0]).toMatchObject({ secure: true });
  });

  it("starts afresh each time, with a new state and challenge", async () => {
    const first = await pressConnect();
    const second = await pressConnect();
    expect(second.searchParams.get("state")).not.toBe(first.searchParams.get("state"));
    expect(second.searchParams.get("code_challenge")).not.toBe(first.searchParams.get("code_challenge"));
  });

  it("sends a signed-out visitor home", async () => {
    signedIn = null;
    expect(await redirectedTo(() => connectLichess())).toBe("/");
    expect(jar.sets).toEqual([]);
  });

  it("sends someone who has not finished the welcome step there", async () => {
    signedIn = "unwelcomed";
    expect(await redirectedTo(() => connectLichess())).toBe("/welcome");
    expect(jar.sets).toEqual([]);
  });

  it("says so, rather than failing, until the team is configured", async () => {
    vi.stubEnv("LICHESS_TEAM_PASSWORD", "");
    expect(await connectLichess()).toMatch(/isn't set up yet/);
    expect(jar.sets).toEqual([]);
  });
});

describe("coming back from Lichess", () => {
  it("joins the team with the person's own permission, makes them a Member and goes on to the Profile step", async () => {
    expect(await connectAs("bobby")).toBe("/welcome/profile");
    expect(people.get("newcomer")).toMatchObject({
      lichessId: "bobby",
      lichessUsername: "Bobby",
      lichessBlitzRating: 1623,
      lichessConnectedAt: expect.any(Date),
    });
    expect(lichess.team.members.has("bobby")).toBe(true);
    expect(apiCalls()).toEqual([
      "POST /api/token",
      "GET /api/account",
      "GET /api/user/bobby",
      "POST /team/offboard-team/join",
      "DELETE /api/token",
    ]);
    const join = lichess.calls[3];
    expect(join.body.get("password")).toBe("team password");
    expect(join.authorization).toMatch(/^Bearer lio_/);
    expect(lichess.calls.every((c) => c.userAgent?.includes("offboard.club"))).toBe(true);
    expect(teamRemovals.size).toBe(0);
  });

  it("keeps the account for the Organiser to remove from the team by hand when the person deletes theirs meanwhile", async () => {
    // They press "Delete my account" in another tab while Lichess adds the account to the team.
    lichess.override = (c) => void (c.path.endsWith("/join") && people.delete("newcomer"));
    expect(await connectAs("bobby")).toBe("/welcome/profile"); // which sends them, signed out, home
    expect(lichess.team.members.has("bobby")).toBe(true);
    expect([...teamRemovals]).toEqual([
      ["bobby", "Its owner deleted their account on Offboard while it was joining the Club's team, so it was never connected."],
    ]);
    expect(revoked()).toBe(true);
  });

  it("revokes the token once it has been used, and clears the cookie", async () => {
    await connectAs("bobby");
    expect(lichess.tokens.size).toBe(1);
    expect(revoked()).toBe(true);
    expect(jar.values.size).toBe(0);
  });

  it("stores no blitz rating for an account that has none", async () => {
    expect(await connectAs("newbie")).toBe("/welcome/profile");
    expect(people.get("newcomer")).toMatchObject({ lichessId: "newbie", lichessBlitzRating: null });
  });

  it("counts an account that is already in the team as joined", async () => {
    lichess.team.members.add("bobby");
    expect(await connectAs("bobby")).toBe("/welcome/profile");
    expect(people.get("newcomer")?.lichessId).toBe("bobby");
  });

  it("sends a signed-out visitor home without asking Lichess anything", async () => {
    const back = await approveOnLichess(await pressConnect(), "bobby");
    signedIn = null;
    expect(await arrive(back)).toBe("/");
    expect(lichess.calls).toEqual([]);
    expect(jar.values.size).toBe(0);
  });

  it("sends someone who has not finished the welcome step there without asking Lichess anything", async () => {
    const back = await approveOnLichess(await pressConnect(), "bobby");
    signedIn = "unwelcomed";
    expect(await arrive(back)).toBe("/welcome");
    expect(lichess.calls).toEqual([]);
  });

  it("sends the person back to the connect step, told it didn't work, when the session cannot be read", async () => {
    const back = await approveOnLichess(await pressConnect(), "bobby");
    const settled = keepWaitUntil();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockRejectedValue(fromDatabase(new Error("Connection terminated due to connection timeout")));
    expect(await arrive(back)).toBe("/welcome/lichess?lichess=failed");
    expect(lichess.calls).toEqual([]);
    expect(jar.values.size).toBe(0);
    expect(logged).toHaveBeenCalledWith("Coming back from Lichess, the session could not be read:", "Connection terminated due to connection timeout");
    await settled();
    expect(failuresRecorded()).toEqual([["/api/lichess/callback", "route", "the database couldn't be reached"]]);
  });

  describe("refuses an attempt it did not start in this browser, without asking Lichess anything", () => {
    it("when the state does not match", async () => {
      const back = await approveOnLichess(await pressConnect(), "bobby");
      back.searchParams.set("state", "x".repeat(43));
      expect(await arrive(back)).toBe("/welcome/lichess?lichess=expired");
      expect(lichess.calls).toEqual([]);
    });

    it("when the state is missing", async () => {
      const back = await approveOnLichess(await pressConnect(), "bobby");
      back.searchParams.delete("state");
      expect(await arrive(back)).toBe("/welcome/lichess?lichess=expired");
      expect(lichess.calls).toEqual([]);
    });

    it("when the browser has no cookie for it", async () => {
      const back = await approveOnLichess(await pressConnect(), "bobby");
      jar.values.clear();
      expect(await arrive(back)).toBe("/welcome/lichess?lichess=expired");
      expect(lichess.calls).toEqual([]);
    });

    it("when the state comes back a second time", async () => {
      const back = await approveOnLichess(await pressConnect(), "bobby");
      expect(await arrive(back)).toBe("/welcome/profile");
      const asked = lichess.calls.length;
      expect(await arrive(back)).toBe("/profile?lichess=expired");
      expect(lichess.calls.length).toBe(asked);
    });

    it("when it was started by someone else", async () => {
      const back = await approveOnLichess(await pressConnect(), "bobby");
      signedIn = "member";
      expect(await arrive(back)).toBe("/profile?lichess=expired");
      expect(lichess.calls).toEqual([]);
    });

    it("when the cookie has been made up or altered", async () => {
      const back = await approveOnLichess(await pressConnect(), "bobby");
      const [body, signature] = jar.values.get("offboard-lichess")!.split(".");
      const pending = JSON.parse(Buffer.from(body, "base64url").toString());
      const forged = Buffer.from(JSON.stringify({ ...pending, verifier: "attacker".repeat(6) })).toString("base64url");
      jar.values.set("offboard-lichess", `${forged}.${signature}`);
      expect(await arrive(back)).toBe("/welcome/lichess?lichess=expired");
      expect(lichess.calls).toEqual([]);
    });

    it("when more than ten minutes have passed", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const back = await approveOnLichess(await pressConnect(), "bobby");
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
      expect(await arrive(back)).toBe("/welcome/lichess?lichess=expired");
      expect(lichess.calls).toEqual([]);
    });
  });

  it("says nothing changed when the person declines on Lichess", async () => {
    expect(await connectAs(null)).toBe("/welcome/lichess?lichess=denied");
    expect(lichess.calls).toEqual([]);
    expect(people.get("newcomer")?.lichessId).toBeNull();
  });

  it("refuses a marked account, which Lichess shows only to others, leaves it out of the team and revokes the token", async () => {
    expect(await connectAs("marked")).toBe("/welcome/lichess?lichess=marked");
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", "GET /api/user/marked", "DELETE /api/token"]);
    expect(lichess.calls[2].authorization).toBeNull(); // asked as anyone, not as the account itself
    expect(lichess.team.members.has("marked")).toBe(false);
    expect(revoked()).toBe(true);
    expect(updates()).toEqual([]);
  });

  it("does not connect a closed account, whose token Lichess refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await connectAs("closed")).toBe("/welcome/lichess?lichess=failed");
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", "DELETE /api/token"]);
    expect(lichess.team.members.has("closed")).toBe(false);
    expect(updates()).toEqual([]);
  });

  it("refuses an account already connected to someone else, before joining the team", async () => {
    lichess.team.members.delete("taken");
    expect(await connectAs("taken")).toBe("/welcome/lichess?lichess=taken");
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", "GET /api/user/taken", "DELETE /api/token"]);
    expect(lichess.team.members.has("taken")).toBe(false);
    expect(revoked()).toBe(true);
    expect(people.get("newcomer")?.lichessId).toBeNull();
    expect(people.get("other")?.lichessId).toBe("taken");
  });

  it("refuses an account that someone else connected in the meantime", async () => {
    query.mockImplementationOnce(async () => ({ rows: [] })); // the check runs before the other connection lands
    expect(await connectAs("taken")).toBe("/welcome/lichess?lichess=taken");
    expect(people.get("newcomer")?.lichessId).toBeNull();
    expect(revoked()).toBe(true);
  });

  it.each([
    ["as lichess.org answers it", 400],
    ["as Lichess's spec describes it", 403],
  ])("leaves the person unconnected when the team password is wrong, %s", async (_, status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    lichess.team.password = "changed";
    if (status === 403)
      lichess.override = (c) => (c.path.endsWith("/join") ? Response.json({ error: "Forbidden" }, { status }) : undefined);
    expect(await connectAs("bobby")).toBe("/welcome/lichess?lichess=team");
    expect(updates()).toEqual([]);
    expect(people.get("newcomer")?.lichessId).toBeNull();
    expect(lichess.team.members.has("bobby")).toBe(false);
    expect(revoked()).toBe(true);
  });

  it("leaves the person unconnected when Lichess fails during the join, Lichess's answer, which is not recorded", async () => {
    const settled = keepWaitUntil();
    vi.spyOn(console, "error").mockImplementation(() => {});
    lichess.override = (c) => (c.path.endsWith("/join") ? new Response("Bad gateway", { status: 502 }) : undefined);
    expect(await connectAs("bobby")).toBe("/welcome/lichess?lichess=failed");
    expect(updates()).toEqual([]);
    expect(revoked()).toBe(true);
    await settled();
    expect(failuresRecorded()).toEqual([]);
  });

  it("leaves the person unconnected when the connection cannot be saved, and records the callback's failure", async () => {
    const settled = keepWaitUntil();
    vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockImplementation(async (sql: string, params?: unknown[]) =>
      sql.includes("with saved as") ? Promise.reject(fromDatabase(new Error("Connection terminated unexpectedly"))) : fakeQuery(sql, params),
    );
    expect(await connectAs("bobby")).toBe("/welcome/lichess?lichess=failed");
    expect(revoked()).toBe(true);
    await settled();
    expect(failuresRecorded()).toEqual([["/api/lichess/callback", "route", "the database couldn't be reached"]]);
  });

  it("revokes the token when reading the account fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    lichess.override = (c) => (c.path === "/api/account" ? new Response(null, { status: 500 }) : undefined);
    expect(await connectAs("bobby")).toBe("/welcome/lichess?lichess=failed");
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", "DELETE /api/token"]);
    expect(revoked()).toBe(true);
  });

  it("gives up after 240 s of a slow Lichess, and still revokes the token within the callback's 300 s", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Each request answers 429 after 25 s, then, after the minute's wait, properly after another 25 s: 110 s a call.
    const slowed = new Set<string>();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "DELETE") return lichess.fetch(input, init);
      await new Promise((resolve, reject) => {
        setTimeout(resolve, 25_000);
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
      const key = `${request.method} ${new URL(request.url).pathname}`;
      if (!slowed.has(key)) {
        slowed.add(key);
        return new Response(null, { status: 429 });
      }
      return lichess.fetch(input, init);
    });
    const back = await approveOnLichess(await pressConnect(), "bobby");
    const started = Date.now();
    let finished = 0;
    const arrived = arrive(back).finally(() => (finished = Date.now()));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await arrived).toBe("/welcome/lichess?lichess=failed");
    expect(finished - started).toBeGreaterThanOrEqual(240_000);
    expect(finished - started).toBeLessThanOrEqual(REVOKED_BY_MS);
    // Token and account took 220 s; the marks were still being asked for at 240 s.
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", "DELETE /api/token"]);
    expect(revoked()).toBe(true);
    expect(lichess.team.members.has("bobby")).toBe(false);
    expect(updates()).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      "Connecting Lichess failed:",
      expect.objectContaining({ message: expect.stringContaining("240 s") }),
    );
  });

  it("revokes the token within 270 s of the callback's start, however long reading the session took", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const back = await approveOnLichess(await pressConnect(), "bobby");
    // Reading the session takes 20 s, as when the database has to be tried twice (lib/db.ts). Each Lichess request, its
    // revocation included, answers 429 after 25 s, then, after the minute's wait, properly after another 25 s.
    const read = getSession.getMockImplementation()!;
    getSession.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(read()), 20_000)));
    const slowed = new Set<string>();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      await new Promise((resolve, reject) => {
        setTimeout(resolve, 25_000);
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
      const key = `${request.method} ${new URL(request.url).pathname}`;
      if (!slowed.has(key)) {
        slowed.add(key);
        return new Response(null, { status: 429 });
      }
      return lichess.fetch(input, init);
    });
    const started = Date.now();
    let finished = 0;
    const arrived = arrive(back).finally(() => (finished = Date.now()));
    await vi.advanceTimersByTimeAsync(330_000);
    expect(await arrived).toBe("/welcome/lichess?lichess=failed");
    expect(finished - started).toBeGreaterThanOrEqual(260_000); // the connection gave up 240 s after the session was read
    expect(finished - started).toBeLessThanOrEqual(REVOKED_BY_MS);
  });

  it("asks nothing more of Lichess when the code is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const back = await approveOnLichess(await pressConnect(), "bobby");
    back.searchParams.set("code", "liu_wrong");
    expect(await arrive(back)).toBe("/welcome/lichess?lichess=failed");
    expect(apiCalls()).toEqual(["POST /api/token"]);
  });

  it("never stores, logs, sets or redirects with a token, whatever happens", async () => {
    const logged: unknown[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, level).mockImplementation((...args) => void logged.push(...args));
    const destinations = [await connectAs("bobby")];
    for (const id of ["closed", "taken"]) {
      people.get("newcomer")!.lichessId = null;
      destinations.push(await connectAs(id));
    }
    lichess.team.password = "changed";
    destinations.push(await connectAs("newbie"));
    lichess.override = (c) => (c.method === "DELETE" ? new Response(null, { status: 500 }) : undefined);
    destinations.push(await connectAs("newbie"));

    const tokens = [...lichess.tokens.keys()];
    expect(tokens.length).toBe(5);
    const seen = inspect([logged, query.mock.calls, jar.sets, destinations, [...people.values()]], { depth: null });
    for (const token of tokens) expect(seen).not.toContain(token);
    expect(logged.join(" ")).toMatch(/could not be revoked/); // the failed revocation is reported, without the token
  });
});

describe("swapping to a different Lichess account", () => {
  beforeEach(() => {
    signedIn = "member";
  });

  it("replaces the connection on the same person, joins the new account to the team, and shows the Profile", async () => {
    const before = { ...people.get("member")! };
    expect(await connectAs("newbie")).toBe("/profiles/member");
    const after = people.get("member")!;
    expect(after).toEqual({ ...before, lichessId: "newbie", lichessUsername: "Newbie", lichessBlitzRating: null });
    expect(people.size).toBe(4);
    expect(statements()).toEqual(["select 1", "with saved"]);
    expect(updates()[0][1][0]).toBe("member");
    expect(lichess.team.members.has("newbie")).toBe(true);
    expect(revoked()).toBe(true);
  });

  it("drops the marks the old account carried, since the new one was just found unmarked", async () => {
    Object.assign(people.get("member")!, { lichessMarked: true, lichessClosed: true });
    await connectAs("newbie");
    expect(people.get("member")).toMatchObject({ lichessId: "newbie", lichessMarked: false, lichessClosed: false });
  });

  it("keeps when the Member first connected, which is when they signed up", async () => {
    await connectAs("newbie");
    await connectAs("bobby");
    expect(people.get("member")).toMatchObject({ lichessId: "bobby", lichessConnectedAt: at });
  });

  it("keeps the old account when the new one is refused, and says why on the Profile edit page", async () => {
    expect(await connectAs("taken")).toBe("/profile?lichess=taken");
    expect(people.get("member")).toMatchObject({ lichessId: "oldie", lichessUsername: "Oldie" });
  });

  it("keeps the old account when the person declines on Lichess", async () => {
    expect(await connectAs(null)).toBe("/profile?lichess=denied");
    expect(people.get("member")?.lichessId).toBe("oldie");
  });
});
