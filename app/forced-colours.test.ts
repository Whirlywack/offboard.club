// Buttons, and links and blocks drawn as buttons, in forced colours (Windows' high contrast), which repaint their fill
// and drop their shadow: each keeps an outline, at rest and focused, and Sign out stays underlined text; with forced
// colours off, they are as they were. A Member's home page (their You section, and the next Matchday's tournament to
// join), a visitor's way to sign in, and an Award's Replay, with their own styles, in Google Chrome as
// profile-narrow.test.ts starts it. Faked: the session, the database (lib/fake-db.ts), the time and the Telegram group's
// invite link.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextMatchday, You } from "./page";
import { Awards } from "./recaps/awards";
import { addPerson, matchdays, people, resetDb, seasons } from "@/lib/fake-db";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const award = { kind: "biggestUpset", memberId: "member", lichessGameId: "PRETEND1", value: 50, name: "Person member", colour: "white", plies: 40, opponentLeft: false } as const;

// The parts of pages that hold them, with their styles.
async function page() {
  vi.stubEnv("TELEGRAM_INVITE_LINK", "https://t.me/+a-pretend-invite");
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-25T12:00:00Z") });
  resetDb();
  addPerson("member");
  seasons.set(1, { number: 1, start: "2026-11-29" });
  matchdays.set("2026-11-29", { date: "2026-11-29", lichessTournamentId: "AbCd1234", ingestedAt: null });
  const as = async (who: string | null, part: () => unknown) => {
    getSession.mockResolvedValue(who && { user: { ...people.get(who) } });
    return renderToStaticMarkup((await part()) as ReactElement);
  };
  const you = () => You({ searchParams: Promise.resolve({}) });
  const html = [
    await as("member", you),
    await as(null, you),
    await as("member", NextMatchday),
    renderToStaticMarkup(createElement(Awards, { awards: [award], showGames: true })),
  ].join("");
  vi.useRealTimers();
  vi.unstubAllEnvs();
  // Each CSS Module's classes, as named in the markup: `.quiet` is `._quiet_<the file's hash>`.
  const styles = (file: string, one: string) => {
    const hash = html.match(new RegExp(`_${one}_(\\w+)`))![1];
    return readFileSync(join(__dirname, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\([^)]*\)/g, "none")
      .replace(/\.([a-zA-Z][\w-]*)/g, (_, name) => `._${name}_${hash}`);
  };
  const css = [
    readFileSync(join(__dirname, "globals.css"), "utf8"),
    styles("ui.module.css", "quiet"),
    styles("home.module.css", "you"),
    styles("recaps/awards.module.css", "replay"),
  ];
  return `<!doctype html><style>${css.join("\n")}</style><main>${html}</main>`;
}

// Started outside the tests' time limits, as capture's test (scripts/capture.test.ts) starts it: on a shared runner
// Chrome has taken more than 30 s to start. Its one limit is Playwright's, 3 minutes; the hook has none of its own (0).
let browser: Awaited<ReturnType<typeof chromium.launch>>;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome", timeout: 180_000 });
}, 0);
afterAll(async () => {
  await browser?.close();
});

// Each one's border, on all four sides, at rest and then focused with its focus ring showing.
async function borders(forcedColors: "active" | "none") {
  const context = await browser.newContext({ forcedColors });
  try {
    const tab = await context.newPage();
    await tab.setContent(await page());
    return await tab.evaluate(() => {
      const border = (element: Element) => {
        const style = getComputedStyle(element);
        const sides = ["top", "right", "bottom", "left"].map((side) => `${style.getPropertyValue(`border-${side}-width`)} ${style.getPropertyValue(`border-${side}-style`)}`);
        return [...new Set(sides)].join(", ");
      };
      const all = "a[class*=_button_], a[class*=_quiet_], button, [class*=_statusLink_] a, [class*=_replay_] > summary";
      return [...document.querySelectorAll<HTMLElement>(all)].map((element) => {
        const rest = border(element);
        element.focus();
        return { name: element.textContent, rest, focused: element.matches(":focus-visible") && border(element) };
      });
    });
  } finally {
    await context.close();
  }
}

const names = [
  "Sign out",
  "Your Profile",
  "Edit your Profile",
  "Telegram group (opens in a new tab)",
  "Sign in with LinkedIn",
  "Join this Matchday on Lichess (opens in a new tab)",
  "Replay the Game of the biggest upset",
];

describe("buttons, and links and blocks drawn as buttons", () => {
  it("keep an outline in forced colours, at rest and focused, and Sign out stays text", async () => {
    const solid = { rest: "1px solid", focused: "1px solid" };
    const none = { rest: "0px none", focused: "0px none" };
    expect(await borders("active")).toEqual(names.map((name) => ({ name, ...(name === "Sign out" ? none : solid) })));
  });

  it("are as they were with forced colours off", async () => {
    expect(await borders("none")).toEqual(names.map((name) => ({ name, rest: "0px none", focused: "0px none" })));
  });
});
