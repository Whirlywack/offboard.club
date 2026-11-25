// The next Matchday on the home page: its time for everyone, and its Lichess tournament for Members once the site has
// created it. Faked: the session and the database (lib/fake-db.ts). Everything else is the app's own code.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, matchdays, people, resetDb, seasons } from "@/lib/fake-db";
import { NextMatchday } from "./page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
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
