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
import { GET as comeBackFromLichess, maxDuration } from "./api/lichess/callback/route";
import { removeFromClub, teamRemovalDone } from "./organiser/actions";
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

// The Organiser page's section `id`, as its text, or null when the page has none.
async function organiserSection(id: string) {
  const previous = signedIn;
  signedIn = "organiser";
  const page = OrganiserPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
  const inner = page.props.children;
  const html = renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
  signedIn = previous;
  return html.match(new RegExp(`<section aria-labelledby="${id}"[^>]*>(.*?)</section>`))?.[1] ?? null;
}

// The headings of the section `id`: the accounts the Organiser page lists to remove from the team by hand
// ("removals"), or the Members it names as out of the team ("rejoin"); null when it lists none.
async function listedForOrganiser(id = "removals") {
  const section = await organiserSection(id);
  return section === null ? null : [...section.matchAll(/<h3>(.*?)<\/h3>/g)].map(([, heading]) => heading);
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ").trim();

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

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

  // The database takes half a second over each statement, and `slowFirst` ms more over the removal's first, which reads
  // who has the old account; keeping that account for the Organiser waits 20 s more for a connection, as when the
  // database has to be tried twice (lib/db.ts). Lichess is rate-limiting: the marks and the join each answer 429 after
  // 25 s, then properly after the minute's wait and 25 s more, so the switch is saved at 221 s. Revoking the token gets a
  // 429 too and is given up at 270 s, when the Member is sent on. Lichess never answers the removal. Each request Lichess
  // is sent, by method and path, in `asked`.
  function slowEverything(slowFirst: number) {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const extra = sql === `select 1 from "user" where "lichessId" = $1` ? slowFirst : sql.includes(`insert into "teamRemoval"`) ? 20_000 : 0;
      await new Promise((resolve) => setTimeout(resolve, 500 + extra));
      return answeredAtOnce(sql, params);
    });
    const slowed = new Set<string>();
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit) => {
      const request = new Request(input, init);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      asked.push(key);
      if (key === "POST /api/token" || key === "GET /api/account") return lichess.fetch(input, init);
      await new Promise((resolve, reject) => {
        if (!key.includes("/kick/")) setTimeout(resolve, 25_000);
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      });
      if (slowed.has(key)) return lichess.fetch(input, init);
      slowed.add(key);
      return new Response(null, { status: 429 });
    });
    return asked;
  }

  // The switch to ana-new, and what the callback does once the Member has been sent on, begun at once, as Next.js
  // begins it: when the Member was sent on, and when all of it had ended, from the callback's start. The database
  // answers at once again after.
  async function slowSwitch() {
    const back = await approveAs("ana-new");
    const started = Date.now();
    const times = { sentOn: 0, ended: 0 };
    const switching = arrive(back).then(async (to) => {
      times.sentOn = Date.now() - started;
      await afterResponses();
      times.ended = Date.now() - started;
      return to;
    });
    await vi.advanceTimersByTimeAsync(2 * maxDuration * 1000);
    expect(await switching).toBe("/profiles/ana");
    expect(people.get("ana")?.lichessId).toBe("ana-new");
    db.query.mockImplementation(answeredAtOnce);
    return times;
  }

  it("gives up on Lichess at 275 s from the callback's start, however long the database took, leaving time to list the old account", async () => {
    const asked = slowEverything(0);
    // Its two reads take until 271 s, so Lichess is given the 4 s left before 275 s, and the account is kept, waiting
    // 20 s for its connection, by 295.5 s: inside the callback's 300 s.
    expect(await slowSwitch()).toEqual({ sentOn: 270_000, ended: 295_500 });
    expect(asked).toContain(`POST /api/team/${TEAM}/kick/lichess-ana`);
    expect(teamRemovals.get("lichess-ana")?.problem).toBe("Lichess took more than 4 s.");
    expect(await listedForOrganiser()).toEqual(["lichess-ana"]);
  });

  it("asks Lichess nothing once there is no time left for the removal, and says so plainly, still inside the callback's 300 s", async () => {
    // The removal's first read takes until 276 s, after the time for Lichess has run out at 275 s.
    const asked = slowEverything(5_500);
    expect(await slowSwitch()).toEqual({ sentOn: 270_000, ended: 297_000 });
    expect(asked.filter((key) => key.includes("/kick/"))).toEqual([]);
    expect(teamRemovals.get("lichess-ana")?.problem).toBe("There was no time left to ask Lichess.");
    expect(await listedForOrganiser()).toEqual(["lichess-ana"]);
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

  // ana switches to ana-new. Lichess is slow to remove lichess-ana, and meanwhile her switch back to it is saved by
  // another of the site's servers: it joined the team, which it was still in, and then Lichess removes it.
  async function switchBackWhileRemoving() {
    await switchTo("ana-new");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit) => {
      if (String(input).includes("/kick/lichess-ana")) people.get("ana")!.lichessId = "lichess-ana";
      return lichess.fetch(input, init);
    });
    await afterResponses();
    vi.stubGlobal("fetch", lichess.fetch);
    expect([people.get("ana")?.lichessId, inTeam("lichess-ana")]).toEqual(["lichess-ana", false]);
  }

  it("names for the Organiser a Member whose account Lichess removed just as they switched back to it, until they connect it again", async () => {
    await switchBackWhileRemoving();
    // Not listed to remove from the team, which it has left, but named, with what to do.
    expect(await listedForOrganiser()).toBeNull();
    expect(await listedForOrganiser("rejoin")).toEqual(["Ana Petraitė"]);
    expect(text((await organiserSection("rejoin"))!)).toBe(
      "Not in the Lichess team Ana Petraitė lichess-ana: Lichess removed it from the Club's team just as it was connected again. Ask Ana Petraitė to press Switch Lichess account on their Profile and choose lichess-ana again on Lichess. Done : Ana Petraitė has been asked",
    );
    // She does so, "switching" to the account she has: it is in the team again, and nobody is named.
    expect(await switchTo("lichess-ana")).toBe("/profiles/ana");
    await afterResponses();
    expect(inTeam("lichess-ana")).toBe(true);
    expect(await listedForOrganiser("rejoin")).toBeNull();
    expect(teamRemovals.size).toBe(0);
  });

  it("lets the Organiser, and nobody else, say that a Member out of the team is dealt with, which names them no more", async () => {
    await switchBackWhileRemoving();
    // As when Lichess has since marked her account, which can then never be connected again.
    const named = (await organiserSection("rejoin"))!;
    expect(named).toContain('<input type="hidden" name="lichessId" value="lichess-ana"/>');
    expect(named).toMatch(/<button[^>]*>Done<span class="visually-hidden">: Ana Petraitė has been asked<\/span><\/button>/);
    for (const who of ["ana", null]) {
      signedIn = who;
      await expect(teamRemovalDone(form({ lichessId: "lichess-ana" }))).rejects.toThrow("not found");
    }
    expect(await listedForOrganiser("rejoin")).toEqual(["Ana Petraitė"]);
    signedIn = "organiser";
    expect(await redirectedTo(() => teamRemovalDone(form({ lichessId: "lichess-ana" })))).toBe("/organiser");
    expect(await listedForOrganiser("rejoin")).toBeNull();
    expect(teamRemovals.size).toBe(0);
  });

  it("names nobody, and lists nothing to remove, once a Member out of the team switches to another account", async () => {
    await switchBackWhileRemoving();
    await switchTo("ana-third");
    await afterResponses();
    expect(["lichess-ana", "ana-third"].map(inTeam)).toEqual([false, true]);
    expect(teamRemovals.size).toBe(0);
  });

  it("names nobody, and lists nothing to remove, once a Member out of the team is removed from the Club", async () => {
    await switchBackWhileRemoving();
    signedIn = "organiser";
    expect(await redirectedTo(() => removeFromClub(form({ memberId: "ana" })))).toBe("/organiser?member=removed");
    expect(teamRemovals.size).toBe(0);
  });

  it("keeps for the Organiser the account a Member switched to while they were being removed from the Club", async () => {
    // ana is removed. While Lichess removes lichess-ana from the team, her switch to ana-new, started earlier, is saved
    // by another of the site's servers: ana-new joined the team.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit) => {
      if (String(input).includes("/kick/lichess-ana")) {
        lichess.team.members.add("ana-new");
        people.get("ana")!.lichessId = "ana-new";
      }
      return lichess.fetch(input, init);
    });
    signedIn = "organiser";
    expect(await redirectedTo(() => removeFromClub(form({ memberId: "ana" })))).toBe("/organiser?member=removed");
    expect(people.has("ana")).toBe(false);
    expect(["lichess-ana", "ana-new"].map(inTeam)).toEqual([false, true]);
    // Nobody's leaving will remove it now, so the Organiser is told to.
    expect(await listedForOrganiser()).toEqual(["ana-new"]);
    expect(teamRemovals.get("ana-new")?.problem).toBe(
      "Its owner connected it to Offboard while their account was being deleted, so the site didn't remove it from the Club's team.",
    );
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
