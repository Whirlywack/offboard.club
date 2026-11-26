// Leaving the Club, through the site's own entry points: the Profile edit page and the confirmation page, the action
// behind its button, and removeMember, the same removal for any Member the system names; the same deletion for someone
// part-way through signing up, from the welcome steps (#43); then the pages someone who left was on. Faked: the
// session, the clock, the database (lib/fake-db.ts) and Lichess (lib/fixtures/fake-lichess.ts, standing in for fetch).
// The Organiser's permission is connected beforehand the way the Organiser connects it; everything else is the app's
// own code.
import { randomBytes } from "node:crypto";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, db, games, jobFailures, matchdays, organiserLichess, people, resetDb, results, seasons, teamRemovals, type GameRow } from "@/lib/fake-db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { LEAVING_LICHESS_BY_MS, LICHESS_DEADLINE_MS, removeMember } from "@/lib/leaving";
import { finishOrganiserConnection, startOrganiserConnection } from "@/lib/organiser-lichess";
import { countSignUps } from "@/lib/signups";
import { deleteSignUp, leaveClub } from "./actions";
import AllTimePage from "./all-time/page";
import LeftPage from "./left/page";
import { teamRemovalDone } from "./organiser/actions";
import OrganiserPage from "./organiser/page";
import LeavePage, { maxDuration } from "./profile/leave/page";
import EditProfile from "./profile/page";
import ProfilePage from "./profiles/[id]/page";
import RecapPage from "./recaps/[date]/page";
import SeasonPage from "./seasons/[number]/page";
import DeleteAccountPage from "./welcome/leave/page";
import ConnectStep from "./welcome/lichess/page";
import Welcome from "./welcome/page";

const { getSession, signOut, formStatus } = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn(), formStatus: { pending: false } }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession, signOut } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "the browser's session cookie" }) }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));
// The confirmation page's buttons ask React whether their form is being sent; the tests say.
vi.mock("react-dom", async (original) => ({ ...(await original<typeof import("react-dom")>()), useFormStatus: () => formStatus }));

const TEAM = "offboard-team";
const KEY = randomBytes(32).toString("base64");
// Season 1 started on Sunday 1 November 2026; two of its Matchdays have been played.
const FIRST = "2026-11-01";
const SECOND = "2026-11-08";
const NOW = new Date("2026-11-10T12:00:00Z");

let lichess: ReturnType<typeof createFakeLichess>;
let token: string; // the Organiser's, as Lichess issued it
let signedIn: string | null;
let logged: string[];

const requests = () => lichess.calls.map((c) => `${c.method} ${c.path}`);
const kicks = () => lichess.calls.filter((c) => c.path.startsWith(`/api/team/${TEAM}/kick/`));

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

// What a page streams in after its static shell: the element inside one of its <Suspense>s, rendered.
async function streamed(suspense: ReactElement) {
  const inner = (suspense.props as { children: ReactElement }).children;
  return renderToStaticMarkup((await (inner.type as (props: unknown) => Promise<ReactNode>)(inner.props)) as ReactElement);
}
// The page's child at `at`, which is its <Suspense>.
const child = (page: ReactElement, at: number) => [(page.props as { children: ReactElement | ReactElement[] }).children].flat()[at];
const none = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

const editPage = () => streamed(child(EditProfile(none), 1));
const leavePage = () => streamed(child(LeavePage(), 1));
const recap = (date: string) => streamed(child(RecapPage({ ...none, params: Promise.resolve({ date }) }), 0));
const season = () => streamed(child(SeasonPage({ ...none, params: Promise.resolve({ number: "1" }) }), 0));
const allTime = () => streamed(child(AllTimePage(), 1));
const profile = (id: string) => streamed(child(ProfilePage({ ...none, params: Promise.resolve({ id }) }), 0));
const organiserPage = () => streamed(OrganiserPage(none)); // the page is its <Suspense>

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ");
// A Leaderboard's rows as text, cell by cell.
const rows = (html: string) =>
  [...html.matchAll(/<tr>(.*?)<\/tr>/g)].slice(1).map(([, row]) => [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map(([, cell]) => text(cell).trim()));
// A Profile's Games as listed.
const gamesListed = (html: string) => [...html.matchAll(/<li(?: id="more")?><p>(.*?)<\/p>/g)].map(([, row]) => text(row).trim());

// A Matchday as ingestion leaves it: the Members' results in Lichess's order.
function ingested(date: string, order: [userId: string, points: number][]) {
  matchdays.set(date, { date, lichessTournamentId: `T${date.replaceAll("-", "").slice(1)}`, ingestedAt: new Date() });
  order.forEach(([userId, points], i) =>
    results.set(`${date} ${userId}`, { matchdayDate: date, userId, rank: i + 1, points, rating: 1500, companyDomain: null }),
  );
}

let minute = 0;
function played(id: string, date: string, whiteId: string, blackId: string, winner: GameRow["winner"], more: Partial<GameRow> = {}) {
  games.set(id, {
    lichessGameId: id,
    matchdayDate: date,
    whiteId,
    blackId,
    winner,
    status: winner ? "resign" : "draw",
    plies: 60,
    whiteRating: 1500,
    blackRating: 1500,
    winnerClockCentis: winner ? 60_000 : null,
    finishedAt: new Date(Date.parse(`${date}T18:00:00Z`) + ++minute * 60_000),
    ...more,
  });
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
  vi.stubEnv("ORGANISER_USER_ID", "organiser");
  vi.stubEnv("LICHESS_TOKEN_KEY", KEY);
  lichess = createFakeLichess({
    teamId: TEAM,
    teamPassword: "pw",
    accounts: ["boss", "boss-plays", "lichess-ana", "lichess-ben", "lichess-cid"].map((id) => ({ id, username: id })),
  });
  lichess.team.leaders.add("boss");
  for (const id of ["boss", "boss-plays", "lichess-ana", "lichess-ben", "lichess-cid"]) lichess.team.members.add(id);
  vi.stubGlobal("fetch", lichess.fetch);

  resetDb();
  // The Organiser plays with another Lichess account than the one that leads the team.
  addPerson("organiser", { name: "Rasa Organiser", lichessId: "boss-plays" });
  addPerson("ana", { name: "Ana Petraitė", position: "CTO", openTo: "coffee" });
  addPerson("ben", { name: "Ben Kazlauskas" });
  addPerson("cid", { name: "Cidas Jonaitis" });
  addPerson("half", { name: "Not Yet", lichessId: null, lichessUsername: null }); // part-way through signing up
  seasons.set(1, { number: 1, start: FIRST });
  ingested(FIRST, [["ana", 2], ["ben", 1], ["cid", 1]]);
  ingested(SECOND, [["cid", 3], ["ana", 2], ["ben", 1]]);
  minute = 0;
  // The first Matchday's Awards: ana's upset over ben, cid's closest call over ben, and ben's mate of ana.
  played("ANABEATS", FIRST, "ana", "ben", "white", { whiteRating: 1400, blackRating: 1600, winnerClockCentis: 30_000 });
  played("BENMATES", FIRST, "ben", "ana", "white", { status: "mate", plies: 15, winnerClockCentis: 50_000 });
  played("CIDWINS1", FIRST, "cid", "ben", "white", { whiteRating: 1500, blackRating: 1550, winnerClockCentis: 20_000 });
  played("CIDANA08", SECOND, "cid", "ana", "white");
  played("BENCID08", SECOND, "ben", "cid", null);

  signedIn = "ana";
  formStatus.pending = false;
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
  signOut.mockReset().mockImplementation(async () => void (signedIn = null));
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  await connectOrganiser();
  db.query.mockClear();
  db.connect.mockClear();
});

afterEach(() => {
  // No Lichess token ever reached the log, whatever happened.
  for (const issued of lichess.tokens.keys()) expect(logged.join("\n")).not.toContain(issued);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deleting your own account", () => {
  it("is offered on the Profile edit page, which leads to a confirmation step and deletes nothing", async () => {
    const edit = await editPage();
    expect(edit).toMatch(/<h2 id="leave">Leave the Club<\/h2><div[^>]*><a[^>]* href="\/profile\/leave">Delete your account<\/a>/);
    // The rest of the page, in the words of the signing-up deck (#74).
    expect(renderToStaticMarkup(EditProfile(none))).toMatch(
      />Other Members see your name and photo from LinkedIn, plus anything you add here\.<\/p>/,
    );
    expect(text(edit)).toContain(
      "The website of the company you work for. Its name, taken from the site, shows with your name on Leaderboards and in Recaps. Freelance or between jobs? Leave it empty.",
    );
    expect(text(edit)).toContain("Position Up to 80 characters.");
    expect(edit).not.toContain("linkedInUrl-hint");
    expect(text(edit)).toContain(
      "To play with a different account, sign in to Lichess with it first, then switch here. Your results and Games stay with you.",
    );
    const confirm = await leavePage();
    // Keeping the account comes first, then deleting it, both inside the form that deletes.
    expect(confirm).toMatch(/<form[^>]*>.*<a[^>]* href="\/profile">Keep my account<\/a><button[^>]*>Delete my account<\/button><\/div><\/form>/);
    expect(confirm).not.toMatch(/aria-disabled|disabled=""/);
    expect(text(confirm)).toContain("You disappear from every Leaderboard and Recap, including past ones.");
    expect(text(confirm)).toContain("Other Members keep their Games against you, with you shown as “a former member”.");
    expect(text(confirm)).toContain("Your Lichess account is disconnected, and the site asks Lichess to remove it from the Club's team.");
    expect(text(confirm)).toContain("If the site can't remove you from the team, your Lichess username is kept until the Organiser does.");
    expect(text(confirm)).not.toContain("Nothing changes on Lichess");
    expect(people.has("ana")).toBe(true);
    expect(lichess.calls).toEqual([]);
  });

  it("is confirmed only by a Member: anyone else is sent away from the confirmation step", async () => {
    signedIn = null;
    await expect(leavePage()).rejects.toThrow(/^redirect \/$/);
    signedIn = "half";
    await expect(leavePage()).rejects.toThrow(/^redirect \/welcome\/lichess$/);
  });

  it("warns the Organiser alone that their Lichess permission goes too", async () => {
    expect(text(await leavePage())).not.toContain("You're the Organiser");
    signedIn = "organiser";
    expect(text(await leavePage())).toContain(
      "You're the Organiser. Once you leave, Matchdays stop being created and nobody is removed from the Lichess team until someone else is made Organiser.",
    );
  });

  it("while the account is being deleted, says so, cannot be pressed again, and no longer offers to keep it", async () => {
    formStatus.pending = true;
    const confirm = await leavePage();
    expect(confirm).toMatch(/<button[^>]* disabled="">Deleting…<\/button>/);
    const keep = confirm.match(/<a[^>]*>Keep my account<\/a>/)![0];
    expect(keep).toContain('aria-disabled="true"');
    expect(keep).toContain('tabindex="-1"');
  });

  it("deletes the caller's account at the press of the button, signs them out and says so", async () => {
    expect(await redirectedTo(() => leaveClub())).toBe("/left");
    expect(people.has("ana")).toBe(false);
    expect([...results.values()].filter((r) => r.userId === "ana")).toEqual([]);
    expect(signOut).toHaveBeenCalledWith({ headers: new Headers({ cookie: "the browser's session cookie" }) });
    // Everyone else is as they were.
    expect([...people.keys()]).toEqual(["organiser", "ben", "cid", "half"]);
    expect(await countSignUps()).toBe(3);
    const left = renderToStaticMarkup(LeftPage());
    // The page reads nothing, so it says only what is true for anyone who opens it.
    expect(left).toContain("<h1>After you leave the Club</h1>");
    expect(text(left)).toContain("If you've just deleted your account, it's gone and you're signed out.");
  });

  it("refuses a signed-out caller and one part-way through signing up, deleting nothing", async () => {
    signedIn = null;
    expect(await redirectedTo(() => leaveClub())).toBe("/");
    signedIn = "half";
    expect(await redirectedTo(() => leaveClub())).toBe("/welcome/lichess");
    expect(db.query).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
    expect(people.size).toBe(5);
    expect(lichess.calls).toEqual([]);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("deleting your account part-way through signing up", () => {
  // "half" has agreed but not connected Lichess; "new" has not agreed yet.
  beforeEach(() => void addPerson("new", { name: "Not Agreed", publicDisplayConsentAt: null, houseRulesAcceptedAt: null, lichessId: null, lichessUsername: null }));

  const welcomeStep = () => streamed(child(Welcome(), 1));
  const connectStep = () => streamed(child(ConnectStep(none), 2));
  const confirmPage = () => streamed(child(DeleteAccountPage(), 1));

  it.each([
    ["new", welcomeStep, "/welcome"],
    ["half", connectStep, "/welcome/lichess"],
  ] as const)("is offered to %s on the step they are on, which leads to a confirmation step and deletes nothing", async (who, step, back) => {
    signedIn = who;
    expect(await step()).toContain('<a href="/welcome/leave">Delete your account</a>');
    const confirm = await confirmPage();
    // The Member's choice, keeping first, which goes back to the step they are on.
    expect(confirm).toMatch(new RegExp(`<form[^>]*>.*<a[^>]* href="${back}">Keep my account</a><button[^>]*>Delete my account</button></div></form>`));
    expect(text(confirm)).toContain("Your name, photo, email address and anything you've agreed to will be deleted.");
    // Nothing a Member would lose, as they have none of it.
    for (const untrue of ["Profile", "Leaderboard", "Recap", "Lichess", "Games", "Organiser"]) expect(text(confirm)).not.toContain(untrue);
    // Its button deletes through the action for someone part-way, which a Member's page does not use.
    const inner = (child(DeleteAccountPage(), 1).props as { children: ReactElement }).children;
    const form = (await (inner.type as (props: unknown) => Promise<ReactElement>)(inner.props)) as ReactElement<{ action: unknown }>;
    expect(form.props.action).toBe(deleteSignUp);
    expect(people.has(who)).toBe(true);
    expect(lichess.calls).toEqual([]);
  });

  it("is confirmed only by someone part-way: a signed-out visitor goes home, and a Member to their own confirmation step", async () => {
    signedIn = null;
    await expect(confirmPage()).rejects.toThrow(/^redirect \/$/);
    signedIn = "ana";
    await expect(confirmPage()).rejects.toThrow(/^redirect \/profile\/leave$/);
    signedIn = "organiser";
    await expect(confirmPage()).rejects.toThrow(/^redirect \/profile\/leave$/);
  });

  it.each(["new", "half"])("deletes %s at the press of the button, signs them out, and asks nothing of Lichess", async (who) => {
    signedIn = who;
    expect(await redirectedTo(() => deleteSignUp())).toBe("/left");
    expect(people.has(who)).toBe(false);
    expect(signOut).toHaveBeenCalledWith({ headers: new Headers({ cookie: "the browser's session cookie" }) });
    expect(lichess.calls).toEqual([]);
    expect(teamRemovals.size).toBe(0);
    // Everyone else is as they were.
    expect([...people.keys()].sort()).toEqual(["ana", "ben", "cid", "half", "new", "organiser"].filter((id) => id !== who));
  });

  it("deletes the caller's own account whatever is posted with it", async () => {
    signedIn = "half";
    const form = new FormData();
    for (const name of ["id", "userId", "memberId"]) form.set(name, "ana");
    await redirectedTo(() => (deleteSignUp as (form: FormData) => Promise<void>)(form));
    expect(people.has("half")).toBe(false);
    expect(people.has("ana")).toBe(true);
    expect(lichess.calls).toEqual([]);
  });

  it("refuses a signed-out caller, deleting nothing", async () => {
    signedIn = null;
    expect(await redirectedTo(() => deleteSignUp())).toBe("/");
    expect(db.query).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("deletes nothing of someone who has become a Member since the page was shown, and sends them to their own", async () => {
    // "half" connects Lichess in another tab, then presses the button on the page shown before.
    Object.assign(people.get("half")!, { lichessId: "lichess-half", lichessUsername: "Lichess-half" });
    lichess.team.members.add("lichess-half");
    signedIn = "half";
    expect(await redirectedTo(() => deleteSignUp())).toBe("/profile/leave");
    expect(people.has("half")).toBe(true);
    expect(lichess.calls).toEqual([]);
    expect(lichess.team.members).toContain("lichess-half");
    expect(teamRemovals.size).toBe(0);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("the Club's Lichess team", () => {
  it("loses the account of someone who leaves, removed with the Organiser's permission", async () => {
    await redirectedTo(() => leaveClub());
    expect(requests()).toEqual([`POST /api/team/${TEAM}/kick/lichess-ana`]);
    expect(kicks()[0].authorization).toBe(`Bearer ${token}`);
    expect(lichess.team.members.has("lichess-ana")).toBe(false);
    expect(lichess.team.members).toContain("lichess-ben");
    expect(teamRemovals.size).toBe(0);
  });

  // Each way removing them from the team can fail, set up, and what the Organiser is told about it.
  const failures: [string, () => void, string][] = [
    ["the Organiser has not connected Lichess", () => organiserLichess.clear(), "Lichess isn't connected. Connect it on the Organiser page."],
    [
      "the Organiser's permission has expired",
      () => void (organiserLichess.get("singleton")!.expiresAt = new Date("2026-11-09T12:00:00Z")),
      "Your Lichess permission expired on 9 November 2026. Connect Lichess again on the Organiser page.",
    ],
    [
      "the permission was revoked on Lichess",
      () => void (lichess.tokens.get(token)!.revoked = true),
      "Lichess refused your permission, which may have been revoked there. Connect Lichess again on the Organiser page.",
    ],
    [
      "the Organiser's account leads the team without its permission to remove members",
      () => lichess.team.withoutRemoving.add("boss"),
      "Lichess answered POST /api/team/{teamId}/kick/{userId} with 400: Insufficient team permissions. Probably boss leads the Club's team without the team's permission to remove members. A team admin can grant it in the team's leader settings on Lichess, or you can connect a leader who has it.",
    ],
    [
      "the Organiser's permission lacks team:lead",
      () => void (lichess.tokens.get(token)!.scope = "tournament:write"),
      "Lichess answered POST /api/team/{teamId}/kick/{userId} with 403: Missing scope: team:lead.",
    ],
    [
      "the Organiser's account no longer leads the team",
      () => lichess.team.leaders.delete("boss"),
      "Lichess answered POST /api/team/{teamId}/kick/{userId} with 400: Insufficient team permissions. Probably boss leads the Club's team without the team's permission to remove members. A team admin can grant it in the team's leader settings on Lichess, or you can connect a leader who has it.",
    ],
    ["Lichess has no such team", () => vi.stubEnv("LICHESS_TEAM_ID", "another-team"), "Lichess answered POST /api/team/{teamId}/kick/{userId} with 404: Not found."],
    [
      "Lichess is down",
      () => void (lichess.override = (call) => (call.path.includes("/kick/") ? new Response("", { status: 503 }) : undefined)),
      "Lichess answered POST /api/team/{teamId}/kick/{userId} with 503.",
    ],
    ["the Club's team is not configured", () => vi.stubEnv("LICHESS_TEAM_ID", ""), "LICHESS_TEAM_ID is not set, so the Club's Lichess team is not known."],
  ];

  it.each(failures)("cannot keep anyone from leaving when %s: the account is kept to remove by hand, with why", async (_, problem, why) => {
    problem();
    expect(await redirectedTo(() => leaveClub())).toBe("/left");
    expect(people.has("ana")).toBe(false);
    expect([...teamRemovals.values()]).toEqual([{ lichessId: "lichess-ana", at: NOW, problem: why }]);
    // The account is the only thing about them kept, and it is not a scheduled job's failure.
    expect(JSON.stringify([...teamRemovals.values()])).not.toContain("Ana");
    expect(jobFailures.size).toBe(0);
  });

  it("does not wait on Lichess for more than 25 seconds", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    // Lichess never answers, until the request is given up.
    vi.stubGlobal("fetch", (_: unknown, init: RequestInit) => new Promise((__, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    const leaving = redirectedTo(() => leaveClub());
    await vi.advanceTimersByTimeAsync(LICHESS_DEADLINE_MS - 1);
    expect(people.has("ana")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(await leaving).toBe("/left");
    expect(people.has("ana")).toBe(false);
    expect(teamRemovals.get("lichess-ana")?.problem).toBe("Lichess took more than 25 s.");
  });

  it("keeps the account once when the same person is removed twice at once", async () => {
    lichess.team.withoutRemoving.add("boss");
    expect((await Promise.all([removeMember("ana"), removeMember("ana")])).sort()).toEqual([false, true]);
    expect(kicks()).toHaveLength(2);
    expect(teamRemovals.size).toBe(1);
  });

  it("keeps a leader of the team in it, as Lichess does while answering that all went well, and so keeps nothing", async () => {
    lichess.team.leaders.add("lichess-ana");
    await redirectedTo(() => leaveClub());
    expect(people.has("ana")).toBe(false);
    expect(lichess.team.members).toContain("lichess-ana");
    expect(teamRemovals.size).toBe(0);
  });

  it("leaves alone a person who never connected Lichess", async () => {
    expect(await removeMember("half")).toBe(true);
    expect(people.has("half")).toBe(false);
    expect(lichess.calls).toEqual([]);
    expect(teamRemovals.size).toBe(0);
  });
});

describe("the Organiser's list of people to remove from the Lichess team by hand", () => {
  // ana and ben leave while the Organiser's account may not remove members.
  beforeEach(async () => {
    lichess.team.withoutRemoving.add("boss");
    await removeMember("ana");
    await removeMember("ben");
    signedIn = "organiser";
  });

  const listed = (html: string) => {
    const section = html.match(/<section aria-labelledby="removals"[^>]*>(.*?)<\/section>/)?.[1];
    return section === undefined ? null : [...section.matchAll(/<h3>(.*?)<\/h3>/g)].map(([, id]) => id);
  };
  const done = (lichessId: string) => {
    const form = new FormData();
    form.set("lichessId", lichessId);
    return redirectedTo(() => teamRemovalDone(form));
  };

  it("names every account, each with why, apart from the scheduled jobs and whatever fails after", async () => {
    // A scheduled job failing later does not hide them.
    jobFailures.set("1", { id: 1, job: "create-matchdays", at: NOW, matchdayDate: null, problem: "The Matchday could not be created: oops." });
    const html = await organiserPage();
    expect(listed(html)).toEqual(["lichess-ana", "lichess-ben"]);
    expect(text(html)).toContain("Lichess answered POST /api/team/{teamId}/kick/{userId} with 400: Insufficient team permissions.");
    expect(html).toContain(`href="https://lichess.org/team/${TEAM}/kick"`);
    expect(html.match(/<section aria-labelledby="jobs".*?<\/section>/)![0]).not.toContain("lichess-ana");
  });

  it("forgets only the account the Organiser says is done", async () => {
    expect(await done("lichess-ana")).toBe("/organiser");
    expect([...teamRemovals.keys()]).toEqual(["lichess-ben"]);
    expect(listed(await organiserPage())).toEqual(["lichess-ben"]);
    await done("lichess-ben");
    expect(listed(await organiserPage())).toBeNull();
  });

  it("is shown to nobody else, and nobody else can mark one done", async () => {
    for (const who of ["cid", null]) {
      signedIn = who;
      await expect(organiserPage()).rejects.toThrow("not found");
      await expect(done("lichess-ana")).rejects.toThrow("not found");
    }
    expect(teamRemovals.size).toBe(2);
  });

  it("ignores a value no Lichess id could be", async () => {
    const long = `lichess-ana${"x".repeat(20)}`;
    teamRemovals.set(long, { lichessId: long, at: NOW, problem: "kept" });
    await done(long);
    expect(teamRemovals.has(long)).toBe(true);
  });
});

describe("the same removal, for any Member the system names", () => {
  it("has the same effect as the Member leaving themselves, whoever is signed in", async () => {
    signedIn = null;
    expect(await removeMember("ben")).toBe(true);
    expect(people.has("ben")).toBe(false);
    expect([...results.values()].filter((r) => r.userId === "ben")).toEqual([]);
    expect(games.get("ANABEATS")).toMatchObject({ whiteId: "ana", blackId: null });
    expect(requests()).toEqual([`POST /api/team/${TEAM}/kick/lichess-ben`]);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("does nothing for someone who is not there, asking Lichess nothing", async () => {
    expect(await removeMember("nobody")).toBe(false);
    expect(lichess.calls).toEqual([]);
    expect(db.connect).not.toHaveBeenCalled();
    expect(people.size).toBe(5);
  });

  it("deletes nothing, and records nothing, when the database fails", async () => {
    lichess.team.withoutRemoving.add("boss");
    // The transaction's connection fails at the deletion.
    const connect = db.connect.getMockImplementation()!;
    db.connect.mockImplementationOnce(async () => {
      const connection = await connect();
      const query = (sql: string, params?: unknown[]) =>
        sql.startsWith("delete") ? Promise.reject(new Error("Connection terminated unexpectedly")) : connection.query(sql, params);
      return { ...connection, query: query as typeof connection.query };
    });
    await expect(removeMember("ana")).rejects.toThrow("Connection terminated unexpectedly");
    expect(people.has("ana")).toBe(true);
    expect(teamRemovals.size).toBe(0);
  });
});

describe("the Lichess token", () => {
  it("of the Organiser who leaves goes with their account, revoked on Lichess too", async () => {
    signedIn = "organiser";
    expect(await redirectedTo(() => leaveClub())).toBe("/left");
    // Removed from the team with their own permission, which is then revoked.
    expect(requests()).toEqual([`POST /api/team/${TEAM}/kick/boss-plays`, "DELETE /api/token"]);
    expect(lichess.calls.map((c) => c.authorization)).toEqual([`Bearer ${token}`, `Bearer ${token}`]);
    expect(lichess.tokens.get(token)!.revoked).toBe(true);
    expect(organiserLichess.size).toBe(0);
  });

  it("is given up on in time for the Organiser's leaving to end inside the 60 s its page allows", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    signedIn = "organiser";
    // Reading the session takes 21 s, a little more than when the database has to be tried twice (lib/db.ts), so that
    // removing from the team gets the 24 s left, not its own 25 s; and Lichess never answers.
    const read = getSession.getMockImplementation()!;
    getSession.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(read()), 21_000)));
    vi.stubGlobal("fetch", (_: unknown, init: RequestInit) => new Promise((__, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    let left = false;
    const leaving = redirectedTo(() => leaveClub()).then((to) => ((left = true), to));
    await vi.advanceTimersByTimeAsync(LEAVING_LICHESS_BY_MS - 1);
    const early = left;
    await vi.advanceTimersByTimeAsync(10); // the revocation, given no time left, gives up at once
    const inTime = left;
    await vi.advanceTimersByTimeAsync(60_000); // so that it has ended, whatever happened, before the next test
    expect(early).toBe(false);
    expect(inTime).toBe(true);
    expect(await leaving).toBe("/left");
    expect(LEAVING_LICHESS_BY_MS).toBeLessThan(maxDuration * 1000 - 10_000); // and 10 s left for the database after
    expect(teamRemovals.get("boss-plays")?.problem).toBe("Lichess took more than 24 s.");
    expect(logged.join("\n")).toContain("A Lichess token could not be revoked.");
  });

  it("is revoked once when the Organiser is removed twice at once", async () => {
    expect((await Promise.all([removeMember("organiser"), removeMember("organiser")])).sort()).toEqual([false, true]);
    expect(requests().filter((r) => r === "DELETE /api/token")).toHaveLength(1);
    expect(logged.join("\n")).not.toContain("could not be revoked");
  });

  it("of the Organiser is left alone when anyone else leaves", async () => {
    await redirectedTo(() => leaveClub());
    expect(requests()).not.toContain("DELETE /api/token");
    expect(lichess.tokens.get(token)!.revoked).toBe(false);
    expect(organiserLichess.get("singleton")).toMatchObject({ userId: "organiser" });
  });

  it("is not sent to Lichess to revoke once it has expired, being dead there already", async () => {
    organiserLichess.get("singleton")!.expiresAt = new Date("2026-11-09T12:00:00Z");
    signedIn = "organiser";
    await redirectedTo(() => leaveClub());
    expect(requests()).toEqual([]);
    expect(organiserLichess.size).toBe(0);
  });
});

describe("after someone has left", () => {
  beforeEach(async () => {
    await redirectedTo(() => leaveClub());
    signedIn = "cid";
  });

  it("they are on no Leaderboard: not the Season's, the all-time one, or any Recap's, past or present", async () => {
    expect(rows(await season()).map(([rank, name]) => [rank, name])).toEqual([
      ["1", "Cidas Jonaitis"],
      ["2", "Ben Kazlauskas"],
    ]);
    expect(rows(await allTime()).map(([, name]) => name).sort()).toEqual(["Ben Kazlauskas", "Cidas Jonaitis"]);
    // Everyone after them moves up.
    expect(rows(await recap(FIRST))).toEqual([
      ["1", "Ben Kazlauskas", "", "1"],
      ["2", "Cidas Jonaitis", "", "1"],
    ]);
    expect(rows(await recap(SECOND))).toEqual([
      ["1", "Cidas Jonaitis", "", "3"],
      ["2", "Ben Kazlauskas", "", "1"],
    ]);
    for (const html of [await season(), await allTime(), await recap(FIRST), await recap(SECOND)]) {
      expect(html).not.toContain("Ana");
      expect(html).not.toContain("/profiles/ana");
    }
  });

  it("their Awards go to the next best Game, and one won against them keeps its winner", async () => {
    const html = await recap(FIRST);
    const awards = [...html.matchAll(/<li[^>]*><h3[^>]*>(.*?)<\/h3><div[^>]*><p[^>]*><a href="([^"]+)"/g)].map(([, title, href]) => [
      title.replace(/<[^>]+>/g, ""),
      href,
    ]);
    expect(awards).toEqual([
      ["Biggest upset", "/profiles/cid"],
      ["Closest call", "/profiles/cid"],
      ["Fastest checkmate", "/profiles/ben"],
    ]);
    // Ben's mate is of someone who has left: a Member is shown neither its board nor its link, which name their account.
    expect(html).not.toContain("BENMATES");
    expect(text(html)).toContain("Their opponent has since left the Club, so the Game isn't shown.");
    expect(html).toContain("https://lichess.org/CIDWINS1/white");
  });

  it("their Games stay in opponents' histories, against a former member, with no link to Lichess", async () => {
    const ben = await profile("ben");
    expect(gamesListed(ben)).toEqual(["Drew with Cidas Jonaitis", "Lost to Cidas Jonaitis", "Won against a former member", "Lost to a former member"]);
    expect(ben).not.toContain("lichess.org/BENMATES");
    expect(ben).not.toContain("lichess.org/ANABEATS");
    expect(ben).toContain("lichess.org/CIDWINS1");
    expect(gamesListed(await profile("cid"))).toContain("Won against a former member");
  });

  it("their Profile is gone", async () => {
    await expect(profile("ana")).rejects.toThrow("not found");
  });
});
