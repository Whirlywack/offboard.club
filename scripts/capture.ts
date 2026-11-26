// Photographs every page of the site in every state design/inventory.json lists, at a phone's width and a desktop's, and
// writes the images and a page that shows them, with what each page is for, to .capture/, which git ignores.
//
//   pnpm capture                      every state, in a few minutes
//   pnpm capture <page or state> ...  only those: a page by its id (`recap`), a state by its name (`recap-member`), for
//                                     a before and an after; the page shows the rest from earlier runs
//
// design/inventory.json is the one list: each page of the site with what it is for, and each of its states with the seed
// scenario it is taken in (`seed`), who is signed in (`as`, a seeded person's id; a visitor without), its address
// (`path`), and the clicks that reach it (`steps`). A new page or state is added there alone. scripts/capture.test.ts
// checks that every page the site has is in it.
//
// It works in a copy of this checkout (its tracked files as they are now and the untracked ones git does not ignore),
// with a throwaway Postgres and a local site of its own, from that copy's pnpm db:start, pnpm dev:local, pnpm seed and
// pnpm seed:cookies, as pnpm check does, and stops them and removes the copy however it ends. This checkout's site,
// databases and .env.local are not touched, so the main checkout can run it too. A state with `databaseStopped` is taken
// with that Postgres stopped; one with `minutesIntoLatestMatchday` with that site's clock moved to so many minutes after
// the latest Matchday's start (scripts/capture-clock.cjs).
//
// The phone is 390 x 844 at a device scale of 3, mobile and touch, as an iPhone of that width renders a page; the
// desktop 1280 x 800. Every request but the local site's is answered with a blank page, so nothing real is reached. The
// browser is Google Chrome, which must be installed: Playwright's library is a dev dependency and downloads no browser.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright-core";
import { cleanUp, copyCheckout, git, root, run, SCENARIOS, scratch, start, tail } from "./check.mjs";
import { addDays, latestSunday, matchdayStart } from "@/lib/schedule";

type Step = { fill?: string; value?: string; click?: string; waitFor?: string };
export type State = {
  name: string;
  label: string;
  seed: string;
  as?: string;
  path: string;
  steps?: Step[];
  databaseStopped?: boolean;
  minutesIntoLatestMatchday?: number;
  note?: string;
};
export type InventoryPage = {
  id: string;
  route: string;
  name: string;
  group: string;
  who: string;
  purpose: string;
  should_be_able_to: string;
  on_it_now?: string[];
  leads_from?: string[];
  leads_to?: string[];
  phone_facts?: string[];
  differs_from_spec?: string[];
  states: State[];
};
export const inventory: { shared: Record<string, unknown>; pages: InventoryPage[] } = JSON.parse(
  readFileSync(join(root, "design/inventory.json"), "utf8"),
);
const OUT = join(root, ".capture");
// A seeded person's session cookie, as pnpm seed:cookies writes it.
type Cookie = Parameters<BrowserContext["addCookies"]>[0][number];

// The states named, by page id or state name, or every state when none is; a line saying what is wrong otherwise.
export function chosen(names: string[]): State[] | string {
  const named = (page: InventoryPage) => page.states.filter((state) => !names.length || names.includes(page.id) || names.includes(state.name));
  const known = inventory.pages.flatMap((page) => [page.id, ...page.states.map((state) => state.name)]);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length)
    return `No page or state is called ${unknown.join(", ")}. Pages: ${inventory.pages.map((page) => page.id).join(", ")}; each state's name is in design/inventory.json.`;
  return inventory.pages.flatMap(named);
}

// A state's address on the day it is taken: {sunday} is the latest Sunday whose Matchday has started, and {sunday-N} the
// Sunday N weeks before it, as the seed dates every scenario from the day it runs.
export const address = (path: string, now: Date) =>
  path.replace(/\{sunday(?:-(\d+))?\}/g, (_, weeks?: string) => addDays(latestSunday(now), -7 * Number(weeks ?? 0)));

// The site's clock for a state: so many minutes after the latest Matchday's start, or the real one (null).
const clockFor = (state: State, now: Date) =>
  state.minutesIntoLatestMatchday === undefined
    ? null
    : new Date(matchdayStart(latestSunday(now)).getTime() + state.minutesIntoLatestMatchday * 60_000).toISOString();

const SIZES: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
const STAND_IN = "<!doctype html><body style='margin:0;display:grid;place-items:center;height:100vh;background:#ddd;font:14px sans-serif'>Not loaded: pnpm capture reaches nothing but the local site";

// Whether every part React streams into the page has arrived: it keeps a <template id="B:n"> for each Suspense boundary
// until then, and marks one still to come with a comment, <!--$?-->, or <!--$~--> while `next dev` fetches it after the
// page has loaded.
function streamed() {
  const comments = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  for (let node = comments.nextNode(); node; node = comments.nextNode()) if (node.nodeValue === "$?" || node.nodeValue === "$~") return false;
  return !document.querySelector('template[id^="B:"]');
}

// The page once every part React streams has arrived, the text has stopped changing, a refresh has taken it where it
// goes, the fonts have loaded and the animations have finished.
async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForFunction(streamed, null, { timeout: 60_000 });
  let last = "";
  for (let i = 0; i < 25; i++) {
    const now = await page
      .evaluate(() => `${document.body.innerText.length}:${document.documentElement.scrollHeight}:${location.href}`)
      .catch(() => "navigating");
    if (now === last) break;
    last = now;
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(streamed, null, { timeout: 60_000 }); // again, after a refresh
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.evaluate(() =>
    Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))), new Promise((done) => setTimeout(done, 3000))]),
  );
}

// Both images of one state, one after the other: the first may wait for `next dev` to compile the page, and a page it
// has just compiled can reload itself under the browser, so each is tried a second time.
async function photograph(browser: Browser, site: string, cookies: Record<string, Cookie>, state: State) {
  for (const size of Object.keys(SIZES)) {
    const take = () => image(browser, new URL(site).origin, cookies[state.as ?? ""], state, size);
    await take().catch(take);
  }
}

async function image(browser: Browser, origin: string, cookie: Cookie | undefined, state: State, size: string) {
  const context = await browser.newContext({ ...SIZES[size], colorScheme: "light", locale: "en-GB", timezoneId: "Europe/Vilnius" });
  try {
    await context.route((url) => url.origin !== origin, (route) => route.fulfill({ status: 200, contentType: "text/html", body: STAND_IN }));
    if (state.as) await context.addCookies([cookie!]);
    const page = await context.newPage();
    await page.goto(origin + address(state.path, new Date()), { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle(page);
    for (const step of state.steps ?? []) {
      if (step.fill) await page.locator(step.fill).fill(step.value ?? "");
      if (step.click) await page.locator(step.click).first().click();
      if (step.waitFor) await page.locator(step.waitFor).first().waitFor({ timeout: 30_000 });
      await settle(page);
    }
    // Next.js's development badge is not part of the site.
    const path = join(OUT, `${state.name}-${size}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled", style: "nextjs-portal { display: none !important; }" });
  } finally {
    await context.close();
  }
}

async function capture(states: State[]): Promise<number> {
  const began = Date.now();
  mkdirSync(OUT, { recursive: true });
  const folder = scratch("capture");
  const checkout = join(folder, "checkout");
  const log = join(folder, "capture.log");
  // What the copy starts is listed and stopped with the rest of this repository's (pnpm local:list).
  const recorded = { OFFBOARD_LOCAL_REGISTRY: `${git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()}/offboard-local` };
  const pnpm = async (...args: string[]) => {
    if ((await run("pnpm", args, { cwd: checkout, log, env: recorded })) !== 0) throw new Error(`pnpm ${args.join(" ")} failed:\n${tail(log)}`);
  };
  const dir = join(folder, "db-capture"); // a db- folder, which the clean-up stops
  let browser: Browser | undefined;
  let site: ReturnType<typeof start> | undefined;
  const failed: string[] = [];
  try {
    console.log(`pnpm capture: ${states.length} states, in a copy of this checkout at ${checkout}`);
    copyCheckout(checkout);
    await pnpm("install", "--frozen-lockfile", "--prefer-offline");
    await pnpm("db:start", "--dir", dir);
    const url = /^BETTER_AUTH_URL=(.*)$/m.exec(readFileSync(join(dir, "offboard.env"), "utf8"))![1];
    browser = await chromium.launch({ channel: "chrome" }).catch((error: Error) => {
      throw new Error(`Google Chrome could not be started, and pnpm capture photographs in it: ${error.message.split("\n")[0]}`);
    });
    // Those on the real clock first, then those on a moved one, then those with the database stopped, each by seed, so
    // that the site is started again and the database stopped as seldom as can be.
    const rank = (state: State) =>
      (state.databaseStopped ? 2 : state.minutesIntoLatestMatchday === undefined ? 0 : 1) * SCENARIOS.length + SCENARIOS.indexOf(state.seed);
    let seeded: string | null = null;
    let clock: string | null | undefined;
    let databaseUp = true;
    let cookies: Record<string, Cookie> = {};
    for (const state of [...states].sort((a, b) => rank(a) - rank(b))) {
      if (state.seed !== seeded) {
        if (!databaseUp) await pnpm("db:start", "--dir", dir);
        databaseUp = true;
        console.log(`Seeding ${state.seed}`);
        await pnpm("seed", state.seed);
        await pnpm("seed:cookies");
        cookies = JSON.parse(readFileSync(join(dir, "cookies.json"), "utf8"));
        seeded = state.seed;
      }
      const wanted = clockFor(state, new Date());
      if (site === undefined || wanted !== clock) {
        await site?.stop();
        const moved = wanted ? { NODE_OPTIONS: `--require ${join(checkout, "scripts/capture-clock.cjs")}`, CAPTURE_NOW: wanted } : {};
        site = start("pnpm", ["dev:local", "--dir", dir], { cwd: checkout, log: join(folder, "site.log"), env: { ...recorded, ...moved }, limit: 3 * 3_600_000 });
        clock = wanted;
        for (let tries = 0; !(await fetch(`${url}/api/health`).then(() => true, () => false)); tries++) {
          if (tries === 600) throw new Error(`The local site did not answer in 2 minutes:\n${tail(join(folder, "site.log"))}`);
          await new Promise((done) => setTimeout(done, 200));
        }
        if (wanted) console.log(`The local site's clock is at ${wanted}`);
      }
      if (state.databaseStopped && databaseUp) await pnpm("db:stop", "--dir", dir);
      if (state.databaseStopped) databaseUp = false;
      else if (!databaseUp) {
        await pnpm("db:start", "--dir", dir);
        databaseUp = true;
      }
      try {
        await photograph(browser, url, cookies, state);
        console.log(`✓ ${state.name}`);
      } catch (error) {
        failed.push(state.name);
        console.log(`✗ ${state.name}: ${(error as Error).message.split("\n")[0]}`);
      }
    }
  } finally {
    await browser?.close();
    await site?.stop();
    cleanUp(folder);
  }
  writeFileSync(join(OUT, "index.html"), inventoryPage());
  console.log(
    `${states.length - failed.length} of ${states.length} states photographed in ${Math.round((Date.now() - began) / 1000)} s${failed.length ? `; failed: ${failed.join(", ")}` : ""}. The page: ${join(OUT, "index.html")}`,
  );
  return failed.length ? 1 : 0;
}

const escape = (value: unknown) => String(value).replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
// Escaped, with `code` kept as code.
const words = (value: unknown) => escape(value).replace(/`([^`]+)`/g, "<code>$1</code>");
const GROUPS: [string, string, string][] = [
  ["public", "Public", "Anyone can open these."],
  ["signing up", "Signing up", "The steps between LinkedIn sign-in and being a Member."],
  ["Members", "Members", "Signed-in Members only."],
  ["Organiser", "Organiser", "Only the Organiser. To anyone else these addresses do not exist."],
  ["system", "Missing or broken", "What the site shows for an address it does not have, or when a page fails."],
];

// The page of every page and state, with the images that are in .capture/, from this run or an earlier one.
export function inventoryPage() {
  const list = (title: string, items?: string[]) =>
    items?.length ? `<details><summary>${title}</summary><ul>${items.map((item) => `<li>${words(item)}</li>`).join("")}</ul></details>` : "";
  const image = (state: State, size: string) =>
    existsSync(join(OUT, `${state.name}-${size}.png`))
      ? `<a href="${state.name}-${size}.png"><img class="${size}" src="${state.name}-${size}.png" alt="${escape(state.label)}, at ${size} width" loading="lazy"></a>`
      : `<p class="missing">Not photographed yet: <code>pnpm capture ${state.name}</code></p>`;
  const state = (s: State) => `
<figure id="${s.name}">
  <figcaption><strong>${words(s.label)}</strong> <code>${s.name}</code><br>${s.as ? `As <code>${s.as}</code>` : "A visitor"}, seed <code>${s.seed}</code>, <code>${escape(s.path)}</code>${s.databaseStopped ? ", the database stopped" : ""}${s.minutesIntoLatestMatchday === undefined ? "" : `, ${s.minutesIntoLatestMatchday} minutes into the latest Matchday`}${s.note ? `<br>${words(s.note)}` : ""}</figcaption>
  <div>${image(s, "phone")}${image(s, "desktop")}</div>
</figure>`;
  const page = (p: InventoryPage) => `
<section id="${p.id}">
<h3>${words(p.name)}</h3>
<p><code>${escape(p.route)}</code>, <code>pnpm capture ${p.id}</code></p>
<p>${words(p.purpose)}</p>
<p><strong>They should be able to:</strong> ${words(p.should_be_able_to)}</p>
<details><summary>Who can open it</summary><p>${words(p.who)}</p></details>
${list("On it now, top to bottom", p.on_it_now)}
${list("Ways in", p.leads_from)}
${list("Ways out", p.leads_to)}
${list("On a phone, measured on 25 November 2026", p.phone_facts)}
${list("Differs from the spec", p.differs_from_spec)}
${p.states.map(state).join("")}
</section>`;
  const shared = Object.entries(inventory.shared).map(([key, value]) => {
    const body =
      typeof value === "string" ? `<p>${words(value)}</p>`
      : Array.isArray(value) ? `<ul>${value.map((item) => `<li>${words(item)}</li>`).join("")}</ul>`
      : Object.entries(value as Record<string, unknown>).map(([k, v]) => `<p><strong>${escape(k.replaceAll("_", " "))}:</strong></p>${Array.isArray(v) ? `<ul>${v.map((item) => `<li>${words(item)}</li>`).join("")}</ul>` : `<p>${words(v)}</p>`}`).join("");
    return `<details><summary>${escape(key.replaceAll("_", " "))}</summary>${body}</details>`;
  });
  const states = inventory.pages.reduce((n, p) => n + p.states.length, 0);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offboard, page by page</title>
<style>
body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 1400px; }
figure { margin: 24px 0; }
figure div { display: flex; gap: 16px; align-items: flex-start; overflow-x: auto; }
figure a { flex: none; max-height: 560px; overflow: hidden; }
img { border: 1px solid #ccc; display: block; height: auto; }
img.phone { width: 260px; }
img.desktop { width: 640px; }
.missing { color: #777; }
</style>
<h1>Offboard, page by page</h1>
<p>${inventory.pages.length} pages in ${states} states, each at phone and desktop width, from <code>pnpm capture</code>. Each image is from the latest run that took it. Open one for the whole page.</p>
<nav><ul>${GROUPS.map(([key, title]) => `<li><a href="#${key.replace(" ", "-")}">${title}</a>: ${inventory.pages.filter((p) => p.group === key).map((p) => `<a href="#${p.id}">${words(p.name)}</a>`).join(", ")}</li>`).join("")}</ul></nav>
${GROUPS.map(([key, title, blurb]) => `<h2 id="${key.replace(" ", "-")}">${title}</h2>\n<p>${blurb}</p>${inventory.pages.filter((p) => p.group === key).map(page).join("")}`).join("\n")}
<h2>What every page shares</h2>
${shared.join("\n")}
</html>
`;
}

// Run, not imported: scripts/capture.test.ts imports what is exported above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const states = chosen(process.argv.slice(2));
  if (typeof states === "string") {
    console.error(states);
    process.exit(1);
  }
  capture(states).then(
    (code) => process.exit(code),
    (error: Error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
