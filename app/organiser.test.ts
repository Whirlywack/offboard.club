// The Organiser: who may open the Organiser page and connect the Organiser's Lichess permission, and how that permission
// is connected and kept, through the site's own entry points (the page, the action behind its button, and the callback
// Lichess sends the Organiser back to). Faked: the session, the browser's cookie jar, the database (lib/fake-db.ts) and
// Lichess (lib/fixtures/fake-lichess.ts, standing in for fetch). Everything else is the app's own code.
import { randomBytes } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPerson,
  db,
  jobFailures,
  matchdays,
  organiserLichess,
  people,
  requestFailures,
  resetDb,
  scheduledJobs,
  seasons,
  teamRemovals,
  tournamentCancellations,
} from "@/lib/fake-db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";
import { REVOKED_BY_MS } from "@/lib/connect-lichess";
import { organiserPermission, organiserToken } from "@/lib/organiser-lichess";
import { connectLichess } from "./actions";
import { GET as comeBackFromLichess } from "./api/lichess/organiser-callback/route";
import { connectOrganiserLichess, testTelegram } from "./organiser/actions";
import OrganiserPage, { generateMetadata } from "./organiser/page";

const { getSession, jar } = vi.hoisted(() => {
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
  return { getSession: vi.fn(), jar };
});
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => jar }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  // As Next.js's: passes on what redirect and notFound throw, and nothing else.
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && /^(redirect |not found$)/.test(error.message)) throw error;
  },
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const TEAM = "offboard-team";
const KEY = randomBytes(32).toString("base64");
const COOKIE = "offboard-organiser-lichess";

let lichess: ReturnType<typeof createFakeLichess>;
let signedIn: string | null;
let logged: string[];

const apiCalls = () => lichess.calls.map((c) => `${c.method} ${c.path}`);
const failedRequests = () => [...requestFailures.values()].map(({ route, kind, reason }) => ({ route, kind, reason }));
const liveTokens = () => [...lichess.tokens].filter(([, t]) => !t.revoked).map(([token]) => token);
const allTokens = () => [...lichess.tokens.keys()];

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

// The Organiser page as its viewer gets it: the page is only a <Suspense> around what reads the session.
async function openPage(searchParams: Record<string, string> = {}) {
  const page = OrganiserPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });
  const inner = page.props.children;
  return renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
}

// A message the page shows as an alert, as it appears in the markup (apostrophes escaped).
const alertSaying = (text: string) =>
  new RegExp(`role="alert"[^>]*>${text.replaceAll("'", "&#x27;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

const pressConnect = async () => new URL(await redirectedTo(() => connectOrganiserLichess()));

// Lichess's approval page, approving as `as` (or declining): where it sends the browser back to.
async function approveOnLichess(at: URL, as: string | null) {
  lichess.signedInAs = as;
  return new URL((await lichess.handle(new Request(at))).headers.get("location")!);
}

const arrive = (at: URL) => redirectedTo(() => comeBackFromLichess(new Request(at)));
const connectAs = async (account: string | null) => arrive(await approveOnLichess(await pressConnect(), account));

beforeEach(() => {
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test secret");
  vi.stubEnv("LICHESS_TEAM_ID", TEAM);
  vi.stubEnv("LICHESS_TEAM_PASSWORD", "team password");
  vi.stubEnv("ORGANISER_USER_ID", "organiser");
  vi.stubEnv("LICHESS_TOKEN_KEY", KEY);
  lichess = createFakeLichess({
    teamId: TEAM,
    teamPassword: "team password",
    accounts: [
      { id: "boss", username: "Boss" },
      { id: "deputy", username: "Deputy" },
      { id: "player", username: "Player" },
    ],
  });
  lichess.team.leaders.add("boss").add("deputy");
  vi.stubGlobal("fetch", lichess.fetch);
  resetDb();
  addPerson("organiser", { lichessId: "boss-plays" });
  addPerson("member");
  addPerson("newcomer", { lichessId: null, lichessUsername: null });
  signedIn = "organiser";
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
  jar.values.clear();
  jar.sets.length = 0;
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
});

afterEach(() => {
  // No Lichess token ever reached the log, whatever happened.
  for (const token of allTokens()) expect(logged.join("\n")).not.toContain(token);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("who the Organiser is", () => {
  it("is nobody to a signed-out visitor: the page is not found, before anything is read", async () => {
    signedIn = null;
    await expect(openPage()).rejects.toThrow("not found");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is not a Member who is not the Organiser", async () => {
    signedIn = "member";
    await expect(openPage()).rejects.toThrow("not found");
    await expect(connectOrganiserLichess()).rejects.toThrow("not found");
    expect(jar.sets).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is the configured Member, who sees their page", async () => {
    const html = await openPage();
    expect(html).toMatch(/^<main id="main"/);
    expect(html).toContain("<h1>Organiser</h1>");
    expect(html).toContain("Lichess isn&#x27;t connected, so Matchdays aren&#x27;t being created on Lichess.");
    expect(html).toContain("<button>Connect Lichess</button>");
    expect(html).toContain("No job has failed.");
  });

  it("titles the tab for the Organiser alone, and as the not-found page for anyone else", async () => {
    expect(await generateMetadata()).toEqual({ title: "Organiser" });
    for (const who of ["member", "newcomer", null]) {
      signedIn = who;
      expect(await generateMetadata()).toEqual({ title: "Page not found" });
    }
  });

  it("titles the tab as the not-found page when the session cannot be read, and records the page's failure", async () => {
    const settled = keepWaitUntil();
    getSession.mockRejectedValue(new Error("Connection terminated due to connection timeout"));
    expect(await generateMetadata()).toEqual({ title: "Page not found" });
    await settled();
    expect(failedRequests()).toEqual([{ route: "/organiser", kind: "page", reason: "the database couldn't be reached" }]);
  });

  it("is nobody while ORGANISER_USER_ID is unset", async () => {
    vi.stubEnv("ORGANISER_USER_ID", "");
    await expect(openPage()).rejects.toThrow("not found");
    await expect(connectOrganiserLichess()).rejects.toThrow("not found");
  });

  it("is nobody until the configured person is a Member", async () => {
    vi.stubEnv("ORGANISER_USER_ID", "newcomer");
    signedIn = "newcomer";
    await expect(openPage()).rejects.toThrow("not found");
  });

  it("is nobody while the configured person has connected Lichess but not finished the welcome step", async () => {
    addPerson("unwelcomed", { publicDisplayConsentAt: null });
    vi.stubEnv("ORGANISER_USER_ID", "unwelcomed");
    signedIn = "unwelcomed";
    await expect(openPage()).rejects.toThrow("not found");
    await expect(connectOrganiserLichess()).rejects.toThrow("not found");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is sent back to the Organiser page, told it didn't work, when the session cannot be read at the callback", async () => {
    const back = await approveOnLichess(await pressConnect(), "boss");
    const settled = keepWaitUntil();
    getSession.mockRejectedValue(new Error("Connection terminated due to connection timeout"));
    expect(await arrive(back)).toBe("/organiser?lichess=failed");
    expect(lichess.calls).toEqual([]);
    expect(jar.values.size).toBe(0);
    expect(logged).toContain("Coming back from Lichess, the session could not be read: Connection terminated due to connection timeout");
    await settled();
    expect(failedRequests()).toEqual([{ route: "/api/lichess/organiser-callback", kind: "route", reason: "the database couldn't be reached" }]);
  });

  it("is not found at the callback by anyone else, who cannot finish an attempt there", async () => {
    const back = await approveOnLichess(await pressConnect(), "boss");
    signedIn = "member";
    await expect(arrive(back)).rejects.toThrow("not found");
    signedIn = null;
    await expect(arrive(back)).rejects.toThrow("not found");
    expect(lichess.calls).toEqual([]);
    expect(jar.values.size).toBe(0); // the attempt is cleared, so it cannot be finished later either
    expect(organiserLichess.size).toBe(0);
  });
});

describe("connecting the Organiser's Lichess account", () => {
  it("asks Lichess for permission to create tournaments and manage the team, through PKCE", async () => {
    const to = await pressConnect();
    expect(`${to.origin}${to.pathname}`).toBe("https://fake.lichess.test/oauth");
    const p = to.searchParams;
    expect(p.get("scope")).toBe("tournament:write team:lead");
    expect(p.get("client_id")).toBe("offboard.club");
    expect(p.get("redirect_uri")).toBe("https://offboard.test/api/lichess/organiser-callback");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(p.get("state")).toMatch(/^[\w-]{43}$/);
    expect(jar.sets).toEqual([
      expect.objectContaining({ name: COOKIE, httpOnly: true, sameSite: "lax", path: "/api/lichess/organiser-callback", maxAge: 600 }),
    ]);
    expect(lichess.calls).toEqual([]);
  });

  it("keeps the token of an account that leads the Club's team, encrypted, with its expiry", async () => {
    expect(await connectAs("boss")).toBe("/organiser?lichess=connected");
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", `GET /api/team/${TEAM}`]);
    expect(lichess.calls[2].authorization).toBeNull(); // the team's leaders as everyone sees them
    const [token] = liveTokens();
    expect(lichess.tokens.get(token)?.scope).toBe("tournament:write team:lead");
    const row = organiserLichess.get("singleton")!;
    expect(row).toMatchObject({ userId: "organiser", lichessId: "boss", scopes: "tournament:write team:lead" });
    expect(row.token).not.toContain(token);
    expect(row.token).toMatch(/^v1\./);
    expect(Math.abs(row.expiresAt.getTime() - (Date.now() + 31_536_000_000))).toBeLessThan(60_000);
    // Readable with the key, and only with it.
    expect(await organiserToken(new Date())).toEqual({ token, lichessId: "boss" });
    vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"));
    expect(await organiserToken(new Date())).toEqual({ problem: expect.stringContaining("cannot be read") });
    expect(jar.values.size).toBe(0);
  });

  it("shows the Organiser the account and when the permission expires, and never the token", async () => {
    await connectAs("boss");
    const [token] = liveTokens();
    const html = await openPage({ lichess: "connected" });
    expect(html).toContain('<a href="https://lichess.org/@/boss" target="_blank" rel="noopener noreferrer">boss<span class="visually-hidden"> (opens in a new tab)</span></a>');
    expect(html).toMatch(/<dt>Expires<\/dt><dd><time dateTime="[^"]+">\d{1,2} \w+ \d{4}<\/time><\/dd>/);
    expect(html).toContain("Connect again before it expires: a Lichess permission lasts a year and can&#x27;t be extended.");
    expect(html).toMatch(/<p role="status"[^>]*>Lichess is connected\./);
    expect(html).toContain("<button>Connect Lichess again</button>");
    expect(html).not.toContain(token);
    expect(html).not.toContain(organiserLichess.get("singleton")!.token);
    expect(JSON.stringify(await organiserPermission())).not.toContain(organiserLichess.get("singleton")!.token);
  });

  it("is not shown once someone else is the Organiser: it was the previous Organiser's", async () => {
    await connectAs("boss");
    vi.stubEnv("ORGANISER_USER_ID", "member");
    signedIn = "member";
    expect(await organiserPermission()).toBeNull();
    const html = await openPage();
    expect(html).toContain("Lichess isn&#x27;t connected, so Matchdays aren&#x27;t being created on Lichess.");
    expect(html).not.toContain("lichess.org/@/boss");
    expect(html).toContain("<button>Connect Lichess</button>");
  });

  it("says when the permission has expired", async () => {
    await connectAs("boss");
    organiserLichess.get("singleton")!.expiresAt = new Date(Date.now() - 1000);
    const html = await openPage();
    expect(html).toMatch(/<dt>Expired<\/dt>/);
    expect(html).toMatch(alertSaying("It has expired, so Matchdays aren't being created until you connect again."));
    expect(html).not.toContain("Connect again before it expires");
  });

  it("says only that it has expired when it has also become unreadable: an expired permission has nothing to revoke", async () => {
    await connectAs("boss");
    organiserLichess.get("singleton")!.expiresAt = new Date(Date.now() - 1000);
    vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"));
    const html = await openPage();
    expect(html).toMatch(alertSaying("It has expired"));
    expect(html).not.toContain("can&#x27;t be read");
    expect(html).not.toContain("account/security");
  });

  it("says when the stored permission cannot be read, instead of saying it is connected, and how to end it on Lichess", async () => {
    await connectAs("boss");
    vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"));
    const html = await openPage();
    expect(html).not.toContain("Connect again before it expires");
    expect(html).toMatch(/<dt>Valid until<\/dt>/);
    expect(html).toContain("can&#x27;t be read with the current LICHESS_TOKEN_KEY, so Matchdays aren&#x27;t being created.");
    expect(html).toMatch(/<div role="alert"[^>]*><p>This permission can&#x27;t be read/);
    expect(html).toContain("<li>Sign in to Lichess as boss.</li>");
    expect(html).toContain('Open <a href="https://lichess.org/account/security" target="_blank" rel="noopener noreferrer">Security');
    expect(html).toContain("revoking after you connect would revoke the new permission too.");
  });

  it("says the old permission was left valid when it could not be read at reconnecting, and keeps the new one", async () => {
    await connectAs("boss");
    const [old] = liveTokens();
    vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"));
    lichess.calls.length = 0;
    expect(await connectAs("deputy")).toBe("/organiser?lichess=stranded");
    expect(apiCalls()).not.toContain("DELETE /api/token");
    expect(liveTokens()).toContain(old); // still valid on Lichess: only the Organiser can revoke it now
    expect(await organiserToken(new Date())).toMatchObject({ lichessId: "deputy" });
    expect(await openPage({ lichess: "stranded" })).toContain("so it wasn&#x27;t revoked. It stays valid on Lichess until it expires.");
  });

  it("connects a leader Lichess shows publicly, even one without the team's permission for tournaments", async () => {
    // The site cannot see that permission; the first creation names it as the likely cause (lib/create-matchdays.test.ts).
    lichess.team.withoutTournaments.add("boss");
    expect(await connectAs("boss")).toBe("/organiser?lichess=connected");
    const html = await openPage();
    expect(html).toContain("a leader of the Club&#x27;s team with its “Tournaments” and “Remove” permissions.");
    expect(html).toContain("Managing the team is how the site removes people from it when they leave the Club.");
    expect(html).not.toContain("can be removed from the team");
  });

  it("refuses an account that does not lead the Club's team, plainly, keeping nothing", async () => {
    expect(await connectAs("player")).toBe("/organiser?lichess=leader");
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", `GET /api/team/${TEAM}`, "DELETE /api/token"]);
    expect(liveTokens()).toEqual([]);
    expect(organiserLichess.size).toBe(0);
    expect(await openPage({ lichess: "leader" })).toMatch(
      alertSaying("That Lichess account isn't shown as a leader of the Club's Lichess team, so it can't create Matchdays and hasn't been connected."),
    );
  });

  it("keeps nothing when the Club's team is not on Lichess", async () => {
    vi.stubEnv("LICHESS_TEAM_ID", "no-such-team");
    expect(await connectAs("boss")).toBe("/organiser?lichess=failed");
    expect(liveTokens()).toEqual([]);
    expect(organiserLichess.size).toBe(0);
  });

  it("records nothing when Lichess refuses what was brought back, which anyone could send at will", async () => {
    const settled = keepWaitUntil();
    const back = await approveOnLichess(await pressConnect(), "boss");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(input instanceof Request ? input.url : String(input)).pathname === "/api/token"
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : lichess.fetch(input, init),
    );
    expect(await arrive(back)).toBe("/organiser?lichess=failed");
    await settled();
    expect(failedRequests()).toEqual([]);
  });

  it("keeps nothing when the permission cannot be saved, and records the callback's failure", async () => {
    const settled = keepWaitUntil();
    const real = db.query.getMockImplementation()!;
    db.query.mockImplementation((sql: string, params?: unknown[]) =>
      sql.includes(`insert into "organiserLichess"`) ? Promise.reject(new Error("Connection terminated unexpectedly")) : real(sql, params),
    );
    expect(await connectAs("boss")).toBe("/organiser?lichess=failed");
    expect(liveTokens()).toEqual([]);
    await settled();
    expect(failedRequests()).toEqual([{ route: "/api/lichess/organiser-callback", kind: "route", reason: "the database couldn't be reached" }]);
    db.query.mockImplementation(real);
  });

  it("changes nothing when the Organiser declines on Lichess", async () => {
    expect(await connectAs(null)).toBe("/organiser?lichess=denied");
    expect(lichess.calls).toEqual([]);
    expect(organiserLichess.size).toBe(0);
  });

  it("does not start until the team and the key are configured", async () => {
    vi.stubEnv("LICHESS_TOKEN_KEY", "");
    expect(await redirectedTo(() => connectOrganiserLichess())).toBe("/organiser?lichess=unset");
    vi.stubEnv("LICHESS_TOKEN_KEY", KEY);
    vi.stubEnv("LICHESS_TEAM_ID", "");
    expect(await redirectedTo(() => connectOrganiserLichess())).toBe("/organiser?lichess=unset");
    expect(jar.sets).toEqual([]);
  });

  it.each([
    ["LICHESS_TOKEN_KEY", KEY],
    ["LICHESS_TEAM_ID", TEAM],
  ])("does not finish at the callback once %s has been unset since it started, and asks Lichess nothing", async (name, value) => {
    const back = await approveOnLichess(await pressConnect(), "boss");
    vi.stubEnv(name, "");
    expect(await arrive(back)).toBe("/organiser?lichess=unset");
    expect(lichess.calls).toEqual([]);
    expect(lichess.tokens.size).toBe(0);
    expect(organiserLichess.size).toBe(0);
    vi.stubEnv(name, value);
  });

  it("refuses an attempt not started for it: a Member's connection cannot finish as the Organiser's", async () => {
    const memberAttempt = new URL(await redirectedTo(() => connectLichess()));
    const back = await approveOnLichess(memberAttempt, "boss");
    jar.values.set(COOKIE, jar.values.get("offboard-lichess")!);
    const toOrganiser = new URL(`https://offboard.test/api/lichess/organiser-callback${back.search}`);
    expect(await arrive(toOrganiser)).toBe("/organiser?lichess=expired");
    expect(lichess.calls).toEqual([]);
  });

  it("refuses an attempt whose state does not match, or that has run out", async () => {
    const back = await approveOnLichess(await pressConnect(), "boss");
    back.searchParams.set("state", "x".repeat(43));
    expect(await arrive(back)).toBe("/organiser?lichess=expired");
    vi.useFakeTimers({ toFake: ["Date"] });
    const later = await approveOnLichess(await pressConnect(), "boss");
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    expect(await arrive(later)).toBe("/organiser?lichess=expired");
    vi.useRealTimers();
    expect(lichess.calls).toEqual([]);
  });

  it("revokes a token it does not keep within 295 s of the callback's start, however long reading the session took", async () => {
    vi.useFakeTimers();
    const back = await approveOnLichess(await pressConnect(), "boss");
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
    vi.useRealTimers();
    expect(await arrived).toBe("/organiser?lichess=failed");
    expect(finished - started).toBeGreaterThanOrEqual(260_000); // the connection gave up 240 s after the session was read
    expect(finished - started).toBeLessThanOrEqual(REVOKED_BY_MS);
    expect(organiserLichess.size).toBe(0);
  });

  it("replaces the permission when the Organiser connects again, revoking the old token", async () => {
    await connectAs("boss");
    const [first] = liveTokens();
    lichess.calls.length = 0;
    expect(await connectAs("deputy")).toBe("/organiser?lichess=connected");
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", `GET /api/team/${TEAM}`, "DELETE /api/token"]);
    expect(lichess.calls[3].authorization).toBe(`Bearer ${first}`);
    const [second] = liveTokens();
    expect(second).not.toBe(first);
    expect(organiserLichess.get("singleton")).toMatchObject({ lichessId: "deputy" });
    expect(await organiserToken(new Date())).toEqual({ token: second, lichessId: "deputy" });
  });

  it("puts no token in any address it sends the browser to", async () => {
    const to = await connectAs("boss");
    for (const token of allTokens()) expect(to).not.toContain(token);
  });
});

describe("the scheduled jobs on the Organiser page", () => {
  const SECRET = "a-cron-secret-of-forty-characters-123456";
  const ran = (minutesAgo: number, outcome: "done" | "skipped" | "failed" = "skipped", detail = "Nothing to do.", job = "create-matchdays") =>
    scheduledJobs.set(job, {
      job,
      lockedBy: null,
      lockedUntil: null,
      lastRunAt: new Date(Date.now() - minutesAgo * 60_000),
      lastOutcome: outcome,
      lastDetail: detail,
    });

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    // Backups and alerts set up, so that neither says it is off.
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_pretendstore_a-pretend-blob-token");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "a-pretend-telegram-token");
    vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", "123456789");
  });

  // Each job has its own part of the page, from its heading to the next. An hourly job is late after two hours; the
  // nightly backup after a day and two hours.
  describe.each([
    ["create-matchdays", "Creating Matchdays", "Not run yet: Vercel runs it hourly once CRON_SECRET is set.", 120, "two hours"],
    ["collect-results", "Collecting results", "Not run yet: Vercel runs it at least hourly once CRON_SECRET is set.", 120, "two hours"],
    ["post-to-telegram", "Posting to Telegram", "Not run yet: Vercel runs it hourly once CRON_SECRET is set.", 120, "two hours"],
    ["backup", "Backing up", "Not run yet: Vercel runs it every night once CRON_SECRET is set.", 26 * 60, "a day"],
    ["alert-organiser", "Alerting you", "Not run yet: Vercel runs it hourly once CRON_SECRET is set.", 120, "two hours"],
  ])("%s", (job, title, neverRun, lateAfter, late) => {
    const part = async () => {
      const html = await openPage();
      const from = html.indexOf(`<h3>${title}</h3>`);
      expect(from).toBeGreaterThan(0);
      return html.slice(from, html.indexOf("<h3>", from + 1));
    };

    it("shows how the job last went, then when it ran and why", async () => {
      ran(30, "skipped", `What ${job} did.`, job);
      const html = await part();
      expect(html).toMatch(/<dt>Last run<\/dt><dd><time dateTime="[^"]+">\d{1,2} \w+ \d{4} at \d\d:\d\d<\/time><\/dd>/);
      expect(html).toContain("<dt>Outcome</dt><dd>Nothing to do</dd>");
      // The outcome first, in the same place for every job, so that a glance down the box finds each job's.
      expect(html.indexOf("<dt>Outcome</dt>")).toBeLessThan(html.indexOf("<dt>Last run</dt>"));
      expect(html).toContain(`>What ${job} did.</p>`);
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain(SECRET);
    });

    it("flags plainly a job that has never run", async () => {
      expect(await part()).toMatch(alertSaying(neverRun));
    });

    it(`flags plainly a last run more than ${late} old, and marks its time`, async () => {
      ran(lateAfter - 1, "skipped", "Nothing to do.", job);
      let html = await part();
      expect(html).not.toContain(`for over ${late}`);
      expect(html).toMatch(/<dt>Last run<\/dt><dd><time dateTime="[^"]+">/);
      ran(lateAfter + 1, "skipped", "Nothing to do.", job);
      html = await part();
      expect(html).toMatch(
        alertSaying(`It hasn't run for over ${late}. Check that CRON_SECRET is set on Vercel and that cron jobs are enabled.`),
      );
      expect(html).toMatch(/<dt>Last run<\/dt><dd><time dateTime="[^"]+" class="[^"]+">/);
    });

    it("shows a failed last run as failed, and why in an alert", async () => {
      ran(30, "failed", "It went wrong.", job);
      const html = await part();
      expect(html).toMatch(/<dt>Outcome<\/dt><dd><span class="[^"]+">Failed<\/span><\/dd>/);
      expect(html).toMatch(alertSaying("It went wrong.</p>"));
    });
  });

  it.each([
    ["unset", "", "CRON_SECRET isn't set, so the site refuses every scheduled run."],
    ["shorter than 16 characters", "short-secret", "CRON_SECRET is shorter than 16 characters, so the site refuses every scheduled run."],
  ])("says so when CRON_SECRET is %s, without showing it", async (_, secret, line) => {
    vi.stubEnv("CRON_SECRET", secret);
    ran(30);
    const html = await openPage();
    expect(html).toMatch(alertSaying(`${line}</p>`));
    if (secret) expect(html).not.toContain(secret);
  });

  it("shows the latest failure of any scheduled job in one line: which job, from when, and why", async () => {
    jobFailures.set("1", { id: 1, job: "create-matchdays", at: new Date("2026-11-24T10:07:00Z"), matchdayDate: null, problem: "The job stopped: oops." });
    let html = await openPage();
    // A failure in words any job could use, placed by the job's name.
    expect(html).toContain("<dt>Job</dt><dd>Creating Matchdays</dd>");
    expect(html).toContain('<dt>Began</dt><dd><time dateTime="2026-11-24T10:07:00.000Z">24 November 2026 at 12:07</time></dd>');
    expect(html).toMatch(/>The job stopped: oops\.<\/p>/);
    expect(html).not.toMatch(alertSaying("The job stopped")); // history, which may be long over: not an alert
    expect(html).not.toContain("No job has failed.");
    jobFailures.set("2", { id: 2, job: "collect-results", at: new Date("2026-11-29T20:05:00Z"), matchdayDate: "2026-11-29", problem: "Couldn't collect the results of Sunday 29 November: oops." });
    html = await openPage();
    expect(html).toContain("<dt>Job</dt><dd>Collecting results</dd>");
    expect(html).toContain('<dt>Began</dt><dd><time dateTime="2026-11-29T20:05:00.000Z">29 November 2026 at 22:05</time></dd>');
    expect(html).toMatch(/>Couldn&#x27;t collect the results of Sunday 29 November: oops\.<\/p>/);
    expect(html).not.toContain("The job stopped");
  });

  it("says of the latest failure whether its job has run without failing since, for any job, the backup too", async () => {
    const lastFailure = async () => {
      const html = await openPage();
      return html.slice(html.indexOf("<h3>Last failure</h3>"));
    };
    jobFailures.set("1", { id: 1, job: "backup", at: new Date(Date.now() - 50 * 60 * 60_000), matchdayDate: null, problem: "The backup failed: oops." });
    ran(30, "failed", "The backup failed: oops.", "backup");
    let html = await lastFailure();
    expect(html).toContain("<dt>Job</dt><dd>Backing up</dd>");
    expect(html).toContain("<dt>Since</dt><dd>Still failing</dd>");
    ran(20, "done", "Backed up the database (3 kB). Each backup is kept for at least 12 days.", "backup");
    html = await lastFailure();
    expect(html).toMatch(/<dt>Since<\/dt><dd>Ran without failing on <time dateTime="[^"]+">\d{1,2} \w+ \d{4} at \d\d:\d\d<\/time><\/dd>/);
    // A job the page doesn't know any more: its name, and nothing said of since, whatever the other jobs did.
    ran(10, "done", "Created it.", "create-matchdays");
    jobFailures.set("2", { id: 2, job: "an-old-job", at: new Date(), matchdayDate: null, problem: "Gone." });
    html = await lastFailure();
    expect(html).toContain("<dt>Job</dt><dd>an-old-job</dd>");
    expect(html).not.toContain("<dt>Since</dt>");
  });

  it("shows beside the jobs the kind of request that failed last: its address's shape, its kind, when, and why", async () => {
    const lastFailedRequest = async () => {
      const html = await openPage();
      return html.slice(html.indexOf("<h3>Last failed request</h3>"), html.indexOf("</section>", html.indexOf("<h3>Last failed request</h3>")));
    };
    expect(await lastFailedRequest()).toMatch(/>No failed request has been recorded\.<\/p><\/div>$/);
    requestFailures.set("a", { route: "/profile", kind: "page", reason: "the database couldn't be reached", lastAt: new Date("2026-11-25T17:44:34Z") });
    requestFailures.set("b", { route: "/recaps/[date]", kind: "server action", reason: "the code threw TypeError", lastAt: new Date("2026-11-25T17:50:15Z") });
    const html = await lastFailedRequest();
    expect(html).toContain("<dt>Address</dt><dd>/recaps/[date]</dd>");
    expect(html).toContain("<dt>Kind</dt><dd>Server action</dd>");
    expect(html).toContain('<dt>Last failed</dt><dd><time dateTime="2026-11-25T17:50:15.000Z">25 November 2026 at 19:50</time></dd>');
    expect(html).toMatch(/>The code threw TypeError\.<\/p>/);
    expect(html).not.toMatch(/role="alert"|\/profile|No failed request/);
  });

  it("says plainly that backups aren't set up, and that alerts are off and which settings they lack, never showing one", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", "");
    const off = "Backups aren't set up: BLOB_READ_WRITE_TOKEN isn't set, so the database isn't backed up.";
    let html = await openPage();
    expect(html).toMatch(alertSaying(off));
    // Once, though the last run said the same.
    ran(30, "skipped", off, "backup");
    html = await openPage();
    expect(html.split(off.replaceAll("'", "&#x27;")).length - 1).toBe(1);
    expect(html).toMatch(
      alertSaying("Alerts are off: TELEGRAM_ORGANISER_CHAT_ID is missing or not in the form .env.example gives, so the bot can't message you."),
    );
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    html = await openPage();
    expect(html).toMatch(alertSaying("Alerts are off: TELEGRAM_BOT_TOKEN and TELEGRAM_ORGANISER_CHAT_ID are missing"));
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_pretendstore_a-pretend-blob-token");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "a-pretend-telegram-token");
    vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", "123456789");
    html = await openPage();
    expect(html).not.toContain("Backups aren't set up");
    expect(html).not.toContain("Alerts are off");
    for (const value of ["vercel_blob_rw_pretendstore_a-pretend-blob-token", "a-pretend-telegram-token", "123456789"]) expect(html).not.toContain(value);
  });
});

describe("the Organiser page as a whole", () => {
  it("has each of its parts once: the lists to act on by hand, the forms, Telegram's set-up and every scheduled job", async () => {
    seasons.set(1, { number: 1, start: "2026-12-13" });
    tournamentCancellations.set("PreTend9", { lichessTournamentId: "PreTend9", date: "2026-12-06", problem: "Lichess refused." });
    teamRemovals.set("pretend--left", { lichessId: "pretend--left", at: new Date(), problem: "Lichess refused." });
    const html = await openPage();
    const parts = ["lichess", "cancellations", "removals", "schedule", "remove", "telegram", "jobs"].map((id) => `<h2 id="${id}">`);
    const jobs = ["Creating Matchdays", "Collecting results", "Posting to Telegram", "Last failure", "Last failed request"].map((title) => `<h3>${title}</h3>`);
    for (const part of [...parts, ...jobs]) expect([part, html.split(part).length - 1]).toEqual([part, 1]);
  });
});

describe("a test message from the Organiser page", () => {
  const TOKEN = "a-pretend-telegram-token";
  const [GROUP, CHAT] = ["@pretend_group", "123456789"];
  let telegram: ReturnType<typeof createFakeTelegram>;
  const press = (to: string) => {
    const form = new FormData();
    form.set("to", to);
    return testTelegram(null, form);
  };

  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("TELEGRAM_GROUP_ID", GROUP);
    vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", CHAT);
    vi.stubEnv("TELEGRAM_URL", "");
    telegram = createFakeTelegram({ token: TOKEN, chats: [GROUP, CHAT] });
    vi.stubGlobal("fetch", telegram.fetch);
  });

  it("offers both, and says everyone in the group sees the one sent there", async () => {
    const html = await openPage();
    const section = html.slice(html.indexOf('<h2 id="telegram">'), html.indexOf("</section>", html.indexOf('<h2 id="telegram">')));
    expect(section).toMatch(/<button [^>]*value="me" name="to">Send a test message to me<\/button>/);
    expect(section).toMatch(/<button [^>]*value="group" name="to">Send a test message to the group<\/button>/);
    expect(section).toContain("Everyone in the group sees the one sent to the group.");
  });

  it("sends one message, at once, to the Organiser's own chat or to the group, and says Telegram took it", async () => {
    expect(await press("me")).toEqual({ text: "Telegram took it: check your chat with the bot.", problem: false });
    expect(await press("group")).toEqual({ text: "Telegram took it: check the group.", problem: false });
    expect(telegram.posts).toEqual([
      { chatId: CHAT, text: "A test message from Offboard: the bot's alerts reach you here." },
      { chatId: GROUP, text: "A test message from Offboard's bot: its posts reach this group." },
    ]);
  });

  it("says a token Telegram doesn't know apart from a chat it has no way into, never showing the token", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "not-the-bots-token");
    const wrong = await press("me");
    expect(wrong).toEqual({
      text: "Nothing was sent: Telegram refused it: Unauthorized. Check TELEGRAM_BOT_TOKEN: it is the whole token @BotFather gave.",
      problem: true,
    });
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("TELEGRAM_GROUP_ID", "@not_the_group");
    expect(await press("group")).toEqual({
      text: "Nothing was sent: Telegram refused it: Bad Request: chat not found. Check TELEGRAM_GROUP_ID, and that the bot is in the group.",
      problem: true,
    });
    // As Telegram answers a person the bot knows of, from the group, who has never pressed Start in its chat.
    telegram.override = () => Response.json({ ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }, { status: 403 });
    expect(await press("me")).toEqual({
      text: "Nothing was sent: Telegram refused it: Forbidden: bot can't initiate conversation with a user. Open the bot in Telegram and press Start, then check TELEGRAM_ORGANISER_CHAT_ID.",
      problem: true,
    });
    expect(JSON.stringify(wrong)).not.toContain("not-the-bots-token");
    // Each press one request, none tried again.
    expect(telegram.calls).toHaveLength(3);
  });

  it("sends nothing, and says which setting is missing, when one is", async () => {
    vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", "");
    expect(await press("me")).toEqual({ text: "TELEGRAM_ORGANISER_CHAT_ID is missing or not in the form .env.example gives, so nothing was sent.", problem: true });
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(await press("group")).toEqual({ text: "TELEGRAM_BOT_TOKEN is missing or not in the form .env.example gives, so nothing was sent.", problem: true });
    vi.stubEnv("TELEGRAM_GROUP_ID", "");
    expect(await press("group")).toEqual({
      text: "TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID are missing or not in the form .env.example gives, so nothing was sent.",
      problem: true,
    });
    expect(telegram.calls).toEqual([]);
  });

  it("is not found by anyone but the Organiser, and sends nothing", async () => {
    signedIn = "member";
    await expect(press("group")).rejects.toThrow("not found");
    signedIn = null;
    await expect(press("me")).rejects.toThrow("not found");
    expect(telegram.calls).toEqual([]);
  });
});

describe("Telegram on the Organiser page", () => {
  const telegram = async () => {
    const html = await openPage();
    const from = html.indexOf('<h2 id="telegram">');
    expect(from).toBeGreaterThan(0);
    return html.slice(from, html.indexOf("</section>", from));
  };
  const set = { TELEGRAM_BOT_TOKEN: "a-pretend-telegram-token", TELEGRAM_GROUP_ID: "@pretend_group", TELEGRAM_INVITE_LINK: "https://t.me/+a-pretend" };

  it.each([
    [
      "none of its settings",
      { TELEGRAM_BOT_TOKEN: "", TELEGRAM_GROUP_ID: "", TELEGRAM_INVITE_LINK: "" },
      "Telegram isn't set up: TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_ID and TELEGRAM_INVITE_LINK are missing or not in the form .env.example gives, so the bot posts nothing and Members aren't shown the group's invite link.",
    ],
    [
      "no group",
      { ...set, TELEGRAM_GROUP_ID: "" },
      "Telegram isn't set up: TELEGRAM_GROUP_ID is missing or not in the form .env.example gives, so the bot posts nothing.",
    ],
    [
      "an invite link that is not one",
      { ...set, TELEGRAM_INVITE_LINK: "https://example.com/join" },
      "Telegram isn't set up: TELEGRAM_INVITE_LINK is missing or not in the form .env.example gives, so Members aren't shown the group's invite link.",
    ],
  ])("says plainly what is off, and which settings are missing, with %s", async (_, settings, line) => {
    for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
    const html = await telegram();
    expect(html).toMatch(alertSaying(line));
    if (settings.TELEGRAM_BOT_TOKEN) expect(html).not.toContain(settings.TELEGRAM_BOT_TOKEN);
  });

  it("says what the bot does once every setting is in place, and shows none of them", async () => {
    for (const [name, value] of Object.entries(set)) vi.stubEnv(name, value);
    const html = await telegram();
    expect(html).toContain("The bot posts reminders, Recaps and notices to the group");
    expect(html).not.toContain('role="alert"');
    for (const value of Object.values(set)) expect(html).not.toContain(value);
  });
});

describe("the Matchdays whose results are not in, on the Organiser page", () => {
  // Sunday 29 November, 21:30 in Vilnius: that Sunday's Matchday has started.
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-29T19:30:00Z") }));
  afterEach(() => vi.useRealTimers());

  const played = (date: string, tournament: string | null, ingested = false) =>
    matchdays.set(date, { date, lichessTournamentId: tournament, ingestedAt: ingested ? new Date() : null });
  // The part of the page that lists them, or null when there is none.
  const part = async () => {
    const html = await openPage();
    const from = html.indexOf("<h3>Results not in</h3>");
    return from < 0 ? null : html.slice(from, html.indexOf("<h3>", from + 1));
  };
  const items = (html: string | null) =>
    [...(html ?? "").matchAll(/<li>(.*?)<\/li>/g)].map(([, item]) => item.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'"));

  it("lists those of the last eight Sundays that have started, latest first, each with its date and what to do", async () => {
    played("2026-12-06", "NextWeek"); // not started
    played("2026-11-29", "Tonight1"); // being played, or just over: runs still look after it
    played("2026-11-22", "Recapped", true); // its results are in
    played("2026-11-15", null); // no tournament recorded
    played("2026-11-08", "LeftOut1"); // runs have left it
    played("2026-10-11", "EightWk1"); // the eighth Sunday, counting this one
    played("2026-10-04", "NineWks1"); // the ninth: too long ago
    expect(items(await part())).toEqual([
      "Sunday 29 November Collecting results checks it until Sunday 6 December at 20:00.",
      "Sunday 8 November No longer checked. If Lichess still has its tournament, run pnpm ingest LeftOut1.",
      "Sunday 11 October No longer checked. If Lichess still has its tournament, run pnpm ingest EightWk1.",
    ]);
  });

  it("lists a Matchday whose tournament Lichess deleted too, which only Lichess can tell", async () => {
    played("2026-11-22", "Deleted1");
    expect(items(await part())).toEqual(["Sunday 22 November No longer checked. If Lichess still has its tournament, run pnpm ingest Deleted1."]);
  });

  it("shows nothing when every Matchday played has its results", async () => {
    played("2026-11-29", "Tonight1", true);
    played("2026-11-15", null);
    expect(await part()).toBeNull();
    expect(await openPage()).not.toContain("Results not in");
  });
});

describe("the next Matchday on the Organiser page", () => {
  const DATE = "2026-11-29"; // a Sunday; 20:00 Vilnius time is 18:00Z, and it is due six days earlier, Monday 23 November
  const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
  const panel = async () => {
    const html = await openPage();
    return html.slice(html.indexOf('aria-labelledby="next"'), html.indexOf('aria-labelledby="lichess"'));
  };

  // Nothing stops a run from creating it unless a test says so: Lichess is connected and CRON_SECRET is good.
  beforeEach(async () => {
    seasons.set(1, { number: 1, start: DATE });
    vi.stubEnv("CRON_SECRET", "a-cron-secret-of-forty-characters-123456");
    await connectAs("boss");
  });
  afterEach(() => vi.useRealTimers());

  it("says when Season 1 will be scheduled, while it is not", async () => {
    seasons.clear();
    const html = await panel();
    expect(html).toContain("Not scheduled yet");
    expect(html).toContain("Season 1 is scheduled once sixteen Members have joined.");
  });

  it("says when it will be created, before it is due", async () => {
    at("2026-11-20T12:00:00Z");
    const html = await panel();
    expect(html).toContain('<time dateTime="2026-11-29T18:00:00.000Z">Sunday 29 November at 20:00</time>');
    expect(html).toContain('The site creates it on Lichess on <time dateTime="2026-11-23T18:00:00.000Z">Monday 23 November</time>, six days ahead.');
    expect(html).not.toContain('role="alert"');
  });

  it("says it is due for the first two hours, then flags it plainly", async () => {
    at("2026-11-23T19:59:00Z");
    expect(await panel()).toContain("It&#x27;s due on Lichess now. The next hourly run should create it.");
    at("2026-11-23T20:01:00Z");
    expect(await panel()).toMatch(alertSaying("It should be on Lichess by now, but isn't. Check the scheduled jobs below."));
  });

  it("promises no creation while nothing is connected, but names the day it is due", async () => {
    organiserLichess.clear();
    at("2026-11-20T12:00:00Z");
    const html = await panel();
    expect(html).toMatch(/<p role="alert"[^>]*>The site should create it on Lichess on <time dateTime="2026-11-23T18:00:00.000Z">Monday 23 November<\/time>, but can&#x27;t until the problem below is fixed\.<\/p>/);
    expect(html).not.toContain("The site creates it on Lichess on");
  });

  it.each([
    ["the permission has expired", () => void (organiserLichess.get("singleton")!.expiresAt = new Date("2026-11-22T00:00:00Z"))],
    ["the permission cannot be read", () => vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"))],
    ["CRON_SECRET is refused", () => vi.stubEnv("CRON_SECRET", "short-secret")],
  ])("promises no creation once it is due while %s", async (_, problem) => {
    problem();
    at("2026-11-23T19:00:00Z");
    const html = await panel();
    expect(html).toMatch(alertSaying("It's due on Lichess now, but the site can't create it until the problem below is fixed."));
    expect(html).not.toContain("The next hourly run should create it.");
  });

  it("counts both problems when nothing is connected and CRON_SECRET is unset", async () => {
    organiserLichess.clear();
    vi.stubEnv("CRON_SECRET", "");
    at("2026-11-24T12:00:00Z");
    expect(await panel()).toMatch(alertSaying("It's due on Lichess now, but the site can't create it until the problems below are fixed."));
  });

  it("moves on to the next Matchday once one starts, while Members can still join that one from the home page", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    at("2026-11-29T18:05:00Z");
    const html = await panel();
    expect(html).toContain('<time dateTime="2026-12-06T18:00:00.000Z">Sunday 6 December at 20:00</time>');
    expect(html).not.toContain("AbCd1234");
  });

  it("links it on Lichess once it is there", async () => {
    at("2026-11-25T12:00:00Z");
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    const html = await panel();
    expect(html).toContain("It&#x27;s on Lichess, and Members can join it from the home page.");
    expect(html).toContain('<a href="https://lichess.org/swiss/AbCd1234" target="_blank" rel="noopener noreferrer">Open it on Lichess');
    expect(html).not.toContain('role="alert"');
  });
});
