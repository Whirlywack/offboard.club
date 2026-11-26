// The next Matchday on the home page: its time for everyone, and its Lichess tournament for Members once the site has
// created it; and who is signed in, when that cannot be read. Faked: the session and the database (lib/fake-db.ts).
// Everything else is the app's own code.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertOrganiser } from "@/lib/alerts";
import { addPerson, db, fromDatabase, matchdays, people, requestFailures, resetDb, seasons } from "@/lib/fake-db";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";
import { NextMatchday, SeasonChampions, You } from "./page";

const { getSession, request } = vi.hoisted(() => ({ getSession: vi.fn(), request: { headers: new Headers() } }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const DATE = "2026-11-29";
let signedIn: string | null;

// The next Matchday as the viewer gets it: what the home page streams into its Next Matchday panel.
async function nextMatchday() {
  const shown = await NextMatchday();
  return shown ? renderToStaticMarkup(shown as ReactElement) : "";
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-25T12:00:00Z") });
  resetDb();
  addPerson("member");
  addPerson("newcomer", { lichessId: null, lichessUsername: null });
  seasons.set(1, { number: 1, start: DATE });
  signedIn = null;
  request.headers = new Headers();
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
});

afterEach(() => vi.useRealTimers());

describe("the next Matchday's tournament on the home page", () => {
  it("is linked for a Member once the site has created it", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    signedIn = "member";
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday");
    expect(html).toContain('<time dateTime="2026-11-29T18:00:00.000Z">Sunday 29 November at 20:00</time>');
    expect(html).toContain(
      '<a href="https://lichess.org/swiss/AbCd1234" target="_blank" rel="noopener noreferrer">Join this Matchday on Lichess<span class="visually-hidden"> (opens in a new tab)</span></a>',
    );
  });

  it("is not linked before it exists", async () => {
    signedIn = "member";
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday");
    expect(html).toContain("Sunday 29 November at 20:00");
    expect(html).not.toContain("lichess.org/swiss");
  });

  it("is not linked for a visitor or someone part-way through signing up, who see the time alone", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    for (const who of [null, "newcomer"]) {
      signedIn = who;
      const html = await nextMatchday();
      expect(html).toContain("Sunday 29 November at 20:00");
      expect(html).not.toContain("lichess.org/swiss");
    }
  });
});

// Lichess lets a Member join a five-round Swiss until its third round starts; the site keeps the link for 90 minutes.
describe("the Matchday under way on the home page", () => {
  const NEXT = "2026-12-06";
  const at = (time: string) => vi.setSystemTime(new Date(`${DATE}T${time}:00+02:00`)); // Vilnius time in winter

  beforeEach(() => matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null }));

  it("stays linked for a Member until 21:30, saying it has started and until when Lichess lets them join", async () => {
    signedIn = "member";
    for (const time of ["20:05", "21:29"]) {
      at(time);
      const html = await nextMatchday();
      expect(html).toContain("Matchday under way");
      expect(html).not.toContain("Next Matchday");
      expect(html).toContain('<time dateTime="2026-11-29T18:00:00.000Z">Sunday 29 November at 20:00</time>');
      expect(html).toContain("Lichess lets you join until round 3 starts.");
      expect(html).toContain('<a href="https://lichess.org/swiss/AbCd1234"');
    }
  });

  it("gives way at 21:30 to the next Matchday, with no link to the one just played", async () => {
    signedIn = "member";
    at("21:30");
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday");
    expect(html).toContain('<time dateTime="2026-12-06T18:00:00.000Z">Sunday 6 December at 20:00</time>');
    expect(html).not.toContain("under way");
    expect(html).not.toContain("lichess.org/swiss");
  });

  it("gives way to the next Matchday once its results are in, before 21:30", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: new Date(`${DATE}T21:10:00+02:00`) });
    signedIn = "member";
    at("21:15");
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday");
    expect(html).toContain('<time dateTime="2026-12-06T18:00:00.000Z">Sunday 6 December at 20:00</time>');
    expect(html).not.toContain("under way");
    expect(html).not.toContain("lichess.org/swiss");
  });

  it("is not kept when the site never created its tournament: the next Matchday is shown instead", async () => {
    signedIn = "member";
    at("20:05");
    for (const row of [null, { date: DATE, lichessTournamentId: null, ingestedAt: null }]) {
      if (row) matchdays.set(DATE, row);
      else matchdays.delete(DATE);
      const html = await nextMatchday();
      expect(html).toContain("Next Matchday");
      expect(html).toContain('<time dateTime="2026-12-06T18:00:00.000Z">Sunday 6 December at 20:00</time>');
      expect(html).not.toContain("under way");
      expect(html).not.toContain("round 3");
    }
  });

  it("is never shown or linked to a visitor or someone part-way through signing up, who see the next Matchday", async () => {
    matchdays.set(NEXT, { date: NEXT, lichessTournamentId: "EfGh5678", ingestedAt: null });
    for (const [time, shown] of [["19:55", "Sunday 29 November"], ["20:05", "Sunday 6 December"], ["21:30", "Sunday 6 December"]]) {
      at(time);
      for (const who of [null, "newcomer"]) {
        signedIn = who;
        const html = await nextMatchday();
        expect(html).toContain("Next Matchday");
        expect(html).toContain(`${shown} at 20:00`);
        expect(html).not.toContain("lichess.org/swiss");
      }
    }
  });
});

// Who is signed in, when the database cannot be reached (#55). Until Better Auth has once checked its tables in the
// database, every call reads it, so a session cannot be read for a visitor with no session cookie either: only someone
// with the cookie is signed in, and must not be offered to sign in again.
describe("the signed-in panel on the home page", () => {
  const you = async (query: Record<string, string> = {}) =>
    renderToStaticMarkup((await You({ searchParams: Promise.resolve(query) })) as ReactElement);
  const unreadable = () => getSession.mockRejectedValue(new Error("Connection terminated due to connection timeout"));

  it("says plainly that the sign-in cannot be checked when a signed-in person's session cannot be read", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=a-pretend-session-token" });
    unreadable();
    const html = await you();
    expect(html).toContain("Your sign-in can&#x27;t be checked right now. Please try again in a minute.");
    expect(html).not.toContain("Sign in with LinkedIn");
  });

  it("offers to sign in to a visitor with no session cookie, whether or not the database can be read", async () => {
    expect(await you()).toContain("Sign in with LinkedIn");
    unreadable();
    const html = await you();
    expect(html).toContain("Sign in with LinkedIn");
    expect(html).not.toContain("can&#x27;t be checked");
  });

  it("says that signing in isn't working, beside the button, to someone Better Auth failed coming back from LinkedIn", async () => {
    expect(await you()).not.toContain("isn&#x27;t working");
    const html = await you({ signin: "failed" });
    expect(html).toContain("LinkedIn sign-in isn&#x27;t working right now. Please try again in a few minutes.");
    expect(html).toContain("Sign in with LinkedIn");
  });
});

// What the home page catches itself to show something in its place is a failed request all the same (#60 review),
// recorded as the page's, and the Organiser is told of it: what showed nothing on 25 November 2026 (#55).
describe("the home page's failures, which it shows plainly", () => {
  const CHAT = "123456789";
  // As the sign-in library threw it when the pool gave up connecting, marked as the pool marks it (lib/db.ts, #55).
  const timedOut = () =>
    Object.assign(
      new Error("Failed to get session", {
        cause: fromDatabase(new Error("Connection terminated due to connection timeout", { cause: new Error("Connection terminated unexpectedly") })),
      }),
      { name: "APIError" },
    );
  const recorded = () => [...requestFailures.values()].map(({ route, kind, reason }) => ({ route, kind, reason }));
  const ONE = [{ route: "/", kind: "page", reason: "the database couldn't be reached" }];
  let settled: () => Promise<unknown>;

  beforeEach(() => {
    settled = keepWaitUntil();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    db.query.mockReset();
  });

  it("is GET / with a session cookie whose session read timed out: shown plainly, recorded, and alerted", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=a-pretend-session-token" });
    getSession.mockRejectedValue(timedOut());
    const html = renderToStaticMarkup((await You({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toContain("Your sign-in can&#x27;t be checked right now. Please try again in a minute.");
    await settled();
    expect(recorded()).toEqual(ONE);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "a-pretend-telegram-token");
    vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", CHAT);
    vi.stubEnv("TELEGRAM_URL", "");
    const telegram = createFakeTelegram({ token: "a-pretend-telegram-token", chats: [CHAT] });
    vi.stubGlobal("fetch", telegram.fetch);
    await alertOrganiser(new Date(Date.now() + 60 * 60_000));
    expect(telegram.posts.map((post) => `${post.chatId} ${post.text}`)).toEqual([`${CHAT} A page failed at /: the database couldn't be reached.`]);
  });

  it("is the next Matchday's schedule that could not be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(timedOut().cause);
    expect(await nextMatchday()).toBe("");
    await settled();
    expect(recorded()).toEqual(ONE);
  });

  it("is a session that could not be read to tell whether a Member gets the tournament", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    getSession.mockRejectedValue(timedOut());
    const html = await nextMatchday();
    expect(html).toContain("Sunday 29 November at 20:00");
    expect(html).not.toContain("lichess.org/swiss");
    await settled();
    expect(recorded()).toEqual(ONE);
  });

  it("is the Season champion who could not be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(timedOut().cause);
    expect(await SeasonChampions()).toBeNull();
    await settled();
    expect(recorded()).toEqual(ONE);
  });
});
