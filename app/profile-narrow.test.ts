// A Member's Profile on the narrowest phone the site is made for, 320 wide, and on a desktop: its own markup with its own
// styles, in Google Chrome, as capture starts it (scripts/capture.test.ts). A Blitz rating is never split over two
// lines, even in a face wider than the display serif, as when the serif's file has not loaded and a fallback stands in;
// and a position that is one long word wraps inside its column rather than push the page sideways or over the facts.
// Faked: the session and the database (lib/fake-db.ts). The styles are the files themselves, with each class named as
// the rendering names it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ProfilePage from "./profiles/[id]/page";
import { addPerson, matchdays, resetDb, results } from "@/lib/fake-db";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const at = new Date("2026-11-24T18:00:00Z");
const position = "Principalplatformreliabilityengineerfordevelopertoolingandinfrastructureatscales"; // 80 letters

// The Profile as it streams in, with the styles it is shown with, and a wide monospace face in place of the serif.
async function page() {
  resetDb();
  addPerson("ana", { name: "Ana Petraitė", position, openTo: "A coffee", lichessBlitzRating: 1883 });
  for (const date of ["2026-11-15", "2026-11-22"]) {
    matchdays.set(date, { date, lichessTournamentId: `T${date}`, ingestedAt: at });
    results.set(`${date} ana`, { matchdayDate: date, userId: "ana", rank: 1, points: 2, rating: 1883, companyDomain: null });
  }
  getSession.mockResolvedValue({ user: { id: "ben", publicDisplayConsentAt: at, houseRulesAcceptedAt: at, lichessId: "lichess-ben" } });
  addPerson("ben");
  const shell = ProfilePage({ params: Promise.resolve({ id: "ana" }), searchParams: Promise.resolve({}) });
  const inner = shell.props.children[0].props.children;
  const html = renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
  // Each CSS Module's classes, as named in the markup: `.figure` is `._figure_<the file's hash>`.
  const styles = (file: string, one: string) => {
    const hash = html.match(new RegExp(`_${one}_(\\w+)`))![1];
    return readFileSync(join(__dirname, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\([^)]*\)/g, "none")
      .replace(/\.([a-zA-Z][\w-]*)/g, (_, name) => `._${name}_${hash}`);
  };
  const css = [
    readFileSync(join(__dirname, "globals.css"), "utf8"),
    styles("ui.module.css", "black"),
    styles("avatar.module.css", "avatar"),
    styles("profiles/[id]/profile.module.css", "person"),
    // The faces next/font names (app/layout.tsx): a stand-in for the grotesque, and for the serif one wider than it.
    ':root { --font-hanken: Arial, "Liberation Sans", sans-serif; --font-bodoni: "Courier New", "Liberation Mono", monospace; }',
  ].join("\n");
  return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><main>${html}</main>`;
}

let browser: Awaited<ReturnType<typeof chromium.launch>>;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome" });
});
afterAll(async () => {
  await browser?.close();
});

// The lines the Blitz rating takes; where the position's words end, and where the facts begin.
async function measure(width: number) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width < 900, hasTouch: width < 900 });
  try {
    const tab = await context.newPage();
    await tab.setContent(await page());
    return await tab.evaluate(() => {
      const contents = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range;
      };
      const rating = [...document.querySelectorAll("dl > div")].find((row) => row.querySelector("dt")?.textContent === "Blitz rating")!;
      return {
        ratingLines: contents(rating.querySelector("dd")!).getClientRects().length,
        positionEnds: Math.round(contents(document.querySelector("h1 + p")!).getBoundingClientRect().right),
        factsBegin: Math.round(document.querySelector("dl")!.getBoundingClientRect().left),
      };
    });
  } finally {
    await context.close();
  }
}

describe("a Profile on a 320 phone", () => {
  it("keeps a four-digit Blitz rating on one line, and a one-word position inside the gutters", async () => {
    const { ratingLines, positionEnds } = await measure(320);
    expect(ratingLines).toBe(1);
    expect(positionEnds).toBeLessThanOrEqual(320 - 16);
  });
});

describe("a Profile on a desktop", () => {
  it("wraps a one-word position in its column, clear of the facts beside it", async () => {
    const { positionEnds, factsBegin } = await measure(1280);
    expect(positionEnds).toBeLessThan(factsBegin);
  });
});
