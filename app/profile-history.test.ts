// The Games section and the record on a Member's Profile, as a signed-in Member sees them. Faked: the session and the
// database (lib/fake-db.ts), filled in as ingestion leaves it. Everything else is the app's own code. Who may open a
// Profile at all is in access.test.ts.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, games, matchdays, people, resetDb, results } from "@/lib/fake-db";
import { GAMES_MOST, GAMES_SHOWN } from "@/lib/history";
import { together } from "./profiles/[id]/history";
import ProfilePage from "./profiles/[id]/page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const at = new Date("2026-11-24T18:00:00Z");
const signedInAs = (id: string) =>
  getSession.mockResolvedValue({ user: { id, publicDisplayConsentAt: at, houseRulesAcceptedAt: at, lichessId: `lichess-${id}` } });

// Non-breaking spaces, which keep a number on the line of its word, read as spaces here.
const plain = (html: string) => html.replaceAll(" ", " ");

// The page is a static shell; what reads the session and the database is the element inside <Suspense>.
async function open(id: string, search: Record<string, string> = {}) {
  const page = ProfilePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) });
  const inner = page.props.children[0].props.children;
  return plain(renderToStaticMarkup((await inner.type(inner.props)) as ReactElement));
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
// The Games as listed: each row's words, and the dates they sit under.
const rows = (html: string) => [...html.matchAll(/<li(?: id="more")?><p>(.*?)<\/p>/g)].map(([, row]) => text(row));
const dates = (html: string) => [...html.matchAll(/<h3[^>]*><a href="([^"]+)"/g)].map(([, href]) => href);
const facts = (html: string) => Object.fromEntries([...html.matchAll(/<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(([, dt, dd]) => [dt, text(dd)]));

function ingested(date: string, played: string[]) {
  matchdays.set(date, { date, lichessTournamentId: `MD${date.replaceAll("-", "").slice(2)}`, ingestedAt: new Date() });
  played.forEach((userId, i) =>
    results.set(`${date} ${userId}`, { matchdayDate: date, userId, rank: i + 1, points: 2, rating: 1500, companyDomain: null }),
  );
}

let clock = Date.parse("2026-11-01T18:00:00Z");
function game(id: string, date: string, whiteId: string | null, blackId: string | null, winner: "white" | "black" | null) {
  clock += 60_000;
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
    winnerClockCentis: winner ? 1200 : null,
    finishedAt: new Date(clock),
  });
}

beforeEach(() => {
  resetDb();
  getSession.mockReset().mockResolvedValue(null);
  addPerson("ana", { name: "Ana Petraitė" });
  addPerson("ben", { name: "Ben Kazlauskas" });
  addPerson("cid", { name: "Aušrinė Žemaitytė-Kazlauskienė" });
  addPerson("dan", { name: "Dovilė Stankevičiūtė" });
  addPerson("gone", { name: "Departed Person" });
  ingested("2026-11-15", ["ana", "ben", "cid", "gone"]);
  ingested("2026-11-22", ["ana", "ben", "cid"]);
  game("Game0001", "2026-11-15", "ana", "gone", "white");
  game("Game0002", "2026-11-15", "ben", "ana", "white");
  game("Game0003", "2026-11-22", "cid", "ana", null);
  game("Game0004", "2026-11-22", "ana", "ben", "black");
  // As Postgres leaves it when an account is deleted: the person's results go and their side of each Game empties.
  people.delete("gone");
  results.delete("2026-11-15 gone");
  games.get("Game0001")!.blackId = null;
  signedInAs("ben");
});

describe("a Member's Profile seen by another Member", () => {
  it("lists their Games newest first under each Matchday's date, from their side", async () => {
    const html = await open("ana");
    expect(rows(html)).toEqual([
      "Lost to Ben Kazlauskas",
      "Drew with Aušrinė Žemaitytė-Kazlauskienė",
      "Lost to Ben Kazlauskas",
      "Won against a former member",
    ]);
    expect(dates(html)).toEqual(["/recaps/2026-11-22", "/recaps/2026-11-15"]);
    expect(html).toContain('<span class="visually-hidden">Recap of </span><time dateTime="2026-11-22">Sunday, 22 November 2026</time>');
  });

  it("links each opponent's name to their Profile, and names someone who has left without a link", async () => {
    const html = await open("ana");
    expect([...html.matchAll(/href="(\/profiles\/[^"?]+)"/g)].map(([, href]) => href)).toEqual([
      "/profiles/ben",
      "/profiles/cid",
      "/profiles/ben",
    ]);
    expect(html).toContain("<p>Won against a former member</p>");
    expect(html).not.toContain("Departed Person");
  });

  it("links each Game to Lichess in a new tab, the board turned to the Member's side", async () => {
    const html = await open("ana");
    const links = [...html.matchAll(/<a href="(https:\/\/lichess\.org\/Game[^"]+)" target="_blank" rel="noopener noreferrer">(.*?)<\/a>/g)];
    expect(links.map(([, href]) => href)).toEqual([
      "https://lichess.org/Game0004/white",
      "https://lichess.org/Game0003/black",
      "https://lichess.org/Game0002/black",
    ]);
    expect(text(links[0][2])).toBe("Game against Ben Kazlauskas on Lichess (opens in a new tab)");
  });

  it("does not link a Game against someone who has left to Lichess, whose page would name their account", async () => {
    const html = await open("ana");
    expect(html).toContain("<li><p>Won against a former member</p></li>");
    expect(html).not.toContain("lichess.org/Game0001");
  });

  it("keeps each Matchday's Games together, even when one finished after a later Matchday's", async () => {
    // A Game of 15 November recorded as finishing after every Game of 22 November.
    game("Late0001", "2026-11-15", "ana", "cid", "white");
    const html = await open("ana");
    expect(dates(html)).toEqual(["/recaps/2026-11-22", "/recaps/2026-11-15"]);
    expect(rows(html)).toEqual([
      "Lost to Ben Kazlauskas",
      "Drew with Aušrinė Žemaitytė-Kazlauskienė",
      "Won against Aušrinė Žemaitytė-Kazlauskienė",
      "Lost to Ben Kazlauskas",
      "Won against a former member",
    ]);
  });

  it("shows Matchdays played and a Streak of two or more", async () => {
    expect(facts(await open("ana"))).toMatchObject({ "Matchdays played": "2", Streak: "2 Matchdays in a row" });
  });

  it("shows no Streak of one, and none of zero", async () => {
    ingested("2026-11-29", ["ben"]);
    ingested("2026-12-06", ["ana"]); // a Streak of one
    expect(facts(await open("ana"))).toMatchObject({ "Matchdays played": "3" });
    expect(facts(await open("ana"))).not.toHaveProperty("Streak");
    ingested("2026-12-13", ["ben"]);
    expect(facts(await open("ana"))).not.toHaveProperty("Streak");
    expect(await open("ana")).not.toMatch(/Streak|in a row/);
  });

  it("shows the viewer's head-to-head record against them, counted from both colours", async () => {
    expect(await open("ana")).toContain("You and Ana have played 2 Games. You won both.");
    signedInAs("ana");
    expect(await open("ben")).toContain("You and Ben have played 2 Games. You lost both.");
    expect(await open("cid")).toContain("You and Aušrinė have played one Game, which you drew.");
  });

  it("shows no head-to-head record against someone the viewer has never played", async () => {
    const html = await open("cid");
    expect(html).not.toContain("You and");
    expect(rows(html)).toEqual(["Drew with Ana Petraitė"]);
  });

  it("offers the viewer no way to edit it", async () => {
    expect(await open("ana")).not.toContain('href="/profile"');
  });

  it("shows a Member whose Lichess account is marked or closed, and their opponents, like anyone else", async () => {
    people.get("ana")!.lichessMarked = true;
    people.get("cid")!.lichessClosed = true;
    const html = await open("ana");
    expect(facts(html)).toMatchObject({ "Matchdays played": "2", Streak: "2 Matchdays in a row" });
    expect(rows(html)).toContain("Drew with Aušrinė Žemaitytė-Kazlauskienė");
    expect(html).toContain("You and Ana have played 2 Games.");
    expect(html).not.toMatch(/marked|closed|excluded|violat/i);
  });
});

describe("your own Profile", () => {
  it("lists your Games without a head-to-head record", async () => {
    signedInAs("ana");
    const html = await open("ana");
    expect(rows(html)).toHaveLength(4);
    expect(html).not.toContain("You and");
    expect(html).toContain('href="/profile"');
  });
});

describe("a Profile with no Games", () => {
  it("says so, without a Matchdays played or Streak line", async () => {
    signedInAs("dan");
    let html = await open("dan");
    expect(html).toContain("Your Games appear here after your first Matchday.");
    expect(facts(html)).not.toHaveProperty("Matchdays played");
    signedInAs("ana");
    html = await open("dan");
    expect(html).toContain("Dovilė hasn&#x27;t played a Matchday yet.");
    expect(html).not.toContain("<ol");
  });

  it("says plainly when the Member has played Matchdays but no Game against another Member", async () => {
    ingested("2026-11-29", ["dan"]); // a bye, or a late join
    expect(await open("dan")).toContain("No Games against other Members yet.");
    expect(facts(await open("dan"))).toMatchObject({ "Matchdays played": "1" });
  });
});

describe("a Profile with many Games", () => {
  beforeEach(() => {
    for (let n = 1; n <= GAMES_SHOWN + 1; n++) game(`Many${String(n).padStart(4, "0")}`, "2026-11-22", "ana", "dan", "white");
  });

  it(`lists the latest ${GAMES_SHOWN} with a link to show them all`, async () => {
    const html = await open("ana");
    expect(rows(html)).toHaveLength(GAMES_SHOWN);
    expect(html).toContain(`href="/profiles/ana?games=all#more">Show all ${GAMES_SHOWN + 5} Games</a>`);
    expect(html).not.toContain('id="more"');
  });

  it("lists them all when asked, with no link and no note while there are no more", async () => {
    const html = await open("ana", { games: "all" });
    expect(rows(html)).toHaveLength(GAMES_SHOWN + 5);
    // "Show all" lands on the first Game that was not listed before.
    expect([...html.matchAll(/<li( id="more")?><p>/g)].findIndex(([, id]) => id)).toBe(GAMES_SHOWN);
    expect(html).not.toContain("Show all");
    expect(html).not.toContain("Showing the latest");
  });

  it(`stops at ${GAMES_MOST} even when asked for them all, and says so`, async () => {
    for (let n = 1; n <= GAMES_MOST; n++) game(`More${String(n).padStart(4, "0")}`, "2026-11-29", "ana", "dan", null);
    const html = await open("ana", { games: "all" });
    expect(rows(html)).toHaveLength(GAMES_MOST);
    expect(html).toContain(`Showing the latest ${GAMES_MOST} of ${GAMES_MOST + GAMES_SHOWN + 5} Games. Older ones are on Lichess.`);
  });

  it("ignores anything else the address asks for", async () => {
    for (const games of ["ALL", "1000", "all ", "<script>"]) expect(rows(await open("ana", { games }))).toHaveLength(GAMES_SHOWN);
  });
});

describe("the head-to-head sentence", () => {
  it("says the record the way people say it, leaving out counts of none", () => {
    const said = (record: Parameters<typeof together>[1]) => plain(together("Ben", record));
    expect(said({ wins: 5, draws: 2, losses: 1 })).toBe("You and Ben have played 8 Games. You won 5, drew 2 and lost 1.");
    expect(said({ wins: 1, draws: 0, losses: 7 })).toBe("You and Ben have played 8 Games. You won 1 and lost 7.");
    expect(said({ wins: 0, draws: 3, losses: 0 })).toBe("You and Ben have played 3 Games. You drew all 3.");
    expect(said({ wins: 0, draws: 0, losses: 2 })).toBe("You and Ben have played 2 Games. You lost both.");
    expect(said({ wins: 0, draws: 0, losses: 1 })).toBe("You and Ben have played one Game, which you lost.");
  });

  it("keeps each number on the line of its word", () => {
    expect(together("Ben", { wins: 5, draws: 2, losses: 1 })).toBe(
      "You and Ben have played 8 Games. You won 5, drew 2 and lost 1.",
    );
  });
});
