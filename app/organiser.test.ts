// The Organiser: who may open the Organiser page and connect the Organiser's Lichess permission, and how that permission
// is connected and kept, through the site's own entry points (the page, the action behind its button, and the callback
// Lichess sends the Organiser back to). Faked: the session, the browser's cookie jar, the database (lib/fake-db.ts) and
// Lichess (lib/fixtures/fake-lichess.ts, standing in for fetch). Everything else is the app's own code.
import { randomBytes } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, db, jobFailures, organiserLichess, people, resetDb } from "@/lib/fake-db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { organiserPermission, organiserToken } from "@/lib/organiser-lichess";
import { connectLichess } from "./actions";
import { GET as comeBackFromLichess } from "./api/lichess/organiser-callback/route";
import { connectOrganiserLichess } from "./organiser/actions";
import OrganiserPage from "./organiser/page";

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
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const TEAM = "offboard-team";
const KEY = randomBytes(32).toString("base64");
const COOKIE = "offboard-organiser-lichess";

let lichess: ReturnType<typeof createFakeLichess>;
let signedIn: string | null;
let logged: string[];

const apiCalls = () => lichess.calls.map((c) => `${c.method} ${c.path}`);
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
    expect(html).toContain("<h1>Organiser</h1>");
    expect(html).toContain("Lichess is not connected, so Matchdays are not being created on Lichess.");
    expect(html).toContain("<button>Connect Lichess</button>");
    expect(html).toContain("No scheduled job has failed.");
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
    expect(html).toContain('href="https://lichess.org/@/boss"');
    expect(html).toMatch(/The permission expires on <time dateTime="[^"]+">\d{1,2} \w+ \d{4}<\/time>; connect again before then\./);
    expect(html).toContain('<p role="status">Lichess is connected.');
    expect(html).toContain("<button>Connect Lichess again</button>");
    expect(html).not.toContain(token);
    expect(html).not.toContain(organiserLichess.get("singleton")!.token);
    expect(JSON.stringify(await organiserPermission())).not.toContain(organiserLichess.get("singleton")!.token);
  });

  it("says when the permission has expired", async () => {
    await connectAs("boss");
    organiserLichess.get("singleton")!.expiresAt = new Date(Date.now() - 1000);
    expect(await openPage()).toContain(", so Matchdays are not being created until you connect again.");
  });

  it("shows the last failure of a scheduled job in one line", async () => {
    jobFailures.set("1", { id: 1, job: "create-matchdays", at: new Date("2026-11-24T10:07:00Z"), matchdayDate: "2026-11-29", problem: "The Matchday of 2026-11-29 could not be created: oops." });
    expect(await openPage()).toContain("Last failure, <time");
    expect(await openPage()).toContain(": The Matchday of 2026-11-29 could not be created: oops.</p>");
  });

  it("refuses an account that does not lead the Club's team, plainly, keeping nothing", async () => {
    expect(await connectAs("player")).toBe("/organiser?lichess=leader");
    expect(apiCalls()).toEqual(["POST /api/token", "GET /api/account", `GET /api/team/${TEAM}`, "DELETE /api/token"]);
    expect(liveTokens()).toEqual([]);
    expect(organiserLichess.size).toBe(0);
    expect(await openPage({ lichess: "leader" })).toContain(
      '<p role="alert">That Lichess account is not shown as a leader of the Club&#x27;s Lichess team, so it cannot create Matchdays and has not been connected.',
    );
  });

  it("keeps nothing when the Club's team is not on Lichess", async () => {
    vi.stubEnv("LICHESS_TEAM_ID", "no-such-team");
    expect(await connectAs("boss")).toBe("/organiser?lichess=failed");
    expect(liveTokens()).toEqual([]);
    expect(organiserLichess.size).toBe(0);
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
