// The public Recap pages: the list of Recaps and one Matchday's Recap, as a signed-out visitor sees them. Faked: the
// session and the database (lib/fake-db.ts), filled in as ingestion leaves it. Everything else is the app's own code.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCompany, addPerson, db, matchdays, resetDb, results } from "@/lib/fake-db";
import Home from "./page";
import ProfilePage from "./profiles/[id]/page";
import RecapPage from "./recaps/[date]/page";
import RecapsPage from "./recaps/page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
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

const DATE = "2026-11-29";

// A Matchday as ingestion leaves it: the Members' results in Lichess's order, each with the Company of that night.
function ingested(date: string, rows: [userId: string, points: number, companyDomain?: string][]) {
  matchdays.set(date, { date, lichessTournamentId: "PF2C2AUC", ingestedAt: new Date() });
  rows.forEach(([userId, points, companyDomain = null], i) =>
    results.set(`${date} ${userId}`, { matchdayDate: date, userId, rank: i + 1, points, rating: 1500, companyDomain }),
  );
}

// The page is a static shell; what reads the database is the element inside <Suspense>, first in <main>.
async function open(date: string) {
  const page = RecapPage({ params: Promise.resolve({ date }), searchParams: Promise.resolve({}) });
  const inner = page.props.children[0].props.children;
  return renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
}

async function list() {
  const page = RecapsPage();
  const inner = page.props.children[2].props.children;
  return renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
}

// The Leaderboard's rows as text: rank, name, Company, points.
const rows = (html: string) =>
  [...html.matchAll(/<tr>(.*?)<\/tr>/g)].slice(1).map(([, row]) => [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map(([, cell]) => cell.replace(/<[^>]+>/g, "")));

beforeEach(() => {
  resetDb();
  getSession.mockReset().mockResolvedValue(null);
  addCompany("vinted.com", "Vinted");
  addCompany("bolt.eu", "bolt.eu"); // a Company whose website gave no name
  addPerson("ana", { name: "Ana Petraitė", image: "https://media.licdn.com/ana.jpg", linkedInUrl: "https://www.linkedin.com/in/ana", companyDomain: "bolt.eu" });
  addPerson("ben", { name: "Ben Kazlauskas", position: "CTO", openTo: "coffee" });
  addPerson("cheat", { name: "Marked Account", lichessMarked: true });
  addPerson("cora", { name: "Cora Jonaitė" });
  ingested(DATE, [
    ["cheat", 5],
    ["ana", 4.5, "vinted.com"],
    ["ben", 3],
    ["cora", 0.5],
  ]);
});

describe("a Recap", () => {
  it("shows the Matchday Leaderboard in Lichess's order with names, Companies of that night and points", async () => {
    const html = await open(DATE);
    expect(html).toContain('<h1>Recap of <time dateTime="2026-11-29">Sunday, 29 November 2026</time></h1>');
    // The marked account is left out and everyone after it moves up. ana was at Vinted that night, wherever she is now.
    expect(rows(html)).toEqual([
      ["1", "Ana Petraitė", "Vinted (vinted.com)", "4.5"],
      ["2", "Ben Kazlauskas", "", "3"],
      ["3", "Cora Jonaitė", "", "0.5"],
    ]);
    expect(html).not.toContain("Marked Account");
  });

  it("links the tournament on Lichess, whose standings show Lichess names, for signed-in Members only", async () => {
    const link = 'href="https://lichess.org/swiss/PF2C2AUC"';
    expect(await open(DATE)).not.toContain(link); // signed out
    const signedInAs = (stage: { publicDisplayConsentAt: Date | null; houseRulesAcceptedAt: Date | null; lichessId: string | null }) =>
      getSession.mockResolvedValue({ user: { id: "viewer", ...stage } });
    const at = new Date("2026-11-24T18:00:00Z");
    signedInAs({ publicDisplayConsentAt: null, houseRulesAcceptedAt: null, lichessId: null }); // before the welcome step
    expect(await open(DATE)).not.toContain(link);
    signedInAs({ publicDisplayConsentAt: at, houseRulesAcceptedAt: at, lichessId: null }); // before connecting Lichess
    expect(await open(DATE)).not.toContain(link);
    signedInAs({ publicDisplayConsentAt: at, houseRulesAcceptedAt: at, lichessId: "viewer" }); // a Member
    expect(await open(DATE)).toContain(link);
    getSession.mockRejectedValue(new Error("connect ETIMEDOUT")); // a session that cannot be read
    expect(await open(DATE)).not.toContain(link);
  });

  it("links each name to the Member's Profile, which a signed-out visitor cannot open", async () => {
    const html = await open(DATE);
    const links = [...html.matchAll(/href="(\/profiles\/[^"]+)"/g)].map(([, href]) => href);
    expect(links).toEqual(["/profiles/ana", "/profiles/ben", "/profiles/cora"]);
    for (const href of links) {
      const page = ProfilePage({ params: Promise.resolve({ id: href.split("/")[2] }), searchParams: Promise.resolve({}) });
      const inner = page.props.children[0].props.children;
      await expect(inner.type(inner.props)).rejects.toThrow(/^redirect \/$/);
    }
  });

  it("shows nothing else about anyone: no email, photo, LinkedIn link, position or open-to line", async () => {
    const html = await open(DATE);
    for (const hidden of ["@", "licdn", "linkedin", "lichess.org", "Lichess-", "CTO", "coffee", "<img"]) expect(html).not.toContain(hidden);
  });

  it("is not found for a Sunday with no ingested Matchday", async () => {
    await expect(open("2026-11-22")).rejects.toThrow("not found");
    matchdays.set("2026-12-06", { date: "2026-12-06", lichessTournamentId: "NEXTWEEK", ingestedAt: null });
    await expect(open("2026-12-06")).rejects.toThrow("not found");
  });

  it("is not found, without reading the database, for an address that cannot be a Matchday's", async () => {
    // proxy.ts answers these with a 404 before the page; the page refuses them too.
    db.query.mockClear();
    for (const date of ["abc", "2026-02-30", "2026-11-24", "2025-12-28", "2100-01-03", "2026-11-29T00:00", "../admin"])
      await expect(open(date)).rejects.toThrow("not found");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("says so when everyone who played has since left the Leaderboard", async () => {
    ingested("2026-12-06", [["cheat", 1]]);
    expect(await open("2026-12-06")).toContain("Nobody is on this Matchday&#x27;s Leaderboard.");
  });

  it("says plainly that it cannot be shown when the database cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    expect(await open(DATE)).toContain("This Recap can&#x27;t be shown right now.");
  });
});

describe("the list of Recaps", () => {
  it("lists every ingested Matchday, newest first, each linking to its Recap", async () => {
    ingested("2026-12-06", [["ana", 2]]);
    ingested("2026-11-22", [["ben", 1]]);
    matchdays.set("2026-12-13", { date: "2026-12-13", lichessTournamentId: "NOTYET12", ingestedAt: null });
    const html = await list();
    expect([...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => href)).toEqual([
      "/recaps/2026-12-06",
      "/recaps/2026-11-29",
      "/recaps/2026-11-22",
    ]);
  });

  it("says so when there are none yet, and when the database cannot be read", async () => {
    resetDb();
    expect(await list()).toContain("No Recaps yet");
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    expect(await list()).toContain("The Recaps can&#x27;t be shown right now.");
  });

  it("is linked from the home page", () => {
    expect(renderToStaticMarkup(Home())).toContain('href="/recaps"');
  });
});
