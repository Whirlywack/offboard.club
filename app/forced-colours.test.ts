// Buttons, and links that do a button's job (ui.button, ui.quiet), in forced colours (Windows' high contrast), which
// repaint their fill and drop their shadow: each keeps an outline, at rest and focused; with forced colours off, they
// are as they were. The home page's You section for a Member and for a visitor, which hold all three, with their own
// styles, in Google Chrome as profile-narrow.test.ts starts it. Faked: the session, the database (lib/fake-db.ts) and
// the Telegram group's invite link.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { You } from "./page";
import { addPerson, people, resetDb } from "@/lib/fake-db";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

// A Member's You section (Sign out, their two links and the Telegram group's) and a visitor's (Sign in with LinkedIn),
// with their styles.
async function page() {
  vi.stubEnv("TELEGRAM_INVITE_LINK", "https://t.me/+a-pretend-invite");
  resetDb();
  addPerson("member");
  const you = async (session: unknown) => {
    getSession.mockResolvedValue(session);
    return renderToStaticMarkup((await You({ searchParams: Promise.resolve({}) })) as ReactElement);
  };
  const html = (await you({ user: { ...people.get("member") } })) + (await you(null));
  vi.unstubAllEnvs();
  // Each CSS Module's classes, as named in the markup: `.quiet` is `._quiet_<the file's hash>`.
  const styles = (file: string, one: string) => {
    const hash = html.match(new RegExp(`_${one}_(\\w+)`))![1];
    return readFileSync(join(__dirname, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\([^)]*\)/g, "none")
      .replace(/\.([a-zA-Z][\w-]*)/g, (_, name) => `._${name}_${hash}`);
  };
  const css = [readFileSync(join(__dirname, "globals.css"), "utf8"), styles("ui.module.css", "quiet"), styles("home.module.css", "you")];
  return `<!doctype html><style>${css.join("\n")}</style><main>${html}</main>`;
}

let browser: Awaited<ReturnType<typeof chromium.launch>>;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome" });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

// Each button and button-like link's border, on all four sides, at rest and then focused with its focus ring showing.
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
      return [...document.querySelectorAll<HTMLElement>("a[class*=_button_], a[class*=_quiet_], button")].map((element) => {
        const rest = border(element);
        element.focus();
        return { name: element.textContent, rest, focused: element.matches(":focus-visible") && border(element) };
      });
    });
  } finally {
    await context.close();
  }
}

describe("buttons, and links that do a button's job", () => {
  it("keep an outline in forced colours, at rest and focused", async () => {
    const solid = { rest: "1px solid", focused: "1px solid" };
    expect(await borders("active")).toEqual([
      { name: "Sign out", ...solid },
      { name: "Your Profile", ...solid },
      { name: "Edit your Profile", ...solid },
      { name: "Telegram group (opens in a new tab)", ...solid },
      { name: "Sign in with LinkedIn", ...solid },
    ]);
  });

  it("are as they were with forced colours off", async () => {
    const none = { rest: "0px none", focused: "0px none" };
    expect(await borders("none")).toEqual([
      { name: "Sign out", ...none },
      { name: "Your Profile", ...none },
      { name: "Edit your Profile", ...none },
      { name: "Telegram group (opens in a new tab)", ...none },
      { name: "Sign in with LinkedIn", ...none },
    ]);
  });
});
