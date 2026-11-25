// Switching to another Lichess account takes the old one out of the Club's Lichess team (#44), through the site's own
// entry points: "Switch Lichess account" on the Profile edit page, the callback Lichess sends the Member back to, what
// that callback does once the Member has been sent on, and the Organiser page. Faked: the session, the browser's cookie
// jar, the clock, the database (lib/fake-db.ts), Lichess (lib/fixtures/fake-lichess.ts, standing in for fetch), and
// Next.js's `after`, whose work is done when the test says. The Organiser's permission is connected beforehand the way
// the Organiser connects it; everything else is the app's own code.
import { randomBytes } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, db, organiserLichess, people, resetDb, teamRemovals } from "@/lib/fake-db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { finishOrganiserConnection, startOrganiserConnection } from "@/lib/organiser-lichess";
import { connectLichess } from "./actions";
import { GET as comeBackFromLichess } from "./api/lichess/callback/route";
import OrganiserPage from "./organiser/page";

const { getSession, browser, afterwards } = vi.hoisted(() => {
  // A browser's cookies for the site. Paths are ignored: only the callback ever reads this cookie.
  const newJar = () => {
    const values = new Map<string, string>();
    return {
      get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
      set: (cookie: { name: string; value: string }) => void values.set(cookie.name, cookie.value),
      delete: (cookie: { name: string }) => void values.delete(cookie.name),
    };
  };
  // `jar` is the cookies of the browser the next request comes from.
  return { getSession: vi.fn(), browser: { jar: newJar(), newJar }, afterwards: [] as (() => Promise<unknown>)[] };
});
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: () => Promise.resolve(browser.jar) }));
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
vi.mock("next/server", () => ({ after: (task: () => Promise<unknown>) => void afterwards.push(task) }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const TEAM = "offboard-team";
const KEY = randomBytes(32).toString("base64");
const NOW = new Date("2026-11-25T12:00:00Z");
const answeredAtOnce = db.query.getMockImplementation()!;

let lichess: ReturnType<typeof createFakeLichess>;
let token: string; // the Organiser's, as Lichess issued it
let signedIn: string | null;
let logged: string[];

const kicks = () => lichess.calls.filter((c) => c.path.startsWith(`/api/team/${TEAM}/kick/`)).map((c) => c.path.split("/").pop());
const inTeam = (account: string) => lichess.team.members.has(account);

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

// The Member presses "Switch Lichess account" and approves on Lichess as `account` (or declines): the callback Lichess
// sends them back to, not yet visited.
async function approveAs(account: string | null) {
  const to = new URL(await redirectedTo(() => connectLichess()));
  lichess.signedInAs = account;
  return new URL((await lichess.handle(new Request(to))).headers.get("location")!);
}

// The browser arriving back at the site: where it is sent next.
const arrive = (back: URL) => redirectedTo(() => comeBackFromLichess(new Request(back)));

const switchTo = async (account: string | null) => arrive(await approveAs(account));

// What the callbacks so far left to do once their Member had been sent on, done now.
async function afterResponses() {
  for (const task of afterwards.splice(0)) await task();
}

// The accounts the Organiser page lists to remove from the team by hand, or null when it lists none.
async function listedForOrganiser() {
  const previous = signedIn;
  signedIn = "organiser";
  const page = OrganiserPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
  const inner = page.props.children;
  const html = renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
  signedIn = previous;
  const section = html.match(/<section aria-labelledby="removals"[^>]*>(.*?)<\/section>/)?.[1];
  return section === undefined ? null : [...section.matchAll(/<h3>(.*?)<\/h3>/g)].map(([, id]) => id);
}

// The Organiser connects their Lichess account, which leads the team, as they would from the Organiser page.
async function connectOrganiser() {
  const { url, cookie } = startOrganiserConnection("organiser");
  lichess.signedInAs = "boss";
  const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
  expect(await finishOrganiserConnection({ id: "organiser" }, back.searchParams, cookie)).toBe("/organiser?lichess=connected");
  token = [...lichess.tokens].find(([, t]) => !t.revoked && t.accountId === "boss")![0];
  lichess.calls.length = 0;
}

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test secret");
  vi.stubEnv("LICHESS_TEAM_ID", TEAM);
  vi.stubEnv("LICHESS_TEAM_PASSWORD", "team password");
  vi.stubEnv("ORGANISER_USER_ID", "organiser");
  vi.stubEnv("LICHESS_TOKEN_KEY", KEY);
  const accounts = ["boss", "boss-plays", "lichess-ana", "ana-new", "ana-third", "lichess-ben"];
  lichess = createFakeLichess({ teamId: TEAM, teamPassword: "team password", accounts: accounts.map((id) => ({ id, username: id })) });
  lichess.team.leaders.add("boss");
  for (const id of ["boss", "boss-plays", "lichess-ana", "lichess-ben"]) lichess.team.members.add(id);
  vi.stubGlobal("fetch", lichess.fetch);

  resetDb();
  addPerson("organiser", { name: "Rasa Organiser", lichessId: "boss-plays" });
  addPerson("ana", { name: "Ana Petraitė" });
  addPerson("ben", { name: "Ben Kazlauskas" });
  signedIn = "ana";
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
  browser.jar = browser.newJar();
  afterwards.length = 0;
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  await connectOrganiser();
});

afterEach(() => {
  // No Lichess token ever reached the log, whatever happened.
  for (const issued of lichess.tokens.keys()) expect(logged.join("\n")).not.toContain(issued);
  db.query.mockImplementation(answeredAtOnce);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("switching to another Lichess account", () => {
  it("removes the old account from the Club's Lichess team with the Organiser's permission, once the Member has been sent on", async () => {
    expect(await switchTo("ana-new")).toBe("/profiles/ana");
    expect(people.get("ana")?.lichessId).toBe("ana-new");
    expect(inTeam("ana-new")).toBe(true);
    // The Member was sent on before Lichess was asked anything about the old account.
    expect(kicks()).toEqual([]);
    expect(inTeam("lichess-ana")).toBe(true);

    await afterResponses();
    expect(kicks()).toEqual(["lichess-ana"]);
    expect(lichess.calls.at(-1)?.authorization).toBe(`Bearer ${token}`);
    expect(inTeam("lichess-ana")).toBe(false);
    expect(inTeam("ana-new")).toBe(true);
    expect(teamRemovals.size).toBe(0);
    expect(await listedForOrganiser()).toBeNull();
  });

  // Each way removing the old account can fail, set up, and what the Organiser is told about it.
  const failures: [string, () => void, string][] = [
    ["no Organiser permission is stored at all", () => organiserLichess.clear(), "The Organiser has not connected their Lichess account on the Organiser page."],
    [
      "the permission was revoked on Lichess",
      () => void (lichess.tokens.get(token)!.revoked = true),
      "Lichess refused the Organiser's permission, which may have been revoked on Lichess; the Organiser must connect Lichess again on the Organiser page.",
    ],
    [
      "Lichess is down",
      () => void (lichess.override = (call) => (call.path.includes("/kick/") ? new Response("", { status: 503 }) : undefined)),
      "Lichess answered POST /api/team/{teamId}/kick/{userId} with 503.",
    ],
  ];

  it.each(failures)("still switches when %s, and lists the old account for the Organiser to remove by hand, with why", async (_, problem, why) => {
    problem();
    expect(await switchTo("ana-new")).toBe("/profiles/ana");
    await afterResponses();
    expect(people.get("ana")).toMatchObject({ lichessId: "ana-new", lichessUsername: "ana-new" });
    expect(inTeam("ana-new")).toBe(true);
    expect([...teamRemovals.values()]).toEqual([{ lichessId: "lichess-ana", at: NOW, problem: why }]);
    expect(await listedForOrganiser()).toEqual(["lichess-ana"]);
  });

  it("does not keep the Member waiting on a slow Lichess, and gives up on removing the old account after 25 s", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    // Lichess answers everything at once, except that it never answers the removal until it is given up.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init: RequestInit) =>
      String(input).includes("/kick/")
        ? new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))
        : lichess.fetch(input, init),
    );
    expect(await switchTo("ana-new")).toBe("/profiles/ana");
    expect(people.get("ana")?.lichessId).toBe("ana-new");
    const removing = afterResponses();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(teamRemovals.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await removing;
    expect(teamRemovals.get("lichess-ana")?.problem).toBe("Lichess took more than 25 s.");
  });

  it("gives up on Lichess at 297 s from the callback's start, however long the database took, leaving time to list the old account", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    // The database takes half a second over each statement. Lichess is rate-limiting: the marks and the join each answer
    // 429 after 25 s, then properly after the minute's wait and 25 s more, so the switch is saved at 221 s. Revoking the
    // token gets a 429 too and is given up at 295 s. The removal reads the database until 296 s, and Lichess never
    // answers it.
    db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return answeredAtOnce(sql, params);
    });
    const slowed = new Set<string>();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit) => {
      const request = new Request(input, init);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      if (key === "POST /api/token" || key === "GET /api/account") return lichess.fetch(input, init);
      await new Promise((resolve, reject) => {
        if (!key.includes("/kick/")) setTimeout(resolve, 25_000);
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      });
      if (slowed.has(key)) return lichess.fetch(input, init);
      slowed.add(key);
      return new Response(null, { status: 429 });
    });
    const back = await approveAs("ana-new");
    const started = Date.now();
    const arrived = arrive(back);
    await vi.advanceTimersByTimeAsync(295_000);
    expect(await arrived).toBe("/profiles/ana");
    expect(people.get("ana")?.lichessId).toBe("ana-new");
    const removing = afterResponses();
    // Its two reads take until 296 s, so Lichess is given the one second left before 297 s, and the account is kept,
    // in one more statement, by 297.5 s.
    await vi.advanceTimersByTimeAsync(2_499);
    expect(teamRemovals.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await removing;
    expect(teamRemovals.get("lichess-ana")?.problem).toBe("Lichess took more than 1 s.");
    expect(Date.now() - started).toBe(297_500);
  });

  it("removes nothing when the Member \"switches\" to the account they already have", async () => {
    expect(await switchTo("lichess-ana")).toBe("/profiles/ana");
    await afterResponses();
    expect(people.get("ana")?.lichessId).toBe("lichess-ana");
    expect(kicks()).toEqual([]);
    expect(inTeam("lichess-ana")).toBe(true);
    expect(teamRemovals.size).toBe(0);
  });

  it("removes nothing when the switch does not go through", async () => {
    expect(await switchTo(null)).toBe("/profile?lichess=denied");
    expect(await switchTo("lichess-ben")).toBe("/profile?lichess=taken");
    await afterResponses();
    expect(people.get("ana")?.lichessId).toBe("lichess-ana");
    expect(kicks()).toEqual([]);
    expect(inTeam("lichess-ana")).toBe(true);
  });

  it("switching back and forth leaves in the team only the account in use, even when switching back comes first", async () => {
    await switchTo("ana-new");
    await afterResponses();
    await switchTo("lichess-ana");
    await afterResponses();
    expect([inTeam("lichess-ana"), inTeam("ana-new")]).toEqual([true, false]);

    // Back to the new account, and back again, before the site gets round to removing either.
    await switchTo("ana-new");
    await switchTo("lichess-ana");
    await afterResponses();
    expect(people.get("ana")?.lichessId).toBe("lichess-ana");
    expect([inTeam("lichess-ana"), inTeam("ana-new")]).toEqual([true, false]);
    expect(teamRemovals.size).toBe(0);
  });

  it("keeps an old account that leads the team, as Lichess does while answering that all went well, and so lists nothing", async () => {
    lichess.team.leaders.add("lichess-ana");
    await switchTo("ana-new");
    await afterResponses();
    expect(kicks()).toEqual(["lichess-ana"]);
    expect(inTeam("lichess-ana")).toBe(true);
    expect(teamRemovals.size).toBe(0);
  });

  it("removes each account a switch replaced when two switches overlap", async () => {
    // ana switches to ana-new in one browser and to ana-third in another, and both come back from Lichess at once.
    const first = browser.jar;
    const toNew = await approveAs("ana-new");
    const second = (browser.jar = browser.newJar());
    const toThird = await approveAs("ana-third");
    browser.jar = first;
    const arriving = [arrive(toNew)];
    browser.jar = second;
    arriving.push(arrive(toThird));
    expect(await Promise.all(arriving)).toEqual(["/profiles/ana", "/profiles/ana"]);
    await afterResponses();
    const now = people.get("ana")!.lichessId!;
    expect(["ana-new", "ana-third"]).toContain(now);
    expect(["lichess-ana", "ana-new", "ana-third"].filter(inTeam)).toEqual([now]);
    expect(teamRemovals.size).toBe(0);
  });

  it("does not list an old account its Member has switched back to while Lichess was being asked", async () => {
    // Lichess fails the removal slowly, and meanwhile ana's switch back to her old account is saved by another of the
    // site's servers, whose requests to Lichess do not wait behind this one's.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit) => {
      if (!String(input).includes("/kick/")) return lichess.fetch(input, init);
      people.get("ana")!.lichessId = "lichess-ana";
      return new Response("", { status: 503 });
    });
    await switchTo("ana-new");
    await afterResponses();
    expect(teamRemovals.size).toBe(0);
    expect(await listedForOrganiser()).toBeNull();
  });

  it("does not remove an old account that another Member has connected since", async () => {
    await switchTo("ana-new");
    // Before the site gets round to it, ben switches to the account ana has just let go.
    signedIn = "ben";
    expect(await switchTo("lichess-ana")).toBe("/profiles/ben");
    await afterResponses();
    expect(people.get("ben")?.lichessId).toBe("lichess-ana");
    expect(kicks()).toEqual(["lichess-ben"]);
    expect(inTeam("lichess-ana")).toBe(true);
    expect(teamRemovals.size).toBe(0);
  });
});

describe("an account listed for the Organiser to remove by hand", () => {
  // ana switches while the Organiser's account may not remove members, so her old one is listed.
  beforeEach(async () => {
    lichess.team.withoutRemoving.add("boss");
    await switchTo("ana-new");
    await afterResponses();
    expect(await listedForOrganiser()).toEqual(["lichess-ana"]);
  });

  it("is no longer listed once its Member switches back to it, so that the Organiser does not remove them", async () => {
    await switchTo("lichess-ana");
    expect(await listedForOrganiser()).toBeNull();
    await afterResponses();
    // Now ana-new is the one to remove by hand.
    expect(await listedForOrganiser()).toEqual(["ana-new"]);
  });

  it("is no longer listed once another Member connects it", async () => {
    addPerson("cid", { lichessId: null, lichessUsername: null, lichessConnectedAt: null });
    signedIn = "cid";
    expect(await switchTo("lichess-ana")).toBe("/welcome/profile");
    await afterResponses();
    expect(await listedForOrganiser()).toBeNull();
    expect(teamRemovals.size).toBe(0);
  });
});
