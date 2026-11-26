// The Organiser's three actions on the Organiser page (#16), through the site's own entry points: the page, and the
// actions behind its forms. Removing a Member, skipping a Sunday or undoing that, and setting a Season's start, with
// what each does to the tournaments already on Lichess. Faked: the session, the clock, the database (lib/fake-db.ts)
// and Lichess (lib/fixtures/fake-lichess.ts, standing in for fetch). The Organiser's permission is connected beforehand
// the way the Organiser connects it, and the upcoming Matchday's tournament is created by the scheduled job that
// creates it; everything else is the app's own code.
import { randomBytes } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPerson,
  addCompany,
  db,
  fromDatabase,
  matchdays,
  organiserLichess,
  people,
  requestFailures,
  resetDb,
  results,
  seasons,
  skippedSundays,
  teamRemovals,
  tournamentCancellations,
} from "@/lib/fake-db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";
import { collectResults } from "@/lib/collect-results";
import { createUpcomingMatchday } from "@/lib/create-matchdays";
import { LICHESS_DEADLINE_MS } from "@/lib/leaving";
import { finishOrganiserConnection, startOrganiserConnection } from "@/lib/organiser-lichess";
import { changeSunday, removeFromClub, setStart, tournamentCancelled } from "./organiser/actions";
import OrganiserPage from "./organiser/page";
import RemovePage, { generateMetadata as confirmTitle } from "./organiser/remove/page";

const { getSession, refresh, formStatus, actionState } = vi.hoisted(() => ({
  getSession: vi.fn(),
  refresh: vi.fn(),
  formStatus: { pending: false },
  actionState: { pending: false },
}));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ refresh }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));
// The forms ask React whether they are being sent; the tests say.
vi.mock("react-dom", async (original) => ({ ...(await original<typeof import("react-dom")>()), useFormStatus: () => formStatus }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useActionState: (action: unknown, initial: unknown) => {
      const [state, run] = react.useActionState(action as () => unknown, initial);
      return [state, run, actionState.pending];
    },
  };
});

const TEAM = "offboard-team";
const KEY = randomBytes(32).toString("base64");
// Season 1 starts on Sunday 29 November 2026: Matchdays on 29 November and 6, 13, 20 and 27 December and 3 January, the
// week off on 10 January, and Season 2 from 17 January. It is Wednesday 25 November, so the first Matchday is due on
// Lichess (from Monday 23 November, 20:00), and the scheduled job has created its tournament.
const FIRST = "2026-11-29";
const SECOND = "2026-12-06";
const NOW = new Date("2026-11-25T12:00:00Z");

let lichess: ReturnType<typeof createFakeLichess>;
let signedIn: string | null;
let tournament: string; // the first Matchday's, as the job created it

// The database calling `before` with each statement just before it runs, in a transaction or not: to change a row as
// another request would, or to stop() as a dropped connection does.
const fakeQuery = db.query.getMockImplementation()!;
const fakeConnect = db.connect.getMockImplementation()!;
function onStatement(before: (sql: string) => void) {
  const query = (run: (sql: string, params?: unknown[]) => Promise<unknown>) => async (sql: string, params?: unknown[]) => {
    if (!["begin", "commit", "rollback"].includes(sql)) before(sql.replace(/\s+/g, " ").trim());
    return run(sql, params);
  };
  db.query.mockImplementation(query(fakeQuery) as typeof fakeQuery);
  db.connect.mockImplementation(async () => {
    const connection = await fakeConnect();
    return { ...connection, query: query(connection.query) as typeof connection.query };
  });
}
const stop = () => {
  onStatement(() => {}); // once
  throw new Error("Connection terminated unexpectedly");
};
function restoreDatabase() {
  db.query.mockImplementation(fakeQuery);
  db.connect.mockImplementation(fakeConnect);
}

const requests = () => lichess.calls.map((c) => `${c.method} ${c.path}`);
const cancels = () => lichess.calls.filter((c) => c.path.endsWith("/terminate"));

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

// A page as its viewer gets it: each is only a <Suspense> around what reads the session.
async function render(page: ReactElement<{ children: ReactElement }>) {
  const inner = page.props.children;
  return renderToStaticMarkup((await (inner.type as (props: unknown) => Promise<ReactElement>)(inner.props)) as ReactElement);
}
const openPage = (searchParams: Record<string, string> = {}) =>
  render(OrganiserPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }));
// The step that confirms removing a Member.
const confirmPage = (searchParams: Record<string, string>) =>
  render(RemovePage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replace(/\s+/g, " ").trim();
const section = (html: string, id: string) => html.match(new RegExp(`<section aria-labelledby="${id}"[^>]*>.*?</section>`))?.[0] ?? null;
// The schedule's Sundays as listed, each as its text and its buttons.
const sundays = (html: string) => [...section(html, "schedule")!.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map(([, row]) => text(row));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const skip = (date: string) => changeSunday(null, form({ skip: date }));
const unskip = (date: string) => changeSunday(null, form({ unskip: date }));
const start = (season: string, date: string) => setStart(null, form({ season, start: date }));
const remove = (memberId: string) => redirectedTo(() => removeFromClub(form({ memberId })));

// The Organiser connects their Lichess account as they would from the Organiser page.
async function connectOrganiser(account = "boss") {
  const { url, cookie } = startOrganiserConnection("organiser");
  lichess.signedInAs = account;
  const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
  expect(await finishOrganiserConnection({ id: "organiser" }, back.searchParams, cookie)).toBe("/organiser?lichess=connected");
}
const organiserToken = () => [...lichess.tokens].find(([, t]) => !t.revoked && t.accountId === organiserLichess.get("singleton")!.lichessId)![0];

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test secret");
  vi.stubEnv("LICHESS_TEAM_ID", TEAM);
  vi.stubEnv("ORGANISER_USER_ID", "organiser");
  vi.stubEnv("LICHESS_TOKEN_KEY", KEY);
  lichess = createFakeLichess({
    teamId: TEAM,
    teamPassword: "pw",
    accounts: ["boss", "deputy", "boss-plays", "lichess-ana", "lichess-ben", "lichess-zita"].map((id) => ({ id, username: id })),
  });
  lichess.team.leaders.add("boss").add("deputy");
  for (const id of ["boss-plays", "lichess-ana", "lichess-ben", "lichess-zita"]) lichess.team.members.add(id);
  vi.stubGlobal("fetch", lichess.fetch);

  resetDb();
  addPerson("organiser", { name: "Rasa Organiser", lichessId: "boss-plays", lichessUsername: "Boss-Plays" });
  addCompany("example.com", "Pretend Robotics");
  addPerson("zita", { name: "Zita Žalgirytė", lichessUsername: "Zita-Plays", lichessId: "lichess-zita" });
  addPerson("ana", { name: "Ana Petraitė", lichessUsername: "Ana-Plays", companyDomain: "example.com" });
  addPerson("ben", { name: "Ben Kazlauskas", lichessUsername: "Ben-Plays" });
  addPerson("sandra", { name: "Šandra Šachmatė", lichessUsername: "Sandra-Plays" });
  addPerson("half", { name: "Not Yet", lichessId: null, lichessUsername: null }); // part-way through signing up
  seasons.set(1, { number: 1, start: FIRST });
  await connectOrganiser();
  await createUpcomingMatchday(NOW);
  tournament = matchdays.get(FIRST)!.lichessTournamentId!;
  lichess.calls.length = 0;

  signedIn = "organiser";
  formStatus.pending = false;
  actionState.pending = false;
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
  refresh.mockClear();
  db.query.mockClear();
  db.connect.mockClear();
});

afterEach(() => {
  restoreDatabase();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the three actions", () => {
  it.each([
    ["a Member who is not the Organiser", "ben"],
    ["a signed-out visitor", null],
  ])("are not found by %s, who changes nothing and reaches nothing on Lichess", async (_, who) => {
    signedIn = who;
    await expect(skip(FIRST)).rejects.toThrow("not found");
    await expect(unskip(FIRST)).rejects.toThrow("not found");
    await expect(start("1", SECOND)).rejects.toThrow("not found");
    await expect(removeFromClub(form({ memberId: "ana" }))).rejects.toThrow("not found");
    await expect(tournamentCancelled(form({ lichessTournamentId: tournament }))).rejects.toThrow("not found");
    expect(db.query).not.toHaveBeenCalled();
    expect(lichess.calls).toEqual([]);
    expect(people.has("ana")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("are on the Organiser's page, and the page is still not found by anyone else", async () => {
    const html = await openPage();
    for (const id of ["schedule", "remove"]) expect(section(html, id)).not.toBeNull();
    signedIn = "ben";
    await expect(openPage()).rejects.toThrow("not found");
  });
});

describe("removing a Member", () => {
  it("offers every Member but the Organiser by name, as English sorts names, with their Lichess username", async () => {
    const part = section(await openPage(), "remove")!;
    const options = [...part.matchAll(/<option value="([^"]*)"[^>]*>(.*?)<\/option>/g)].map(([, value, label]) => [value, text(label)]);
    expect(options).toEqual([
      ["", "Choose a Member"],
      ["ana", "Ana Petraitė (Ana-Plays)"],
      ["ben", "Ben Kazlauskas (Ben-Plays)"],
      ["sandra", "Šandra Šachmatė (Sandra-Plays)"],
      ["zita", "Zita Žalgirytė (Zita-Plays)"],
    ]);
    // Choosing opens the step that confirms it, and changes nothing.
    expect(part).toMatch(/<form [^>]*action="\/organiser\/remove"><div[^>]*><label for="remove-member">Member<\/label><select id="remove-member" name="member"/);
    expect(part).not.toContain("Rasa Organiser");
  });

  it("asks for confirmation first, saying who and what it does, and removes nobody", async () => {
    const html = await confirmPage({ member: "ana" });
    expect(html).toContain("<h1>Remove a Member</h1>");
    expect(text(html)).toContain("This can't be undone. Remove Ana Petraitė , Pretend Robotics, Ana-Plays on Lichess?");
    expect(text(html)).toContain("They disappear from every Leaderboard and Recap, including past ones.");
    expect(text(html)).toContain("The site asks Lichess to remove their account from the Club's team.");
    expect(text(html)).toContain("Nothing stops them signing up again.");
    // Keeping them comes first, then removing, both inside the form that removes.
    expect(html).toMatch(/<input type="hidden" name="memberId" value="ana"\/>.*<a[^>]* href="\/organiser">Keep them<\/a><button[^>]*>Remove Ana Petraitė<\/button>/);
    expect(people.has("ana")).toBe(true);
    expect(lichess.calls).toEqual([]);
  });

  it("is titled as the not-found page when the session cannot be read, and records the step's failure", async () => {
    const settled = keepWaitUntil();
    getSession.mockRejectedValue(fromDatabase(new Error("Connection terminated due to connection timeout")));
    expect(await confirmTitle()).toEqual({ title: "Page not found" });
    await settled();
    expect([...requestFailures.values()].map(({ route, kind, reason }) => ({ route, kind, reason }))).toEqual([
      { route: "/organiser/remove", kind: "page", reason: "the database couldn't be reached" },
    ]);
  });

  it("is a step nobody but the Organiser can open, and whose tab says so", async () => {
    expect(await confirmTitle()).toEqual({ title: "Remove a Member" });
    for (const who of ["ben", "half", null]) {
      signedIn = who;
      await expect(confirmPage({ member: "ana" })).rejects.toThrow("not found");
      expect(await confirmTitle()).toEqual({ title: "Page not found" });
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  it("removes nobody part-way through signing up, whom the confirmation step does not offer either", async () => {
    expect(await confirmPage({ member: "half" })).toContain("That Member isn&#x27;t in the Club.");
    expect(await remove("half")).toBe("/organiser?member=gone");
    expect(people.has("half")).toBe(true);
    expect(lichess.calls).toEqual([]);
  });

  it("while it is being done, says so, cannot be pressed again, and no longer offers to keep them", async () => {
    formStatus.pending = true;
    const html = await confirmPage({ member: "ana" });
    expect(html).toMatch(/<button[^>]* disabled="">Removing…<\/button>/);
    const keep = html.match(/<a[^>]*>Keep them<\/a>/)![0];
    expect(keep).toContain('aria-disabled="true"');
    expect(keep).toContain('tabindex="-1"');
  });

  it("has the same effect as the Member deleting their own account, and says it is done", async () => {
    results.set(`${FIRST} ana`, { matchdayDate: FIRST, userId: "ana", rank: 1, points: 3, rating: 1500, companyDomain: null });
    expect(await remove("ana")).toBe("/organiser?member=removed");
    expect(people.has("ana")).toBe(false);
    expect([...results.values()].filter((r) => r.userId === "ana")).toEqual([]);
    expect(requests()).toEqual([`POST /api/team/${TEAM}/kick/lichess-ana`]);
    expect(lichess.team.members.has("lichess-ana")).toBe(false);
    expect([...people.keys()]).toEqual(["organiser", "zita", "ben", "sandra", "half"]);
    // Said at the top of the Organiser page, where it opens.
    const html = await openPage({ member: "removed" });
    expect(html).toMatch(/^<main[^>]*><div[^>]*>.*?<\/div><p role="status"[^>]*>Member removed\.<\/p>/);
    expect(section(html, "remove")).not.toContain('value="ana"');
    // Nothing is said for any other code in the address.
    for (const member of ["toString", "constructor", "ana"]) expect(await openPage({ member })).toMatch(/^<main[^>]*><div[^>]*>.*?<\/div><section/);
  });

  it("lists their Lichess account to remove from the team by hand when Lichess refuses, as when they leave", async () => {
    lichess.team.withoutRemoving.add("boss");
    expect(await remove("ana")).toBe("/organiser?member=removed");
    expect(people.has("ana")).toBe(false);
    expect([...teamRemovals.keys()]).toEqual(["lichess-ana"]);
    expect(section(await openPage(), "removals")).toContain("<h3>lichess-ana</h3>");
  });

  it("does nothing more when the confirmation is sent again, and says they have already left", async () => {
    await remove("ana");
    lichess.calls.length = 0;
    expect(await remove("ana")).toBe("/organiser?member=gone");
    expect(lichess.calls).toEqual([]);
    expect(people.size).toBe(5);
    expect(await openPage({ member: "gone" })).toMatch(/<p role="alert"[^>]*>That Member has already left the Club\.<\/p>/);
    // Nor is a confirmation step shown for them.
    const html = await confirmPage({ member: "ana" });
    expect(html).toMatch(/<p role="alert"[^>]*>That Member isn&#x27;t in the Club\.<\/p>/);
    expect(html).not.toContain("memberId");
  });

  it("refuses to remove the Organiser, who leaves from their Profile like anyone else", async () => {
    expect(await remove("organiser")).toBe("/organiser?member=self");
    expect(people.has("organiser")).toBe(true);
    expect(organiserLichess.size).toBe(1);
    expect(lichess.calls).toEqual([]);
    for (const html of [await openPage({ member: "self" }), await confirmPage({ member: "organiser" })]) {
      expect(html).toMatch(/<p role="alert"[^>]*>You can&#x27;t remove yourself here\. To leave the Club, delete your account on Edit your Profile\.<\/p>/);
      expect(html).not.toContain("memberId");
    }
  });

  it("looks nobody up for an id no account could have", async () => {
    const long = `ana${"x".repeat(62)}`;
    expect(await remove(long)).toBe("/organiser?member=gone");
    expect(await redirectedTo(() => removeFromClub(new FormData()))).toBe("/organiser?member=gone");
    expect(await confirmPage({ member: long })).toContain("That Member isn&#x27;t in the Club.");
    expect(db.query).not.toHaveBeenCalled();
    expect(people.size).toBe(6);
  });
});

describe("the schedule on the Organiser page", () => {
  it("lists the next eight Sundays, each Matchday with a button to skip it", async () => {
    expect(sundays(await openPage())).toEqual([
      "Sunday 29 November Season 1, Matchday 1 Skip Sunday 29 November",
      "Sunday 6 December Season 1, Matchday 2 Skip Sunday 6 December",
      "Sunday 13 December Season 1, Matchday 3 Skip Sunday 13 December",
      "Sunday 20 December Season 1, Matchday 4 Skip Sunday 20 December",
      "Sunday 27 December Season 1, Matchday 5 Skip Sunday 27 December",
      "Sunday 3 January Season 1, Matchday 6 Skip Sunday 3 January",
      "Sunday 10 January No Matchday",
      "Sunday 17 January Season 2, Matchday 1 Skip Sunday 17 January",
    ]);
  });

  it("offers the next two Seasons that have not started, with when each starts now", async () => {
    const part = section(await openPage(), "schedule")!;
    expect([...part.matchAll(/<option value="(\d+)">(.*?)<\/option>/g)].map(([, n, label]) => [n, label])).toEqual([
      ["1", "Season 1, now from Sunday 29 November"],
      ["2", "Season 2, now from Sunday 17 January"],
    ]);
    expect(part).toContain('<input id="start" type="date" required="" min="2026-11-29" step="7" name="start"/>');
    expect(text(part)).toContain("Season start Later Seasons whose start isn't set move with it.");
    expect(part).toMatch(/<h3>Upcoming Sundays<\/h3><ul/);
  });

  it("offers Season 1 alone, and nothing to skip, while it is not scheduled", async () => {
    seasons.clear();
    matchdays.clear();
    const part = section(await openPage(), "schedule")!;
    expect(text(part)).toContain("No Matchday in the next 8 weeks.");
    expect([...part.matchAll(/<option value="(\d+)">(.*?)<\/option>/g)].map(([, n, label]) => [n, label])).toEqual([
      ["1", "Season 1, not scheduled yet"],
    ]);
  });

  it("while a change is being sent, holds every button and says so", async () => {
    await skip(SECOND);
    actionState.pending = true;
    const part = section(await openPage(), "schedule")!;
    const buttons = [...part.matchAll(/<button[^>]*>/g)].map(([button]) => button);
    expect(buttons).toHaveLength(8); // six to skip, one to undo, one to set a start
    for (const button of buttons) expect(button).toContain('disabled=""');
    expect(text(part)).toContain("Saving…");
  });
});

describe("skipping a Sunday", () => {
  it("marks it skipped and extends its Season by a week, saying so", async () => {
    expect(await skip(SECOND)).toEqual({ text: "Sunday 6 December is skipped, so Season 1 now ends on Sunday 10 January.", problem: false });
    expect([...skippedSundays.keys()]).toEqual([SECOND]);
    expect(refresh).toHaveBeenCalled();
    // Its tournament is not on Lichess yet, so Lichess is asked nothing, and the first Matchday keeps its own.
    expect(lichess.calls).toEqual([]);
    expect(matchdays.get(FIRST)?.lichessTournamentId).toBe(tournament);
    expect(sundays(await openPage()).slice(1, 8)).toEqual([
      "Sunday 6 December Skipped Undo skipping Sunday 6 December",
      "Sunday 13 December Season 1, Matchday 2 Skip Sunday 13 December",
      "Sunday 20 December Season 1, Matchday 3 Skip Sunday 20 December",
      "Sunday 27 December Season 1, Matchday 4 Skip Sunday 27 December",
      "Sunday 3 January Season 1, Matchday 5 Skip Sunday 3 January",
      "Sunday 10 January Season 1, Matchday 6 Skip Sunday 10 January",
      "Sunday 17 January No Matchday",
    ]);
  });

  it("cancels the tournament already created for it on Lichess, with the Organiser's permission, and forgets it", async () => {
    const said = await skip(FIRST);
    expect(said).toEqual({
      text: "Sunday 29 November is skipped, so Season 1 now ends on Sunday 10 January. The tournament for Sunday 29 November is cancelled on Lichess.",
      problem: false,
    });
    expect(requests()).toEqual([`POST /api/swiss/${tournament}/terminate`]);
    expect(cancels()[0].authorization).toBe(`Bearer ${organiserToken()}`);
    expect(lichess.tournaments.has(tournament)).toBe(false);
    expect(matchdays.has(FIRST)).toBe(false);
    expect(tournamentCancellations.size).toBe(0);
    // The next Matchday is a week later, and has no tournament yet.
    const next = text(section(await openPage(), "next")!);
    expect(next).toContain("Sunday 6 December at 20:00");
    expect(next).not.toContain("It's on Lichess");
  });

  it("leaves nothing for Collecting results to look for on that Sunday", async () => {
    await skip(FIRST);
    vi.setSystemTime(new Date("2026-11-29T19:00:00Z"));
    const run = await collectResults(new Date());
    expect(run.outcome).toBe("skipped");
    expect(run.detail.replaceAll(" ", " ")).toBe("No Matchday on Sunday 29 November.");
  });

  it("treats a tournament Lichess no longer has as cancelled", async () => {
    lichess.tournaments.delete(tournament);
    // Lichess answers so (lila's Swiss.apiTerminate: WithSwiss, then notFound).
    const asked = await lichess.handle(
      new Request(`https://fake.lichess.test/api/swiss/${tournament}/terminate`, { method: "POST", headers: { authorization: `Bearer ${organiserToken()}` } }),
    );
    expect([asked.status, await asked.json()]).toEqual([404, { error: "Not found" }]);
    lichess.calls.length = 0;
    expect((await skip(FIRST)).problem).toBe(false);
    expect(cancels()).toHaveLength(1);
    expect(matchdays.has(FIRST)).toBe(false);
    expect(tournamentCancellations.size).toBe(0);
  });

  // Each way cancelling on Lichess can fail, set up, and what the Organiser is told to do about it.
  const failures: [string, () => void | Promise<void>, string][] = [
    [
      "Lichess is down",
      () => void (lichess.override = (call) => (call.path.endsWith("/terminate") ? new Response("", { status: 503 }) : undefined)),
      "Lichess answered POST /api/swiss/{id}/terminate with 503.",
    ],
    ["Lichess cannot be reached", () => void vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed"))), "Lichess couldn't be reached."],
    [
      "the Organiser's permission has expired",
      () => void (organiserLichess.get("singleton")!.expiresAt = new Date("2026-11-24T12:00:00Z")),
      "Your Lichess permission expired on 24 November 2026. Connect Lichess again on the Organiser page.",
    ],
    [
      "the permission was revoked on Lichess",
      () => void (lichess.tokens.get(organiserToken())!.revoked = true),
      "Lichess refused your permission, which may have been revoked there. Connect Lichess again on the Organiser page.",
    ],
    [
      "the permission lacks tournament:write",
      () => void (lichess.tokens.get(organiserToken())!.scope = "team:lead"),
      "Lichess answered POST /api/swiss/{id}/terminate with 403: Missing scope: tournament:write.",
    ],
    [
      "the Organiser has since connected another account, which did not create it",
      () => connectOrganiser("deputy"),
      "Lichess answered POST /api/swiss/{id}/terminate with 401: This user cannot edit this swiss. Probably a Lichess account other than deputy created it, and only that account can cancel it.",
    ],
    ["LICHESS_TOKEN_KEY is unset", () => void vi.stubEnv("LICHESS_TOKEN_KEY", ""), "LICHESS_TOKEN_KEY isn't set, so your Lichess permission can't be read."],
  ];

  it.each(failures)("is kept when %s, and the tournament is listed to cancel by hand, with why", async (_, problem, why) => {
    await problem();
    const said = await skip(FIRST);
    expect(said).toEqual({
      text: "Sunday 29 November is skipped, so Season 1 now ends on Sunday 10 January. The site couldn't cancel the tournament for Sunday 29 November: cancel it on Lichess yourself, as listed under Cancel on Lichess.",
      problem: true,
    });
    expect([...skippedSundays.keys()]).toEqual([FIRST]);
    // Cleared all the same, so that Collecting results does not look for it, and kept for the Organiser instead.
    expect(matchdays.has(FIRST)).toBe(false);
    expect([...tournamentCancellations.values()]).toEqual([{ lichessTournamentId: tournament, date: FIRST, problem: why }]);
    const html = await openPage();
    const part = section(html, "cancellations")!;
    // Above the schedule, where the sentence says it is.
    expect(html.indexOf('aria-labelledby="cancellations"')).toBeLessThan(html.indexOf('aria-labelledby="schedule"'));
    expect(part).toContain("<h2 id=\"cancellations\">Cancel on Lichess</h2>");
    expect(text(part)).toContain(
      "The site couldn't cancel these Sundays' tournaments on Lichess. Cancel each there, signed in as the account that created it, then press Done.",
    );
    expect(part).toContain('<time dateTime="2026-11-29T18:00:00.000Z">Sunday 29 November</time>');
    expect(text(part)).toContain(why);
    expect(part).toContain(`href="https://lichess.org/swiss/${tournament}/edit"`);
    expect(part).toMatch(/<button[^>]*>Done<span class="visually-hidden">: the tournament for Sunday 29 November is cancelled<\/span><\/button>/);
  });

  it("gives up on Lichess after 25 seconds, and lists the tournament to cancel by hand", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", (_: unknown, init: RequestInit) => new Promise((__, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    const skipping = skip(FIRST);
    await vi.advanceTimersByTimeAsync(LICHESS_DEADLINE_MS - 1);
    // Kept before Lichess was asked, saying so until it answers.
    expect(tournamentCancellations.get(tournament)?.problem).toBe("The site stopped before Lichess said whether it had cancelled it.");
    await vi.advanceTimersByTimeAsync(1);
    expect((await skipping).problem).toBe(true);
    expect(tournamentCancellations.get(tournament)?.problem).toBe("Lichess took more than 25 s.");
    expect(matchdays.has(FIRST)).toBe(false);
  });

  it("forgets a tournament to cancel by hand once the Organiser says it is done, and only that one", async () => {
    tournamentCancellations.set("Another1", { lichessTournamentId: "Another1", date: "2026-11-22", problem: "kept" });
    lichess.override = (call) => (call.path.endsWith("/terminate") ? new Response("", { status: 503 }) : undefined);
    await skip(FIRST);
    // Why Lichess refused is written to that tournament's row alone.
    expect(tournamentCancellations.get("Another1")?.problem).toBe("kept");
    expect(await redirectedTo(() => tournamentCancelled(form({ lichessTournamentId: tournament })))).toBe("/organiser");
    expect([...tournamentCancellations.keys()]).toEqual(["Another1"]);
    // A value no Swiss tournament's id could be is ignored, whatever is kept.
    tournamentCancellations.set("Another12", { lichessTournamentId: "Another12", date: "2026-11-22", problem: "kept" });
    await redirectedTo(() => tournamentCancelled(form({ lichessTournamentId: "Another12" })));
    expect([...tournamentCancellations.keys()]).toEqual(["Another1", "Another12"]);
    tournamentCancellations.delete("Another12");
    await redirectedTo(() => tournamentCancelled(form({ lichessTournamentId: "Another1" })));
    expect(section(await openPage(), "cancellations")).toBeNull();
  });

  it("leaves a Matchday that changed between finding its tournament and clearing it as it now is", async () => {
    // Ingested by hand, or given another tournament, in the meantime.
    for (const change of [{ ingestedAt: new Date() }, { lichessTournamentId: "Another1" }]) {
      resetSkips();
      matchdays.set(FIRST, { date: FIRST, lichessTournamentId: tournament, ingestedAt: null });
      onStatement((sql) => void (sql.startsWith('delete from "matchday"') && Object.assign(matchdays.get(FIRST)!, change)));
      await skip(FIRST);
      expect(matchdays.get(FIRST)).toMatchObject(change);
      expect(tournamentCancellations.size).toBe(0);
      expect(cancels()).toEqual([]);
    }
  });

  it("keeps neither the skip nor the clearing of its tournament if the site stops between them", async () => {
    // The connection drops at the first statement after the skip is saved.
    let saved = false;
    onStatement((sql) => {
      if (saved) stop();
      // The skip is the statement that also queues its notice for the Telegram group (lib/seasons.ts).
      saved = sql.includes('insert into "skippedSunday"');
    });
    await expect(skip(FIRST)).rejects.toThrow("Connection terminated unexpectedly");
    expect(skippedSundays.size).toBe(0);
    expect(matchdays.get(FIRST)?.lichessTournamentId).toBe(tournament);
    expect(tournamentCancellations.size).toBe(0);
    expect(cancels()).toEqual([]);
  });

  it("loses no Sunday if the site stops once Lichess has cancelled the tournament, and the skip is undone", async () => {
    let answered = false;
    lichess.override = (call) => void (answered ||= call.path.endsWith("/terminate"));
    onStatement(() => answered && stop());
    await expect(skip(FIRST)).rejects.toThrow("Connection terminated unexpectedly");
    expect(lichess.tournaments.has(tournament)).toBe(false);
    // The Matchday no longer points at the cancelled tournament, and the Organiser page says what is not known.
    expect(matchdays.has(FIRST)).toBe(false);
    expect(text(section(await openPage(), "cancellations")!)).toContain("The site stopped before Lichess said whether it had cancelled it.");
    restoreDatabase();
    lichess.override = undefined;
    await unskip(FIRST);
    expect(tournamentCancellations.size).toBe(0);
    // So Creating Matchdays makes the Sunday a new tournament.
    expect(await createUpcomingMatchday(new Date())).toMatchObject({ outcome: "done", detail: expect.stringContaining("Created tournament") });
    const made = matchdays.get(FIRST)!.lichessTournamentId!;
    expect(made).not.toBe(tournament);
    expect(lichess.tournaments.has(made)).toBe(true);
  });

  it("leaves alone a Matchday with no tournament whose Sunday it makes the week off", async () => {
    // Season 2's first, 17 January, recorded with no tournament; skipping 6 December makes it the week off.
    matchdays.set("2027-01-17", { date: "2027-01-17", lichessTournamentId: null, ingestedAt: null });
    await skip(SECOND);
    expect(matchdays.get("2027-01-17")).toEqual({ date: "2027-01-17", lichessTournamentId: null, ingestedAt: null });
    expect(tournamentCancellations.size).toBe(0);
  });

  it("leaves alone a tournament whose Sunday has passed, even one that is not a Matchday", async () => {
    // Recorded for a Sunday before Season 1, its results never collected (the Organiser page lists it as not in).
    matchdays.set("2026-11-22", { date: "2026-11-22", lichessTournamentId: "PastOne1", ingestedAt: null });
    await skip(SECOND);
    expect(cancels()).toEqual([]);
    expect(matchdays.get("2026-11-22")?.lichessTournamentId).toBe("PastOne1");
    expect(tournamentCancellations.size).toBe(0);
  });

  it("is refused for a Sunday already skipped, which asks Lichess nothing again", async () => {
    lichess.override = (call) => (call.path.endsWith("/terminate") ? new Response("", { status: 503 }) : undefined);
    await skip(FIRST);
    lichess.calls.length = 0;
    expect(await skip(FIRST)).toEqual({ text: "Sunday 29 November is already skipped.", problem: true });
    expect(lichess.calls).toEqual([]);
    expect([...skippedSundays.keys()]).toEqual([FIRST]);
  });

  it("is refused for a Sunday with no Matchday, such as the week off", async () => {
    expect(await skip("2027-01-10")).toEqual({ text: "Sunday 10 January has no Matchday to skip.", problem: true });
    expect(skippedSundays.size).toBe(0);
  });

  it("is refused once the Matchday has started, and its tournament is left alone", async () => {
    vi.setSystemTime(new Date("2026-11-29T18:00:00Z"));
    expect(await skip(FIRST)).toEqual({ text: "It's too late to change Sunday 29 November.", problem: true });
    expect(skippedSundays.size).toBe(0);
    expect(matchdays.get(FIRST)?.lichessTournamentId).toBe(tournament);
    expect(lichess.calls).toEqual([]);
  });

  it.each([["2026-12-02"], ["2026-12-06x"], [""]])("is refused for %j, which is not a Sunday", async (date) => {
    expect(await skip(date)).toEqual({ text: "Choose a Sunday from the list.", problem: true });
    expect(await changeSunday(null, new FormData())).toEqual({ text: "Choose a Sunday from the list.", problem: true });
    expect(skippedSundays.size).toBe(0);
  });
});

// A test's skip undone behind the site's back, with the tournaments it recorded, for a test that skips twice.
function resetSkips() {
  skippedSundays.clear();
  tournamentCancellations.clear();
}

describe("undoing a skip", () => {
  it("makes the Sunday a Matchday again, and its Season a week shorter", async () => {
    await skip(SECOND);
    expect(await unskip(SECOND)).toEqual({ text: "Sunday 6 December is no longer skipped.", problem: false });
    expect(skippedSundays.size).toBe(0);
    expect(sundays(await openPage())[1]).toBe("Sunday 6 December Season 1, Matchday 2 Skip Sunday 6 December");
  });

  it("forgets its tournament to cancel by hand, which is wanted again", async () => {
    lichess.override = (call) => (call.path.endsWith("/terminate") ? new Response("", { status: 503 }) : undefined);
    await skip(FIRST);
    expect(tournamentCancellations.size).toBe(1);
    await unskip(FIRST);
    expect(tournamentCancellations.size).toBe(0);
    // The tournament is still on the team, so the job that creates Matchdays records it again rather than make another.
    lichess.override = undefined;
    await createUpcomingMatchday(new Date());
    expect(matchdays.get(FIRST)?.lichessTournamentId).toBe(tournament);
  });

  it("is refused for a Sunday that is not skipped", async () => {
    expect(await unskip(SECOND)).toEqual({ text: "Sunday 6 December isn't skipped.", problem: true });
  });

  it("is refused once the Sunday has come, which stays skipped", async () => {
    skippedSundays.set("2026-11-22", { date: "2026-11-22" });
    expect(await unskip("2026-11-22")).toEqual({ text: "It's too late to change Sunday 22 November.", problem: true });
    expect([...skippedSundays.keys()]).toEqual(["2026-11-22"]);
  });
});

describe("setting a Season's start", () => {
  it("moves its Matchdays, and the Seasons after it, saying so", async () => {
    expect(await start("2", "2027-01-24")).toEqual({ text: "Season 2 now starts on Sunday 24 January.", problem: false });
    expect(seasons.get(2)).toEqual({ number: 2, start: "2027-01-24" });
    expect(refresh).toHaveBeenCalled();
    expect(lichess.calls).toEqual([]);
    const page = await openPage();
    expect(sundays(page).at(-1)).toBe("Sunday 17 January No Matchday");
    expect(section(page, "schedule")).toContain('<option value="2">Season 2, now from Sunday 24 January</option>');
  });

  it("cancels on Lichess the tournament of a Matchday it moves", async () => {
    expect(await start("1", SECOND)).toEqual({
      text: "Season 1 now starts on Sunday 6 December. The tournament for Sunday 29 November is cancelled on Lichess.",
      problem: false,
    });
    expect(requests()).toEqual([`POST /api/swiss/${tournament}/terminate`]);
    expect(matchdays.has(FIRST)).toBe(false);
  });

  it("lists that tournament to cancel by hand when Lichess refuses, and keeps the new start", async () => {
    lichess.override = (call) => (call.path.endsWith("/terminate") ? new Response("", { status: 503 }) : undefined);
    expect((await start("1", SECOND)).problem).toBe(true);
    expect(seasons.get(1)?.start).toBe(SECOND);
    expect([...tournamentCancellations.keys()]).toEqual([tournament]);
  });

  it("leaves alone a tournament made by hand and ingested before 20:00 on a Sunday that is no Matchday", async () => {
    // Sunday 10 January, the week off, at 17:00 in Vilnius: the evening's tournament has finished and is in.
    vi.setSystemTime(new Date("2027-01-10T15:00:00Z"));
    matchdays.set("2027-01-10", { date: "2027-01-10", lichessTournamentId: "ByHand12", ingestedAt: new Date() });
    expect((await start("2", "2027-01-24")).problem).toBe(false);
    expect(cancels()).toEqual([]);
    expect(tournamentCancellations.size).toBe(0);
    expect(matchdays.get("2027-01-10")?.ingestedAt).not.toBeNull();
  });

  it("leaves alone the tournament of a Matchday that stays where it is", async () => {
    await start("2", "2027-01-24");
    expect(matchdays.get(FIRST)?.lichessTournamentId).toBe(tournament);
  });

  it("schedules Season 1 while it is not scheduled", async () => {
    seasons.clear();
    matchdays.clear();
    expect(await start("1", "2026-12-13")).toEqual({ text: "Season 1 now starts on Sunday 13 December.", problem: false });
    expect(seasons.get(1)).toEqual({ number: 1, start: "2026-12-13" });
  });

  it.each([
    ["the Season already starts then", "1", FIRST, "Season 1 already starts on Sunday 29 November."],
    ["a day that is not a Sunday", "1", "2026-12-02", "2026-12-02 isn't a Sunday."],
    ["a Sunday that has passed", "1", "2026-11-22", "It's too late to change Sunday 22 November."],
    ["a Season that runs into the next one's set start", "2", "2026-12-27", "Season 2 would start before Season 1 has finished."],
    ["no Season", "0", "2026-12-13", "Choose a Season."],
    ["a Season that cannot be", "1x", "2026-12-13", "Choose a Season."],
    ["no date", "1", "", "Choose the Sunday it starts on."],
    ["something that is not a date", "1", "next week", "Choose the Sunday it starts on."],
  ])("is refused for %s, changing nothing", async (_, season, date, why) => {
    expect(await start(season, date)).toEqual({ text: why, problem: true });
    expect([...seasons.values()]).toEqual([{ number: 1, start: FIRST }]);
    expect(lichess.calls).toEqual([]);
  });
});

describe("Creating Matchdays, after each run", () => {
  const terminated = () => cancels().map((c) => c.path.split("/")[3]);
  const failLichess = () => void (lichess.override = (call) => (call.path.endsWith("/terminate") ? new Response("", { status: 503 }) : undefined));

  it("cancels a tournament it recorded for a Sunday skipped while it was creating it", async () => {
    // The first Matchday has no tournament yet; the Organiser skips its Sunday while Lichess is making one.
    matchdays.clear();
    lichess.tournaments.clear();
    lichess.override = (call) => void (call.path.startsWith("/api/swiss/new/") && skippedSundays.set(FIRST, { date: FIRST }));
    const run = await createUpcomingMatchday(NOW);
    const made = [...lichess.calls].find((c) => c.path.startsWith("/api/swiss/new/"));
    expect(made).toBeDefined();
    expect(run.outcome).toBe("done");
    expect(run.detail).toMatch(/^Created tournament \w{8} on Lichess for the Matchday of Sunday 29 November\. The tournament for Sunday 29 November is cancelled on Lichess\.$/);
    expect(matchdays.has(FIRST)).toBe(false);
    expect(lichess.tournaments.size).toBe(0);
    expect(tournamentCancellations.size).toBe(0);
  });

  it("asks Lichess again to cancel one kept to cancel by hand, and forgets it once Lichess has", async () => {
    failLichess();
    await skip(FIRST);
    lichess.override = undefined;
    lichess.calls.length = 0;
    const run = await createUpcomingMatchday(NOW);
    expect(terminated()).toEqual([tournament]);
    expect(run).toMatchObject({ outcome: "done", detail: expect.stringMatching(/The tournament for Sunday 29 November is cancelled on Lichess\.$/) });
    expect(tournamentCancellations.size).toBe(0);
  });

  it("keeps one Lichess still will not cancel, with why, and says nothing more of it", async () => {
    failLichess();
    await skip(FIRST);
    lichess.override = undefined;
    lichess.tokens.get(organiserToken())!.revoked = true;
    lichess.calls.length = 0;
    const run = await createUpcomingMatchday(NOW);
    expect(terminated()).toEqual([tournament]);
    expect(run.detail).not.toContain("Sunday 29 November");
    expect(tournamentCancellations.get(tournament)?.problem).toMatch(/^Lichess refused your permission/);
  });

  it("leaves alone one kept for a Sunday that has passed", async () => {
    tournamentCancellations.set("PastOne1", { lichessTournamentId: "PastOne1", date: "2026-11-22", problem: "kept" });
    await createUpcomingMatchday(NOW);
    expect(cancels()).toEqual([]);
    expect(tournamentCancellations.get("PastOne1")?.problem).toBe("kept");
  });
});
