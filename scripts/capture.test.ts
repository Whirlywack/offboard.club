// pnpm capture (scripts/capture.ts) and the one list it reads, design/inventory.json: every page the site has is on the
// list, each state is named for its page and taken in a seed scenario, a run takes only the pages and states named, a
// Recap's address follows the day it is taken on, and the page it writes shows every state. Taking the pictures needs
// Google Chrome and a few minutes, so that is not done here: run pnpm capture.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { address, chosen, inventory, inventoryPage } from "./capture";
import { root, SCENARIOS } from "./check.mjs";

const states = inventory.pages.flatMap((page) => page.states);

// Each page.tsx under app/, as its address: app/recaps/[date]/page.tsx is /recaps/[date].
const pagesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? pagesIn(join(dir, entry.name)) : /^page\.tsx?$/.test(entry.name) ? [`/${relative(join(root, "app"), dir)}`.replace(/\/$/, "") || "/"] : [],
  );

describe("the list of pages and states", () => {
  it("has every page the site has, and no other, besides the pages for a missing address and a failure", () => {
    const listed = inventory.pages.map((page) => page.route);
    expect(listed.filter((route) => route.startsWith("/")).sort()).toEqual(pagesIn(join(root, "app")).sort());
    expect(listed.filter((route) => !route.startsWith("/"))).toEqual(["(any address the site does not have)", "(any page that fails while rendering)"]);
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
    expect(states.length).toBe(59);
  });

  it("takes only the pages and states named: a page by its id, a state by its name", () => {
    const recap = inventory.pages.find((page) => page.id === "recap")!.states;
    expect(chosen(["recap"])).toEqual(recap);
    expect((chosen(["privacy", "recap-member"]) as typeof states).map((state) => state.name)).toEqual(["privacy-visitor", "recap-member"]);
  });

  it("is refused for a name that is neither, before anything is started", () => {
    expect(chosen(["recap", "recap-nobody"])).toMatch(/^No page or state is called recap-nobody\. Pages: home, privacy, seasons, /);
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

describe("the page a run writes", () => {
  it("shows every page with what it is for, and every state, its images or how to take them", () => {
    const html = inventoryPage();
    for (const page of inventory.pages) expect(html).toContain(`<section id="${page.id}">`);
    for (const state of states)
      expect(html).toMatch(new RegExp(`<figure id="${state.name}">[^]*?(src="${state.name}-phone\\.png"|Not photographed yet: <code>pnpm capture ${state.name}</code>)`));
  });
});
