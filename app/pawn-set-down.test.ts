// A new Member's pawn set down on the home page (#104): who sees it, where, and only once; then the movement itself, in
// Google Chrome with the page's own styles, at a phone's width and a desktop's, and with reduced motion; and the count
// keeping its lines as it changes, for every count at every phone width (#109). Faked: the session and the database
// (lib/fake-db.ts), and in Chrome the serif. Everything else is the app's own code, and in Chrome the pictures are the
// files themselves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";
import { chromium, type BrowserContext } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProfile } from "./actions";
import home from "./home.module.css";
import Home, { NextMatchday } from "./page";
import { ProfileForm } from "./profile/profile-form";
import ui from "./ui.module.css";
import { addPerson, people, resetDb, seasons } from "@/lib/fake-db";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

let signedIn: string | null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-25T12:00:00Z") });
  resetDb();
  signedIn = null;
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
});

afterEach(() => vi.useRealTimers());

// The Club with `earlier` Members who signed up days ago (fake-db's sign-up time), "new", who connected Lichess, and so
// became a Member, `minutes` ago, and "partway", who has not connected Lichess yet.
function club(earlier: number, minutes = 5) {
  for (let i = 0; i < earlier; i++) addPerson(`earlier${i}`);
  addPerson("new", { lichessConnectedAt: new Date(Date.now() - minutes * 60_000) });
  addPerson("partway", { lichessId: null, lichessUsername: null, lichessConnectedAt: null });
}

// The Season block as someone arriving at an address on the site sees it.
async function arrive(address: string) {
  const query = Object.fromEntries(new URL(address, "https://offboard.club").searchParams);
  const shown = await NextMatchday({ searchParams: Promise.resolve(query) });
  return shown ? renderToStaticMarkup(shown as ReactElement) : "";
}

// Each of the sixteen places, as the row shows it: a pawn, an outline, or a pawn over the outline it is stepping into.
const row = (html: string) =>
  [...html.matchAll(/<li( class="[^"]*")?>(.*?)<\/li>/g)].map(([, arriving, inside]) => {
    const pictures = [...inside.matchAll(/ src="[^"]*%2F(pawn|pawn-empty)\.webp/g)].map(([, file]) => (file === "pawn" ? "pawn" : "outline"));
    return arriving ? `${pictures.join(" under ")}, set down` : pictures.join(" ");
  });
const places = (standing: number, arriving?: number) =>
  Array.from({ length: 16 }, (_, place) => (place === arriving ? "outline under pawn, set down" : place < standing ? "pawn" : "outline"));

// The Profile form, on the step after signing up or on the edit page, and where saving it as it is leads: the form sends
// its hidden fields and the fields left empty.
const profileForm = (welcome: boolean) => renderToStaticMarkup(createElement(ProfileForm, { saved: null, welcome }));
async function saving(form: string) {
  const sent = new FormData();
  for (const [, name, value] of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)) sent.set(name, value);
  return saveProfile(null, sent).then(
    (refused) => `refused: ${refused?.problem}`,
    (error: Error) => error.message.replace(/^redirect /, ""),
  );
}

// Where each way on from the Profile step leads: saving it, and skipping it.
async function waysOn() {
  const form = profileForm(true);
  return [await saving(form), form.match(/<a [^>]*href="([^"]+)"[^>]*>Skip for now<\/a>/)![1]];
}

// The block as it stands, without what takes `joined` out of the address where nothing moves.
const still = (html: string) => html.replace(new RegExp(`^<div class="${home.setDown}">([\\s\\S]*)</div>$`), "$1");

describe("a new Member's pawn on the home page", () => {
  it("is set down for them as they come from the Profile step, saved or skipped, at the part of the page with the pawn row", async () => {
    club(13);
    signedIn = "new";
    // The whole home page, each streamed part in its place: the row is inside the part the address leads to.
    const { prelude } = await prerenderToNodeStream(Home({ params: Promise.resolve({}), searchParams: Promise.resolve({ joined: "" }) }), {
      progressiveChunkSize: Number.POSITIVE_INFINITY,
    });
    let page = "";
    for await (const chunk of prelude) page += chunk;
    expect(page.indexOf('id="season"')).toBeLessThan(page.indexOf("<ol"));
    expect(page.indexOf("<ol")).toBeLessThan(page.indexOf('aria-labelledby="chess"'));

    for (const address of await waysOn()) {
      expect(new URL(address, "https://offboard.club").hash).toBe("#season");
      const html = await arrive(address);
      // Fourteen Members now, the new one the fourteenth: their pawn steps into the fourteenth place.
      expect(row(html)).toEqual(places(14, 13));
      expect(html).toContain(
        `<span class="${home.was}" aria-hidden="true">3 more Members to go</span><span class="${home.now}">2 more Members to go</span>`,
      );
      expect(html).toContain(`<div class="${home.setDown} ${home.moving}">`);
    }
  });

  it("is not where saving the Profile edit page leads", async () => {
    club(13);
    signedIn = "new";
    const edit = profileForm(false);
    expect(edit).not.toContain('name="next"');
    expect(await saving(edit)).toBe("/profiles/new");
  });

  it("keeps the row hidden from assistive technology, and gives it the count once, with its new number", async () => {
    club(0);
    signedIn = "new";
    const html = await arrive("/?joined#season");
    expect(html).toMatch(/<ol class="[^"]*" aria-hidden="true">/);
    const read = html
      .replace(/<(\w+)[^>]* aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    expect(read).toBe("Season 1 15 more Members to go It starts once there are sixteen of us, on the first Sunday at least a week later.");
  });

  it("is standing already when they come back: by a reload, which no longer says where they came from, or later", async () => {
    club(13);
    signedIn = "earlier0";
    const standing = await arrive("/");
    expect(row(standing)).toEqual(places(14));
    signedIn = "new";
    for (const address of ["/#season", "/"]) expect(await arrive(address)).toBe(standing);
    vi.setSystemTime(Date.now() + 60 * 60_000);
    const late = await arrive("/?joined#season");
    expect(still(late)).toBe(standing);
    expect(late).not.toBe(standing); // what takes `joined` out of the address is there all the same
  });

  it("is never set down for a Member who signed up earlier, a visitor or someone part-way through signing up", async () => {
    club(13);
    signedIn = "earlier0";
    const standing = await arrive("/");
    for (const who of ["earlier0", null, "partway"]) {
      signedIn = who;
      const html = await arrive("/?joined#season");
      expect(still(html)).toBe(standing);
      expect(html).toMatch(new RegExp(`^<div class="${home.setDown}">`));
    }
  });

  it("is not set down where the row does not stand for the Members Season 1 waits for", async () => {
    // Season 1 scheduled, with the sixteen standing until its first Matchday...
    seasons.set(1, { number: 1, start: "2026-11-29" });
    club(15);
    signedIn = "new";
    const scheduled = await arrive("/?joined#season");
    expect(scheduled).toContain("Next Matchday");
    expect(row(scheduled)).toEqual(places(16));
    expect(scheduled).not.toContain(home.moving);
    expect(scheduled).toMatch(new RegExp(`^<div class="${home.setDown}">`)); // `joined` is taken out of the address
    // ...and the six pieces of a Season after it.
    vi.setSystemTime(new Date("2026-11-30T12:00:00Z"));
    people.get("new")!.lichessConnectedAt = new Date(Date.now() - 5 * 60_000);
    const later = await arrive("/?joined#season");
    expect(later).toMatch(/%2Frow\.webp/);
    expect(later).not.toContain(home.moving);
    expect(later).toMatch(new RegExp(`^<div class="${home.setDown}">`));
  });
});

// The movement, as Chrome plays it from the page's own styles, with no script: the row as it was, then the pawn set down
// one square behind its place, a step straight forward into it, and stillness, the count cut to its new number as the
// pawn lands. The animations are paused and set to each moment in turn.
describe("the pawn being set down", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  beforeAll(async () => {
    browser = await chromium.launch({ channel: "chrome" });
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
  });

  // Season blocks with the styles they are shown with: globals.css, then ui.module.css and home.module.css with each
  // class named as the rendering names it, then any of the test's own.
  const page = (blocks: string[], own = "") => {
    const named = (file: string, classes: Record<string, string>) =>
      readFileSync(join(__dirname, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/url\([^)]*\)/g, "none")
        .replace(/\.([a-zA-Z][\w-]*)/g, (whole, name: string) => (classes[name] ? `.${classes[name]}` : whole));
    const css = [readFileSync(join(__dirname, "globals.css"), "utf8"), named("ui.module.css", ui), named("home.module.css", home), own];
    const seasons = blocks.map((block) => `<div class="${home.season}">${block}</div>`).join("");
    return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.join("\n")}</style><main>${seasons}</main>`;
  };

  // A tab showing a page, its pictures the files themselves.
  async function show(context: BrowserContext, html: string) {
    const tab = await context.newPage();
    await tab.route("http://offboard.test/**", (route) => {
      const photo = new URL(route.request().url()).searchParams.get("url");
      return photo
        ? route.fulfill({ contentType: "image/webp", body: readFileSync(join(__dirname, photo)) })
        : route.fulfill({ contentType: "text/html", body: html });
    });
    await tab.goto("http://offboard.test/");
    return tab;
  }

  type Moment = { pawn: boolean; behind: number; across: number; outline: boolean; count: string[]; lines: [number, number] };

  // How the arriving pawn stands at each moment (ms): whether it is shown, how far behind its place it is and how far to
  // one side, whether the outline it fills is shown, the count's words as seen, and how many lines those words take
  // beside how many lines of room the count has. Also one square's depth, how many animations there are, and how wide
  // the page is.
  async function play(width: number, reducedMotion: "reduce" | "no-preference", block: string, moments: number[]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 900, hasTouch: width < 900, reducedMotion });
    try {
      const tab = await show(context, page([block]));
      return await tab.evaluate(
        ({ moments, names }) => {
          const animations = document.getAnimations();
          for (const animation of animations) animation.pause();
          const ranks = document.querySelectorAll("ol > li");
          const square = ranks[8].getBoundingClientRect().top - ranks[0].getBoundingClientRect().top;
          const [outline, pawn] = document.querySelectorAll<HTMLElement>(`.${names.arriving} img`);
          const seen = (element: Element) => {
            const style = getComputedStyle(element);
            return style.visibility === "visible" && style.opacity === "1";
          };
          const words = [`.${names.was}`, `.${names.now}`].map((name) => document.querySelector<HTMLElement>(name)!);
          const count = words[0].parentElement!;
          const text = (element: Element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range;
          };
          const lines = (element: Element) => new Set([...text(element).getClientRects()].map((line) => Math.round(line.top))).size;
          const at = moments.map((time): Moment => {
            for (const animation of animations) animation.currentTime = time;
            const [to, from] = [outline.getBoundingClientRect(), pawn.getBoundingClientRect()];
            const shown = words.filter(seen);
            return {
              pawn: seen(pawn),
              behind: Math.round((from.top - to.top) * 100) / 100,
              across: Math.round((from.left - to.left) * 100) / 100,
              outline: seen(outline),
              count: shown.map((element) => element.textContent!),
              lines: [
                Math.max(...shown.map(lines)),
                Math.round(count.getBoundingClientRect().height / parseFloat(getComputedStyle(count).lineHeight)),
              ],
            };
          });
          return { square: Math.round(square * 100) / 100, animations: animations.length, wide: document.documentElement.scrollWidth, at };
        },
        { moments, names: { arriving: home.arriving, was: home.was, now: home.now } },
      );
    } finally {
      await context.close();
    }
  }

  // The new Member's pawn in the second row on a phone, where the square behind it is below the row, and in the first on
  // a desktop.
  const block = async (earlier: number) => {
    club(earlier);
    signedIn = "new";
    return arrive("/?joined#season");
  };
  const steps = Array.from({ length: 24 }, (_, i) => 1000 + i * 25);
  const count = (needed: number) => `${needed} more ${needed === 1 ? "Member" : "Members"} to go`;

  for (const [width, earlier] of [
    [390, 14],
    [1280, 2],
  ] as const) {
    it(`steps one square straight forward into the first empty outline and stops, the count cut as it lands, ${width} wide`, async () => {
      const [before, after] = [count(16 - earlier), count(15 - earlier)];
      const { square, animations, wide, at } = await play(width, "no-preference", await block(earlier), [0, 599, 600, 999, ...steps, 1599, 1600, 3000]);
      expect(animations).toBe(5);
      expect(wide).toBe(width);
      const [start, unset, setDown, held] = at;
      const [landing, landed, later] = at.slice(-3);
      // The row as it was.
      for (const moment of [start, unset]) expect(moment).toMatchObject({ pawn: false, outline: true, count: [before] });
      // The pawn set down one square behind, a pawn's depth and the gap between two rows, and held there.
      for (const moment of [setDown, held]) {
        expect(moment).toMatchObject({ pawn: true, across: 0, outline: true, count: [before] });
        expect(moment.behind).toBeCloseTo(square, 1);
      }
      // One step forward, straight, never past its place nor back, the pawn shown throughout: no fade.
      const stepping = at.slice(4, 4 + steps.length);
      for (const [i, moment] of stepping.entries()) {
        expect(moment).toMatchObject({ pawn: true, across: 0, outline: true, count: [before] });
        expect(moment.behind).toBeGreaterThanOrEqual(0);
        expect(moment.behind).toBeLessThanOrEqual(i === 0 ? square + 0.01 : stepping[i - 1].behind);
      }
      expect(stepping[12].behind).toBeCloseTo(square / 2, 0); // halfway at the middle of the step
      expect(landing).toMatchObject({ pawn: true, outline: true, count: [before] });
      // It lands: the outline and the old count are cut away, and the new count cut in. Then nothing moves.
      for (const moment of [landed, later]) expect(moment).toMatchObject({ pawn: true, behind: 0, across: 0, outline: false, count: [after] });
      // The count has room for the words it shows, and no more, throughout.
      for (const { lines } of at) expect(lines[1]).toBe(lines[0]);
    });

    it(`stands in its place from the start with reduced motion, the count saying the new number, ${width} wide`, async () => {
      const after = count(15 - earlier);
      const { animations, at } = await play(width, "reduce", await block(earlier), [0]);
      expect(animations).toBe(0);
      expect(at[0]).toEqual({ pawn: true, behind: 0, across: 0, outline: false, count: [after], lines: [at[0].lines[0], at[0].lines[0]] });
    });
  }

  // Each count cut to the next, 16 to 15 down to 2 to 1, at every width from 300 to 430 (#109), in one page beside each
  // count as a reload shows it. Just before the pawn lands a block is laid out as the old count is at rest, and just
  // after as a reload, so nothing below the count moves. A count at rest has room for its words and no more: two lines
  // under 377 wide, broken after "more", and one line from 377, where the longest fits in the serif. The serif next/font
  // names (app/layout.tsx) is not here: Arial stands in for it (Liberation Sans, with Arial's widths, on Linux), a
  // little narrower, so a count fits on one line wherever the serif's does. The movement is paused from the start, so
  // that it is there to be set to each moment however long the page takes to load.
  it("keeps the count's lines as the pawn lands, for every count at every width from 300 to 430", async () => {
    const cut: string[] = [];
    const reloaded = [await arrive("/")]; // nobody yet: 16
    for (let needed = 15; needed >= 1; needed--) {
      resetDb();
      club(15 - needed);
      signedIn = null;
      reloaded.push(await arrive("/"));
      signedIn = "new";
      cut.push(await arrive("/?joined#season"));
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
    try {
      const own = ':root { --font-bodoni: Arial, "Liberation Sans"; } * { animation-play-state: paused !important; }';
      const tab = await show(context, page([...cut, ...reloaded], own));
      const movement = await tab.evaluateHandle(() => document.getAnimations());
      for (let width = 300; width <= 430; width++) {
        await tab.setViewportSize({ width, height: 900 });
        const [held, landed, reload] = await tab.evaluate(
          ({ movement, names }) => {
            const seen = (element: Element) => {
              const style = getComputedStyle(element);
              return style.visibility === "visible" && style.opacity === "1";
            };
            // A block's count as seen, line by line; the lines of room it has; and how far below its top the row and the
            // words under it start and the block ends.
            const laid = (block: Element) => {
              const count = block.querySelector(`.${names.count}`)!;
              const text = ([...count.querySelectorAll("span")].find(seen) ?? count).firstChild as Text;
              const lines: string[] = [];
              let [top, at] = [-Infinity, 0];
              for (const word of text.data.split(" ")) {
                const range = document.createRange();
                range.setStart(text, at);
                range.setEnd(text, at + word.length);
                const y = range.getBoundingClientRect().top;
                lines.push(y > top + 1 ? word : `${lines.pop()} ${word}`);
                [top, at] = [y, at + word.length + 1];
              }
              const from = count.getBoundingClientRect();
              const below = (y: number) => Math.round((y - from.top) * 100) / 100;
              return {
                lines,
                room: Math.round(from.height / parseFloat(getComputedStyle(count).lineHeight)),
                below: [block.querySelector("ol")!, block.querySelector(`.${names.starts}`)!].map((element) => below(element.getBoundingClientRect().top)).concat(below(block.getBoundingClientRect().bottom)),
              };
            };
            const blocks = [...document.querySelectorAll(`.${names.season}`)];
            const at = (time: number) => {
              for (const animation of movement) animation.currentTime = time;
              return blocks.slice(0, 15).map(laid);
            };
            return [at(1599), at(1600), blocks.slice(15).map(laid)];
          },
          { movement, names: { season: home.season, count: home.count, starts: home.starts } },
        );
        for (let i = 0; i < 15; i++) {
          const pair = `${width} wide, ${16 - i} to ${15 - i}`;
          expect(landed[i].below, `${pair}: what follows the count moves`).toEqual(held[i].below);
          expect(held[i], `${pair}, before landing`).toEqual(reload[i]);
          expect(landed[i], `${pair}, landed`).toEqual(reload[i + 1]);
        }
        for (const [i, { lines, room }] of reload.entries()) {
          const words = count(16 - i);
          const more = words.slice(0, words.indexOf(" more") + 5);
          expect(lines, `${width} wide, ${words}`).toEqual(width < 377 ? [more, words.slice(more.length + 1)] : [words]);
          expect(room, `${width} wide, ${words}`).toBe(lines.length);
        }
      }
    } finally {
      await context.close();
    }
  }, 60_000);
});
