// The three steps of signing up as each step's page shows them, ahead of any request: which step the person is on,
// which are done, and their pawn standing on theirs, an outline as on the home page until they are a Member (#81).
// Nothing is read: the steps are in each page's shell, before what reads the session.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ConnectStep from "./welcome/lichess/page";
import Welcome from "./welcome/page";
import WelcomeProfile from "./welcome/profile/page";

vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession: vi.fn() } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const none = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

// Each step as the page lists it: its words as read aloud, whether it is the one the person is on, and the pawn on it.
function steps(page: ReactElement) {
  const head = (page.props as { children: ReactElement[] }).children[0];
  return [...renderToStaticMarkup(head).matchAll(/<li([^>]*)>(.*?)<\/li>/g)].map(([, attributes, inside]) => ({
    step: inside
      .replace(/<span[^>]* aria-hidden="true">\d<\/span>/, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
    current: attributes.includes('aria-current="step"'),
    pawn: inside.match(/ src="[^"]*%2F(pawn|pawn-empty)\.webp[^"]*"/)?.[1] ?? null,
  }));
}

describe("the steps of signing up", () => {
  it("put the person on the first step, nothing done, their pawn an outline", () => {
    expect(steps(Welcome())).toEqual([
      { step: "Agree", current: true, pawn: "pawn-empty" },
      { step: "Lichess", current: false, pawn: null },
      { step: "Profile (optional)", current: false, pawn: null },
    ]);
  });

  it("move them to the second once they have agreed, still an outline", () => {
    expect(steps(ConnectStep(none))).toEqual([
      { step: "Agree (done)", current: false, pawn: null },
      { step: "Lichess", current: true, pawn: "pawn-empty" },
      { step: "Profile (optional)", current: false, pawn: null },
    ]);
  });

  it("fill their pawn in on the third, once they are a Member", () => {
    expect(steps(WelcomeProfile())).toEqual([
      { step: "Agree (done)", current: false, pawn: null },
      { step: "Lichess (done)", current: false, pawn: null },
      { step: "Profile (optional)", current: true, pawn: "pawn" },
    ]);
  });
});
