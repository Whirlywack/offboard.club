// The next Matchday on the home page: its time for everyone, and its Lichess tournament for Members once the site has
// created it. Faked: the session and the database (lib/fake-db.ts). Everything else is the app's own code.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, matchdays, people, resetDb, seasons } from "@/lib/fake-db";
import Home from "./page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const DATE = "2026-11-29";
let signedIn: string | null;

// The next Matchday as the viewer gets it: the element inside the header's first <Suspense>.
async function nextMatchday() {
  const header = Home().props.children[0];
  const inner = header.props.children[2].props.children;
  const shown = await inner.type(inner.props);
  return shown ? renderToStaticMarkup(shown as ReactElement) : "";
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-25T12:00:00Z") });
  resetDb();
  addPerson("member");
  addPerson("newcomer", { lichessId: null, lichessUsername: null });
  seasons.set("1", { number: 1, start: DATE });
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
    expect(html).toContain('Next Matchday: <time dateTime="2026-11-29T18:00:00.000Z">Sunday 29 November at 20:00</time> Vilnius time.');
    expect(html).toContain('<a href="https://lichess.org/swiss/AbCd1234" target="_blank" rel="noopener noreferrer">Join it on Lichess</a>');
  });

  it("is not linked before it exists", async () => {
    signedIn = "member";
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday:");
    expect(html).not.toContain("lichess.org/swiss");
  });

  it("is not linked for a visitor or someone part-way through signing up, who see the time alone", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    for (const who of [null, "newcomer"]) {
      signedIn = who;
      const html = await nextMatchday();
      expect(html).toContain("Next Matchday:");
      expect(html).not.toContain("lichess.org/swiss");
    }
  });
});
