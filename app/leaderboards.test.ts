// The public Season and all-time Leaderboard pages, the Season champion on the home page, and the links between them
// and the Recaps, as a signed-out visitor sees them. Faked: the session, the clock and the database (lib/fake-db.ts),
// filled in as ingestion and the schedule leave it. Everything else is the app's own code.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCompany, addPerson, db, fromDatabase, matchdays, people, resetDb, results, seasons, skippedSundays } from "@/lib/fake-db";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";
import AllTimePage from "./all-time/page";
import RootLayout from "./layout";
import Home from "./page";
import RecapPage from "./recaps/[date]/page";
import SeasonPage from "./seasons/[number]/page";
import CurrentSeasonPage from "./seasons/page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/font/google", () => ({ Newsreader: () => ({ variable: "newsreader" }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

// Season 1 starts on Sunday 6 December 2026 and 20 December is skipped; Season 2 starts on 31 January 2027.
const SEASON_1 = ["2026-12-06", "2026-12-13", "2026-12-27", "2027-01-03", "2027-01-10", "2027-01-17"];
const SEASON_2 = ["2027-01-31", "2027-02-07", "2027-02-14", "2027-02-21", "2027-02-28", "2027-03-07"];
const WEEK_OFF = "2027-01-24";

// A Matchday as ingestion leaves it: the Members' results in Lichess's order, each with the Company of that night.
function ingested(date: string, rows: [userId: string, points: number, companyDomain?: string][]) {
  matchdays.set(date, { date, lichessTournamentId: `T${date.replaceAll("-", "").slice(1)}`, ingestedAt: new Date() });
  rows.forEach(([userId, points, companyDomain = null], i) =>
    results.set(`${date} ${userId}`, { matchdayDate: date, userId, rank: i + 1, points, rating: 1500, companyDomain }),
  );
}

// What a page streams in after its static shell: the element inside its <Suspense>, rendered.
async function streamed(page: ReactElement<{ children: ReactNode[] }>, at = 0) {
  const inner = (page.props.children[at] as ReactElement<{ children: ReactElement }>).props.children;
  const render = inner.type as (props: unknown) => Promise<ReactNode>;
  return renderToStaticMarkup((await render(inner.props)) as ReactElement);
}

const season = (number: string) =>
  streamed(SeasonPage({ params: Promise.resolve({ number }), searchParams: Promise.resolve({}) }));
const currentSeason = () => streamed(CurrentSeasonPage());
const allTime = () => streamed(AllTimePage(), 1);
const recap = (date: string) => streamed(RecapPage({ params: Promise.resolve({ date }), searchParams: Promise.resolve({}) }));

// The home page's Season champion line, found by name in the page's tree.
async function homeChampion() {
  const find = (node: ReactNode): ReactElement | undefined => {
    if (!isValidElement(node)) return Array.isArray(node) ? node.map(find).find(Boolean) : undefined;
    if (typeof node.type === "function" && node.type.name === "SeasonChampions") return node;
    return find((node.props as { children?: ReactNode }).children);
  };
  const element = find(Home({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }))!;
  const shown = await (element.type as () => Promise<ReactNode>)();
  return shown ? renderToStaticMarkup(shown as ReactElement) : "";
}

// A Leaderboard's rows as text, cell by cell.
const rows = (html: string) =>
  [...html.matchAll(/<tr>(.*?)<\/tr>/g)]
    .slice(1)
    .map(([, row]) => [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map(([, cell]) => cell.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'")));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ");

beforeEach(() => {
  resetDb();
  vi.useFakeTimers({ now: new Date("2027-02-10T12:00:00Z"), toFake: ["Date"] });
  getSession.mockReset().mockResolvedValue(null);
  seasons.set(1, { number: 1, start: "2026-12-06" });
  skippedSundays.set("2026-12-20", { date: "2026-12-20" });
  addCompany("vinted.com", "Vinted");
  addCompany("bolt.eu", "bolt.eu");
  addPerson("ana", { name: "Ana Petraitė", image: "https://media.licdn.com/ana.jpg", linkedInUrl: "https://www.linkedin.com/in/ana", companyDomain: "vinted.com" });
  addPerson("ben", { name: "Benas Kazlauskas", position: "CTO", openTo: "coffee" });
  addPerson("cid", { name: "Cidas Jonaitis" });
  addPerson("cheat", { name: "Marked Account", lichessMarked: true });
  addPerson("half", { name: "Not Yet", lichessId: null });
});

// A test that makes the database unreachable makes every statement fail; this puts the fake back.
const answering = db.query.getMockImplementation()!;
// Every statement fails as pg's does when it cannot connect, the one that would record the page's failure too, which is
// then logged (lib/request-failures.ts): returns what waits for that, then what was logged as its failure.
const unreachable = () => {
  const settled = keepWaitUntil();
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  db.query.mockRejectedValue(fromDatabase(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })));
  return async () => {
    await settled();
    return logged.mock.calls.map(([said]) => String(said)).filter((said) => said.includes("couldn't be recorded"));
  };
};
const unrecorded = (route: string) => `A page failed at ${route}: the database couldn't be reached. It couldn't be recorded: the database couldn't be reached.`;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  db.query.mockImplementation(answering);
});

// Season 1 played out: Ana best on her best four, Ben joined at the fourth Matchday, a marked account at the top of every
// night, and someone part-way through signing up in the results too.
function seasonOne() {
  SEASON_1.forEach((date, i) =>
    ingested(date, [["cheat", 5], ["half", 4.5], ["ana", [3, 1, 4, 3, 2, 4.5][i], "bolt.eu"], ...(i >= 3 ? ([["ben", 4]] as [string, number][]) : [])]),
  );
}

describe("a Season's Leaderboard", () => {
  it("ranks Members by their best four Matchdays, with their Company, score and Matchdays played", async () => {
    seasonOne();
    const html = await season("1");
    expect(html).toContain("<h1>Season 1</h1>");
    // Ana: 4.5 + 4 + 3 + 3 = 14.5 from six. Ben: 12 from three, joined mid-Season. The marked account and the person
    // part-way through signing up are left out.
    expect(rows(html)).toEqual([
      ["1", "Ana Petraitėbolt.eu", "14.5", "6"],
      ["2", "Benas Kazlauskas", "12", "3"],
    ]);
    for (const hidden of ["Marked Account", "Not Yet"]) expect(html).not.toContain(hidden);
  });

  it("names the Season champion once the sixth Matchday is in, and links each name to the Member's Profile", async () => {
    seasonOne();
    const html = await season("1");
    expect(text(html)).toContain("Season champion Ana Petraitė 14.5 points.");
    expect(text(html)).toContain("This Season is over.");
    expect(text(html)).toContain(
      "Your score adds up your best four Matchdays. A tie goes to whoever played more Matchdays; if that's level too, they share the rank.",
    );
    expect([...html.matchAll(/href="(\/profiles\/[^"]+)"/g)].map(([, href]) => href)).toEqual(["/profiles/ana", "/profiles/ana", "/profiles/ben"]);
    expect(html).toContain("Only signed-in Members can open Profiles.");
  });

  it("names nobody before the sixth Matchday, and says how far the Season has gone", async () => {
    vi.setSystemTime(new Date("2027-01-20T12:00:00Z")); // the week off, before Season 2 starts
    SEASON_1.slice(0, 5).forEach((date) => ingested(date, [["ana", 3]]));
    const html = await season("1");
    expect(html).not.toContain("Season champion");
    expect(text(html)).toContain("Matchday 5 of 6 is done. Results from Sunday, 17 January 2027 aren't in yet.");
    vi.setSystemTime(new Date("2027-01-12T12:00:00Z"));
    expect(text(await season("1"))).toContain("Matchday 5 of 6 is done. The next one is on Sunday, 17 January 2027.");
  });

  it("ends without its sixth Matchday once Season 2 has started, and says which one was not played", async () => {
    // 10 February: Season 2's first Matchday was on 31 January, and Season 1's last was never ingested.
    SEASON_1.slice(0, 5).forEach((date) => ingested(date, [["ana", 3]]));
    const html = await season("1");
    expect(text(html)).toContain("This Season is over, with five of its six Matchdays played.");
    expect(text(html)).toContain("Season champion Ana Petraitė");
    expect(text(html)).toContain("Matchday 6 17 Jan Not played");
    expect(html.match(/Not played/g)).toHaveLength(1);
  });

  it("shares the title between Members still level at the top", async () => {
    SEASON_1.forEach((date) => ingested(date, [["cid", 4], ["ana", 4]]));
    const html = await season("1");
    expect(text(html)).toContain("Season champions Ana Petraitė and Cidas Jonaitis They finished level on 16 points and on Matchdays played. Leaderboard");
    expect(rows(html).map((r) => r[0])).toEqual(["1", "1"]);
  });

  it("shows nothing else about anyone: no email, photo, LinkedIn link, Lichess name, rating, position or open-to line", async () => {
    seasonOne();
    const html = (await season("1")) + (await allTime());
    for (const hidden of ["@", "licdn", "linkedin", "lichess", "Lichess-", "1500", "CTO", "coffee", "<img"]) expect(html).not.toContain(hidden);
  });

  it("links each of the six Matchdays that has a Recap to it", async () => {
    ingested(SEASON_2[0], [["ana", 3]]);
    ingested(SEASON_2[1], [["ana", 3]]);
    const html = await season("2");
    expect([...html.matchAll(/href="(\/recaps\/[^"]+)"/g)].map(([, href]) => href)).toEqual(["/recaps/2027-01-31", "/recaps/2027-02-07"]);
    expect((html.match(/<li>/g) ?? []).length).toBe(6);
  });

  it("says plainly that a Season with no ingested Matchday is still to come", async () => {
    vi.setSystemTime(new Date("2027-01-20T12:00:00Z")); // the week off, before Season 2 starts
    seasonOne();
    const html = await season("2");
    expect(text(html)).toContain("Season 2 starts on Sunday, 31 January 2027.");
    expect(text(html)).toContain("It fills in after the first Matchday.");
    expect(html).not.toContain("<table");
  });

  it("is not found, without reading the database, for an address that cannot be a Season's", async () => {
    // proxy.ts answers these with a 404 before the page; the page refuses them too.
    db.query.mockClear();
    for (const number of ["0", "01", "201", "-1", "1.5", "abc", "1e2", "99999999999999999999"]) await expect(season(number)).rejects.toThrow("not found");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is not found for a Season after the one after the current one, whose dates would still move", async () => {
    seasonOne();
    // 10 February: Season 1 is the latest with results and Season 2 is under way, so Season 2 is the last with a page.
    expect(await season("2")).toContain("<h1>Season 2</h1>");
    for (const number of ["3", "200"]) await expect(season(number)).rejects.toThrow("not found");
  });

  it("before Season 1 is scheduled, shows Season 1 waiting for its sixteenth Member and no other Season", async () => {
    seasons.clear();
    expect(text(await season("1"))).toContain("Its dates are set once there are sixteen of us.");
    expect(text(await currentSeason())).toContain("Its dates are set once there are sixteen of us.");
    await expect(season("2")).rejects.toThrow("not found");
  });

  it("says plainly that it cannot be shown when the database cannot be read, and hands the page's failure on", async () => {
    const failures = unreachable();
    expect(await season("1")).toContain("This Leaderboard can&#x27;t be shown right now.");
    expect(await currentSeason()).toContain("This Leaderboard can&#x27;t be shown right now.");
    expect(await failures()).toEqual([unrecorded("/seasons/[number]"), unrecorded("/seasons")]);
  });
});

describe("the current Season's Leaderboard", () => {
  it("stays on the Season just ended through the week off, until the next Season's first Matchday is in", async () => {
    seasonOne();
    ingested(WEEK_OFF, [["cid", 5]]);
    expect(await currentSeason()).toContain("<h1>Season 1</h1>");
    ingested(SEASON_2[0], [["cid", 5]]);
    const html = await currentSeason();
    expect(html).toContain("<h1>Season 2</h1>");
    expect(rows(html)).toEqual([["1", "Cidas Jonaitis", "5", "1"]]);
    // Both Seasons so far are a link away.
    expect([...html.matchAll(/href="(\/seasons\/\d+)"/g)].map(([, href]) => href)).toEqual(["/seasons/1", "/seasons/2"]);
  });
});

describe("the all-time Leaderboard", () => {
  it("ranks Members by Matchdays played, Seasons and weeks off alike, with the Company they're at now", async () => {
    seasonOne();
    ingested(WEEK_OFF, [["cid", 5], ["ben", 1]]);
    expect(rows(await allTime())).toEqual([
      ["1", "Ana PetraitėVinted (vinted.com)", "6"],
      ["2", "Benas Kazlauskas", "4"],
      ["3", "Cidas Jonaitis", "1"],
    ]);
    expect(renderToStaticMarkup(AllTimePage())).toMatch(/>Members ranked by how many Matchdays they&#x27;ve played\.<\/p>/);
  });

  it("leaves out a closed account while it stays closed", async () => {
    seasonOne();
    people.get("ben")!.lichessClosed = true;
    expect(rows(await allTime()).map((r) => r[1])).toEqual(["Ana PetraitėVinted (vinted.com)"]);
  });

  it("says so when nobody is on it yet, and when the database cannot be read, whose failure it hands on", async () => {
    expect(await allTime()).toMatch(/>Nobody is on it yet\.<\/p>/);
    const failures = unreachable();
    expect(await allTime()).toContain("This Leaderboard can&#x27;t be shown right now.");
    expect(await failures()).toEqual([unrecorded("/all-time")]);
  });
});

describe("the Season champion on the home page", () => {
  it("is named from the sixth Matchday until the next Season's first is ingested", async () => {
    vi.setSystemTime(new Date("2027-01-20T12:00:00Z")); // the week off, before Season 2 starts
    SEASON_1.slice(0, 5).forEach((date) => ingested(date, [["ana", 3]]));
    expect(await homeChampion()).toBe("");
    ingested(SEASON_1[5], [["ana", 3]]);
    expect(text(await homeChampion())).toContain("Ana Petraitė is the Season 1 champion.");
    expect(await homeChampion()).toContain('href="/seasons/1"');
    ingested(SEASON_2[0], [["cid", 5]]);
    expect(await homeChampion()).toBe("");
  });

  it("names everyone sharing the title", async () => {
    SEASON_1.forEach((date) => ingested(date, [["cid", 4], ["ana", 4]]));
    expect(text(await homeChampion())).toContain("Ana Petraitė and Cidas Jonaitis share the Season 1 title.");
  });

  it("is left out when the database cannot be read", async () => {
    unreachable();
    expect(await homeChampion()).toBe("");
  });
});

describe("links to the Leaderboards", () => {
  it("are on the home page and in the site header", () => {
    const home = renderToStaticMarkup(Home({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    const header = renderToStaticMarkup(RootLayout({ children: null, params: Promise.resolve({}) }) as ReactElement);
    for (const html of [home, header]) for (const href of ['href="/seasons"', 'href="/all-time"']) expect(html).toContain(href);
  });

  it("go from a Recap to its Season, and not from a Matchday outside every Season", async () => {
    seasonOne();
    ingested(WEEK_OFF, [["cid", 5]]);
    expect(text(await recap(SEASON_1[2]))).toContain("Matchday 3 of Season 1");
    expect(await recap(SEASON_1[2])).toContain('href="/seasons/1"');
    expect(await recap(WEEK_OFF)).not.toContain("/seasons/");
  });
});
