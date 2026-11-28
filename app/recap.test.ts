// The public Recap pages: the list of Recaps and one Matchday's Recap, as a signed-out visitor sees them. Faked: the
// session and the database (lib/fake-db.ts), filled in as ingestion leaves it. Everything else is the app's own code.
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecapAward } from "@/lib/awards";
import { addCompany, addPerson, db, fromDatabase, games, matchdays, people, requestFailures, resetDb, results, seasons, type GameRow } from "@/lib/fake-db";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";
import { ingestMatchday } from "@/lib/matchday";
import { getRecap } from "@/lib/recaps";
import Home from "./page";
import ProfilePage from "./profiles/[id]/page";
import { GameBoard } from "./recaps/awards";
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
  matchdays.set(date, { date, lichessTournamentId: "PRETEND1", ingestedAt: new Date() });
  rows.forEach(([userId, points, companyDomain = null], i) =>
    results.set(`${date} ${userId}`, { matchdayDate: date, userId, rank: i + 1, points, rating: 1500, companyDomain }),
  );
}

// The page is a static shell; what reads the database is the element inside <Suspense>, first in <main>.
async function open(date: string) {
  const page = RecapPage({ params: Promise.resolve({ date }), searchParams: Promise.resolve({}) });
  const inner = [page.props.children].flat()[0].props.children;
  return renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
}

async function list() {
  const page = RecapsPage();
  const inner = page.props.children[1].props.children;
  return renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
}

// The failed requests recorded (lib/request-failures.ts).
const recorded = () => [...requestFailures.values()].map(({ route, kind, reason }) => ({ route, kind, reason }));

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
    expect(html).toMatch(/<h1[^>]*><em>Recap<\/em> of <time dateTime="2026-11-29">Sunday, 29 November 2026<\/time><\/h1>/);
    // The marked account is left out and everyone after it moves up. ana was at Vinted that night, wherever she is now:
    // under her name for a phone, and in the Company column for a desktop.
    expect(rows(html)).toEqual([
      ["1", "Ana Petraitė Vinted (vinted.com)", "Vinted (vinted.com)", "4.5"],
      ["2", "Ben Kazlauskas", "", "3"],
      ["3", "Cora Jonaitė", "", "0.5"],
    ]);
    expect(html).not.toContain("Marked Account");
  });

  it("links the tournament on Lichess, whose standings show Lichess names, for signed-in Members only", async () => {
    const link = 'href="https://lichess.org/swiss/PRETEND1"';
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
    for (const hidden of ["@", "licdn", "linkedin", "lichess.org", "Lichess-", "CTO", "coffee"]) expect(html).not.toContain(hidden);
    // Its one picture is the Club's photograph of the queen over the fallen king, which needs no words.
    expect([...html.matchAll(/<img [^>]*>/g)].map(([img]) => img)).toEqual([expect.stringMatching(/^<img alt="".* src="[^"]*queen-king\.webp/)]);
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

  it("says plainly that it cannot be shown when the database cannot be read, and records the page's failure", async () => {
    const settled = keepWaitUntil();
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(fromDatabase(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })));
    expect(await open(DATE)).toContain("This Recap can&#x27;t be shown right now.");
    await settled();
    expect(recorded()).toEqual([{ route: "/recaps/[date]", kind: "page", reason: "the database couldn't be reached" }]);
  });

  it("is shown without its Season when the schedule cannot be read, and records the page's failure", async () => {
    const settled = keepWaitUntil();
    seasons.set(1, { number: 1, start: DATE });
    expect(await open(DATE)).toContain("Season 1");
    const real = db.query.getMockImplementation()!;
    db.query.mockImplementation((sql: string, params?: unknown[]) =>
      String(sql).includes(`from "season"`) ? Promise.reject(fromDatabase(new Error("Connection terminated unexpectedly"))) : real(sql, params),
    );
    const html = await open(DATE);
    db.query.mockImplementation(real);
    expect(html).toMatch(/<h1[^>]*><em>Recap<\/em> of/);
    expect(html).not.toContain("Season 1");
    await settled();
    expect(recorded()).toEqual([{ route: "/recaps/[date]", kind: "page", reason: "the database couldn't be reached" }]);
  });
});

// A decisive Game of the Matchday of DATE, stored as ingestion leaves it. Each one finishes a minute after the last,
// unless told otherwise; White wins by resignation after 20 moves each, unless told otherwise.
let minute = 0;
function played(lichessGameId: string, whiteId: string | null, blackId: string | null, details: Partial<GameRow> = {}) {
  games.set(lichessGameId, {
    lichessGameId,
    matchdayDate: DATE,
    whiteId,
    blackId,
    winner: "white",
    status: "resign",
    plies: 40,
    whiteRating: 1500,
    blackRating: 1500,
    winnerClockCentis: 6000,
    finishedAt: new Date(Date.UTC(2026, 10, 29, 18, ++minute)),
    ...details,
  });
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").trim();

// The board a Member sees on opening an Award's replay.
const boardOf = (award: RecapAward) => renderToStaticMarkup(createElement(GameBoard, { award }));

// The Awards as shown: what each is for, who won it, what they did, and the Game's address on Lichess if the Game is
// shown. Null when the Recap has no Awards section.
function awardsIn(html: string) {
  const section = html.match(/<section aria-labelledby="awards"[^>]*>(.*?)<\/section>/)?.[1];
  if (section === undefined) return null;
  return [...section.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map(([, item]) => {
    const [winner, feat] = [...item.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map(([, p]) => text(p));
    const title = text(item.match(/<h3[^>]*>(.*?)<\/h3>/)![1]);
    return { title, winner, feat, game: item.match(/<a href="(https:\/\/lichess\.org\/[^"]+)"/)?.[1] ?? null };
  });
}

const signedInAs = (stage: { publicDisplayConsentAt: Date | null; houseRulesAcceptedAt: Date | null; lichessId: string | null }) =>
  getSession.mockResolvedValue({ user: { id: "viewer", ...stage } });
const welcomedAt = new Date("2026-11-24T18:00:00Z");
const asMember = () => signedInAs({ publicDisplayConsentAt: welcomedAt, houseRulesAcceptedAt: welcomedAt, lichessId: "viewer" });

describe("a Recap's Awards", () => {
  beforeEach(() => {
    minute = 0;
  });

  it("are worked out from the recorded Games as stored, each naming the Member who won it", async () => {
    // The recorded Lichess exports, their people invented (lib/matchday.test.ts says how), ingested as the Matchday of
    // 22 November with four of its players as Members.
    const fixture = (name: string) => readFileSync(new URL(`../lib/fixtures/${name}`, import.meta.url), "utf8");
    const players = { ada: ["Ada Kingside", "pretend--ada"], bruno: ["Bruno Queenside", "pretend--bruno"], ines: ["Ines Tempo", "pretend--ines"], boris: ["Boris Blunder", "pretend--boris"] };
    for (const [id, [name, lichessId]] of Object.entries(players)) addPerson(id, { name, lichessId });
    const ingested = ingestMatchday(
      fixture("results.ndjson"),
      fixture("games.ndjson"),
      Object.entries(players).map(([memberId, [, lichessId]]) => ({ memberId, lichessId })),
    );
    const date = "2026-11-22";
    matchdays.set(date, { date, lichessTournamentId: "PRETEND1", ingestedAt: new Date() });
    for (const s of ingested.scores) results.set(`${date} ${s.memberId}`, { matchdayDate: date, userId: s.memberId, rank: s.rank, points: s.points, rating: s.rating, companyDomain: null });
    for (const g of ingested.games)
      games.set(g.lichessGameId, {
        lichessGameId: g.lichessGameId,
        matchdayDate: date,
        whiteId: g.white,
        blackId: g.black,
        winner: g.winner,
        status: g.status,
        plies: g.plies,
        whiteRating: g.ratings.white,
        blackRating: g.ratings.black,
        winnerClockCentis: g.winnerClockCentis,
        finishedAt: new Date(g.finishedAt),
        moves: g.moves,
      });

    asMember();
    const html = await open(date);
    // The moves are kept, and shown to nobody yet (#105).
    for (const g of ingested.games) expect(html).not.toContain(g.moves!.slice(0, 20));
    expect(awardsIn(html)).toEqual([
      // Pretend--Ines (1579), with Black, beat Pretend--Boris (1694) on time with 2.78 seconds left: the clock
      // showed 2.7.
      { title: "Biggest upset", winner: "Ines Tempo", feat: "Beat someone rated 115 points higher.", game: "https://lichess.org/Pretend066/black" },
      { title: "Closest call", winner: "Ines Tempo", feat: "Won with 2.7 seconds left on the clock.", game: "https://lichess.org/Pretend066/black" },
      // Mate on White's 40th move, the 79th half-move.
      { title: "Fastest checkmate", winner: "Bruno Queenside", feat: "Checkmated their opponent in 40 moves.", game: "https://lichess.org/Pretend119/white" },
    ]);
    // Each winner's name opens their Profile.
    const section = html.match(/<section aria-labelledby="awards".*?<\/section>/)![0];
    expect([...section.matchAll(/href="(\/profiles\/[^"]+)"/g)].map(([, href]) => href)).toEqual(["/profiles/ines", "/profiles/ines", "/profiles/bruno"]);

    // Each board opens on the Game's last move, from the winner's side: 110 half-moves in, Black at the bottom.
    const [upset, , checkmate] = (await getRecap(date))!.awards;
    expect(boardOf(upset)).toContain('src="https://lichess.org/embed/game/Pretend066/black?theme=brown&amp;bg=system#110"');
    expect(boardOf(checkmate)).toContain('src="https://lichess.org/embed/game/Pretend119/white?theme=brown&amp;bg=system#79"');
    for (const board of [upset, checkmate].map(boardOf)) for (const g of ingested.games) expect(board).not.toContain(g.moves!.slice(0, 20));
  });

  it("gives each Award to the right Game, and counts seconds as the clock does", async () => {
    played("UPSET001", "ana", "ben", { whiteRating: 1400, blackRating: 1650, winnerClockCentis: 12_345 });
    played("UPSET002", "ben", "cora", { whiteRating: 1500, blackRating: 1501, winnerClockCentis: 99 });
    played("MATE0001", "cora", "ana", { winner: "black", status: "mate", plies: 9, whiteRating: 1600, blackRating: 1500 });
    played("MATE0002", "ben", "cora", { status: "mate", plies: 31 });
    expect(awardsIn(await open(DATE))).toEqual([
      { title: "Biggest upset", winner: "Ana Petraitė", feat: "Beat someone rated 250 points higher.", game: null },
      // 0.99 seconds left is 0.9 on the clock.
      { title: "Closest call", winner: "Ben Kazlauskas", feat: "Won with 0.9 seconds left on the clock.", game: null },
      // Black's mate on the ninth half-move is their fourth move.
      { title: "Fastest checkmate", winner: "Ana Petraitė", feat: "Checkmated their opponent in 4 moves.", game: null },
    ]);
  });

  it("gives time left in seconds to a tenth under a minute, and in minutes and seconds from a minute up", async () => {
    // A favourite's win by resignation: the closest call is the only Award.
    played("CLOCK001", "ana", "ben", { whiteRating: 1700, blackRating: 1500 });
    const shown = async (centis: number) => {
      games.get("CLOCK001")!.winnerClockCentis = centis;
      return awardsIn(await open(DATE))?.map((a) => a.feat);
    };
    // Never rounded up, as a clock never shows more time than is left.
    expect(await shown(5_999)).toEqual(["Won with 59.9 seconds left on the clock."]);
    expect(await shown(6_000)).toEqual(["Won with 1:00 left on the clock."]);
    expect(await shown(27_230)).toEqual(["Won with 4:32 left on the clock."]);
    expect(await shown(61_230)).toEqual(["Won with 10:12 left on the clock."]);
  });

  it("says 1 point, not 1 points", async () => {
    played("UPSET001", "ben", "cora", { whiteRating: 1500, blackRating: 1501 });
    expect(awardsIn(await open(DATE))?.[0].feat).toBe("Beat someone rated 1 point higher.");
  });

  it("goes to the Game that finished first when two are level", async () => {
    played("LATER001", "ana", "ben", { whiteRating: 1400, blackRating: 1500, winnerClockCentis: 500, finishedAt: new Date("2026-11-29T18:40:00Z") });
    played("FIRST001", "cora", "ben", { whiteRating: 1400, blackRating: 1500, winnerClockCentis: 500, finishedAt: new Date("2026-11-29T18:20:00Z") });
    expect(awardsIn(await open(DATE))?.map((a) => a.winner)).toEqual(["Cora Jonaitė", "Cora Jonaitė"]);
  });

  it("leaves out an Award no Game qualified for", async () => {
    // A favourite's win by resignation: no upset and no checkmate, but a time left.
    played("FAVOURIT", "ana", "ben", { whiteRating: 1700, blackRating: 1500 });
    expect(awardsIn(await open(DATE))?.map((a) => a.title)).toEqual(["Closest call"]);
  });

  it("leaves out the whole section when no Game won anything", async () => {
    played("DRAWN001", "ana", "ben", { winner: null, status: "draw", winnerClockCentis: null });
    // A win over an opponent who never moved is a no-show, not an achievement.
    played("NOSHOW01", "cora", "ben", { status: "outoftime", plies: 1, whiteRating: 1400, blackRating: 1800 });
    const html = await open(DATE);
    expect(awardsIn(html)).toBeNull();
    expect(html).not.toContain("Awards");
  });

  it("passes over Games with a marked or closed account on either side, and wins by someone who has since left", async () => {
    addPerson("dan", { name: "Closed Account", lichessClosed: true });
    results.set(`${DATE} dan`, { matchdayDate: DATE, userId: "dan", rank: 5, points: 0, rating: 1500, companyDomain: null });
    // Each of these would win every Award.
    played("BEATMARK", "ana", "cheat", { whiteRating: 1000, blackRating: 2000, status: "mate", plies: 5, winnerClockCentis: 1 });
    played("CLOSEDWN", "dan", "ben", { whiteRating: 1000, blackRating: 2000, status: "mate", plies: 5, winnerClockCentis: 1 });
    played("LEFTWINS", null, "ben", { whiteRating: 1000, blackRating: 2000, status: "mate", plies: 5, winnerClockCentis: 1 });
    // What is left: an upset by cora, and a mate by ben over someone who has left since, which still counts.
    played("CORAWINS", "cora", "ana", { whiteRating: 1450, blackRating: 1500, winnerClockCentis: 4_000 });
    played("BENMATES", "ben", null, { status: "mate", plies: 21, winnerClockCentis: 9_000 });
    expect(awardsIn(await open(DATE))).toEqual([
      { title: "Biggest upset", winner: "Cora Jonaitė", feat: "Beat someone rated 50 points higher.", game: null },
      { title: "Closest call", winner: "Cora Jonaitė", feat: "Won with 40.0 seconds left on the clock.", game: null },
      { title: "Fastest checkmate", winner: "Ben Kazlauskas", feat: "Checkmated their opponent in 11 moves.", game: null },
    ]);
  });

  it("is left out when its winner's account is marked after the Matchday", async () => {
    played("UPSET001", "ana", "ben", { whiteRating: 1400, blackRating: 1650 });
    expect(awardsIn(await open(DATE))).toHaveLength(2);
    people.get("ana")!.lichessMarked = true;
    expect(awardsIn(await open(DATE))).toBeNull();
  });

  it("shows the Game on Lichess's board to signed-in Members only", async () => {
    // Ben, the favourite, wins with Black: no upset, so this is the one Award.
    played("CLOSE001", "ana", "ben", { winner: "black", whiteRating: 1500, blackRating: 1700, plies: 57 });
    const theGame = /CLOSE001/;

    // Signed out, part-way through signing up, or with a session that cannot be read: the Award, without its Game.
    const withoutGame = async () => {
      const html = await open(DATE);
      expect(awardsIn(html)).toEqual([
        { title: "Closest call", winner: "Ben Kazlauskas", feat: "Won with 1:00 left on the clock.", game: null },
      ]);
      expect(html).not.toMatch(theGame);
      expect(html).not.toContain("Replay the Game");
      expect(html).toContain("Only signed-in Members can open Profiles.");
    };
    await withoutGame();
    signedInAs({ publicDisplayConsentAt: null, houseRulesAcceptedAt: null, lichessId: null }); // before the welcome step
    await withoutGame();
    signedInAs({ publicDisplayConsentAt: welcomedAt, houseRulesAcceptedAt: welcomedAt, lichessId: null }); // before connecting Lichess
    await withoutGame();
    getSession.mockRejectedValue(new Error("connect ETIMEDOUT"));
    await withoutGame();

    asMember();
    const html = await open(DATE);
    expect(html).not.toContain("Only signed-in Members can open Profiles.");
    // Closed until asked for, and named for screen readers; the Game has a plain link too.
    expect(html).toMatch(/<details[^>]*><summary>.*Replay the Game<span class="visually-hidden"> of the closest call<\/span><\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(awardsIn(html)?.[0].game).toBe("https://lichess.org/CLOSE001/black");
    expect(html).toContain("Any Member can win one, whatever their rating.");
    // Under the board, the link alone.
    expect(html).toMatch(/<p class="[^"]+"><a href="https:\/\/lichess.org\/CLOSE001\/black" target="_blank"/);
    expect(html).toContain('href="https://lichess.org/CLOSE001/black" target="_blank" rel="noopener noreferrer"');
    // Lichess's board is not in the page until it is opened, so reading the Recap asks nothing of Lichess.
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("lichess.org/embed");
  });

  it("shows nobody the Game of an Award won against someone who has since left, as Lichess's board names their account", async () => {
    // Ben's mate is of someone who has left since; Cora's win wins the other two.
    played("BENMATES", "ben", null, { status: "mate", plies: 21, winnerClockCentis: 9_000 });
    played("CORAWINS", "cora", "ana", { whiteRating: 1450, blackRating: 1500, winnerClockCentis: 4_000 });

    // A visitor gets nothing under an Award, not even why its Game is not there.
    let html = await open(DATE);
    expect(html).not.toContain("Replay the Game");
    expect(html).not.toMatch(/BENMATES|CORAWINS/);
    expect(html).not.toContain("has since left");

    asMember();
    html = await open(DATE);
    expect(awardsIn(html)).toEqual([
      { title: "Biggest upset", winner: "Cora Jonaitė", feat: "Beat someone rated 50 points higher.", game: "https://lichess.org/CORAWINS/white" },
      { title: "Closest call", winner: "Cora Jonaitė", feat: "Won with 40.0 seconds left on the clock.", game: "https://lichess.org/CORAWINS/white" },
      { title: "Fastest checkmate", winner: "Ben Kazlauskas", feat: "Checkmated their opponent in 11 moves.", game: null },
    ]);
    expect(html).toContain("Their opponent has since left the Club, so the Game isn&#x27;t shown.");
    // Under that Award alone: the other two were won against someone still in the Club.
    expect(html.match(/has since left/g)).toHaveLength(1);
    expect(html).not.toContain("BENMATES");
    expect(html).toMatch(/<details[^>]*><summary>.*Replay the Game<span class="visually-hidden"> of the biggest upset<\/span>/);
    expect(html).not.toContain("of the fastest checkmate</span>");

    // With only that Award, a visitor gets both Awards and no Game.
    games.delete("CORAWINS");
    getSession.mockResolvedValue(null);
    html = await open(DATE);
    expect(awardsIn(html)?.map((a) => a.title)).toEqual(["Closest call", "Fastest checkmate"]);
    expect(html).not.toContain("Replay the Game");
  });

  it("puts the Game on Lichess's own board, sandboxed, lazy, titled and sending no referrer", async () => {
    played("CLOSE001", "ana", "ben", { winner: "black", whiteRating: 1500, blackRating: 1700, plies: 57 });
    const [award] = (await getRecap(DATE))!.awards;
    // Ben won with Black, so his side is at the bottom, and the board opens on the 57th and last half-move.
    expect(boardOf(award)).toContain(
      '<iframe src="https://lichess.org/embed/game/CLOSE001/black?theme=brown&amp;bg=system#57" title="Replay of Ben Kazlauskas&#x27;s closest call, on Lichess" loading="lazy" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads" referrerPolicy="no-referrer"></iframe>',
    );
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

  it("says so when there are none yet, and when the database cannot be read, whose failure it records", async () => {
    expect(renderToStaticMarkup(RecapsPage())).toMatch(/>Each Matchday&#x27;s Leaderboard and Awards\.<\/p>/);
    resetDb();
    expect(await list()).toMatch(/>No Recaps yet\.<\/p>$/);
    const settled = keepWaitUntil();
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(fromDatabase(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })));
    expect(await list()).toContain("The Recaps can&#x27;t be shown right now.");
    await settled();
    expect(recorded()).toEqual([{ route: "/recaps", kind: "page", reason: "the database couldn't be reached" }]);
  });

  it("is linked from the home page", () => {
    expect(renderToStaticMarkup(Home({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }))).toContain('href="/recaps"');
  });
});
