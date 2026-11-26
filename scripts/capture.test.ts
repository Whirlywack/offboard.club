// pnpm capture (scripts/capture.ts) and the one list it reads, design/inventory.json: every page the site has is on the
// list, each state is named for its page and taken in a seed scenario, a run takes only the pages and states named, a
// Recap's address follows the day it is taken on, its browser is a phone or a desktop that reaches only the local site,
// the clock it moves for one state moves, and the page it writes shows every state. Taking the pictures takes a few
// minutes, so that is not done here: run pnpm capture.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, relative } from "node:path";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { address, browserFor, chosen, inventory, inventoryPage } from "./capture";
import { root, SCENARIOS } from "./check.mjs";

const states = inventory.pages.flatMap((page) => page.states);
const addressOf = (server: Server) => `http://127.0.0.1:${(server.address() as { port: number }).port}`;

// Each page.tsx under app/, as its address: app/recaps/[date]/page.tsx is /recaps/[date].
const pagesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? pagesIn(join(dir, entry.name)) : /^page\.tsx?$/.test(entry.name) ? [`/${relative(join(root, "app"), dir)}`.replace(/\/$/, "") || "/"] : [],
  );

describe("the list of pages and states", () => {
  it("has every page the site has, and no other, besides pages in brackets for what has no address of its own", () => {
    const listed = inventory.pages.map((page) => page.route);
    expect(listed.filter((route) => route.startsWith("/")).sort()).toEqual(pagesIn(join(root, "app")).sort());
    for (const route of listed.filter((route) => !route.startsWith("/"))) expect(route).toMatch(/^\(.+\)$/);
  });

  it("names each state for its page, once, and takes it in a scenario the seed has", () => {
    const ids = inventory.pages.map((page) => page.id);
    expect(new Set([...ids, ...states.map((state) => state.name)]).size).toBe(ids.length + states.length);
    for (const page of inventory.pages) {
      expect(page.states.length).toBeGreaterThan(0);
      for (const state of page.states) {
        expect(state.name).toMatch(new RegExp(`^${page.id}-[a-z0-9-]+$`));
        expect(SCENARIOS).toContain(state.seed);
        expect(state.path).toMatch(/^\//);
      }
    }
  });
});

describe("a run", () => {
  it("takes every state when nothing is named", () => {
    expect(chosen([])).toEqual(states);
  });

  it("takes only the pages and states named: a page by its id, a state by its name", () => {
    const statesOf = (id: string) => inventory.pages.find((page) => page.id === id)!.states;
    expect(chosen(["recap"])).toEqual(statesOf("recap"));
    expect(chosen(["privacy", "recap-member"])).toEqual([...statesOf("privacy"), statesOf("recap").find((state) => state.name === "recap-member")]);
  });

  it("is refused for a name that is neither, before anything is started", () => {
    expect(chosen(["recap", "recap-nobody"])).toMatch(/^No page or state is called recap-nobody\. Pages: (.+, )?recap, /);
  });
});

describe("a state's address", () => {
  it("names the Sundays the seed dates from the day it is taken on", () => {
    const wednesday = new Date("2026-11-25T12:00:00Z");
    expect(address("/recaps/{sunday-1}", wednesday)).toBe("/recaps/2026-11-15");
    expect(address("/recaps/{sunday}", wednesday)).toBe("/recaps/2026-11-22");
    // 19:59 and 20:01 in Vilnius, on a Sunday: the latest Sunday is that one once its Matchday has started.
    expect(address("/recaps/{sunday}", new Date("2026-11-29T17:59:00Z"))).toBe("/recaps/2026-11-22");
    expect(address("/recaps/{sunday-2}", new Date("2026-11-29T18:01:00Z"))).toBe("/recaps/2026-11-15");
    expect(address("/profiles/ana?games=all", wednesday)).toBe("/profiles/ana?games=all");
  });
});

// Capture's browser, Google Chrome as capture starts it, on a page served here: the site at one address, and "outside"
// at another, which stands for every other site and must hear nothing.
describe("capture's browser", () => {
  it("is a phone 390 wide, or a desktop, and reaches nothing but the local site", async () => {
    let outsideHeard = 0;
    const outside = createServer((_, res) => (outsideHeard++, res.end("outside")));
    const site = createServer((_, res) =>
      res.setHeader("content-type", "text/html").end(`<meta name="viewport" content="width=device-width, initial-scale=1"><iframe src="${addressOf(outside)}/board"></iframe>`),
    );
    await Promise.all([outside, site].map((server) => new Promise((done) => server.listen(0, "127.0.0.1", () => done(null)))));
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      for (const [size, seen] of [["phone", [390, 3, true]], ["desktop", [1280, 1, false]]] as const) {
        const context = await browserFor(browser, addressOf(site), size);
        const page = await context.newPage();
        await page.goto(`${addressOf(site)}/`);
        expect(await page.evaluate(() => [innerWidth, devicePixelRatio, matchMedia("(pointer: coarse)").matches])).toEqual(seen);
        expect(await page.frameLocator("iframe").locator("body").innerText()).toBe("Not loaded: pnpm capture reaches nothing but the local site");
        await context.close();
      }
    } finally {
      await browser.close();
      for (const server of [outside, site]) server.close();
    }
    expect(outsideHeard).toBe(0);
  }, 30_000);
});

describe("the clock capture moves", () => {
  const now = (CAPTURE_NOW: string) =>
    spawnSync(process.execPath, ["--require", join(root, "scripts/capture-clock.cjs"), "-e", "console.log(new Date().toISOString())"], {
      env: { ...process.env, CAPTURE_NOW },
      encoding: "utf8",
    });

  it("is moved to CAPTURE_NOW, and on from there", () => {
    const { status, stdout } = now("2026-11-22T18:40:00Z");
    expect(status).toBe(0);
    const ahead = Date.parse(stdout.trim()) - Date.parse("2026-11-22T18:40:00Z");
    expect(ahead).toBeGreaterThanOrEqual(0);
    expect(ahead).toBeLessThan(5_000);
  });

  it("is not moved, and the site not started, by a CAPTURE_NOW that is not a time", () => {
    const { status, stderr } = now("Sunday evening");
    expect(status).toBe(1);
    expect(stderr).toContain("CAPTURE_NOW is not a time: Sunday evening");
  });
});

describe("the page a run writes", () => {
  it("shows every page with what it is for, and every state, its images or how to take them", () => {
    const html = inventoryPage();
    for (const page of inventory.pages) expect(html).toContain(`<section id="${page.id}">`);
    for (const state of states)
      expect(html).toMatch(new RegExp(`<figure id="${state.name}">[^]*?(src="${state.name}-phone\\.png"|Not photographed yet: <code>pnpm capture ${state.name}</code>)`));
  });
});
