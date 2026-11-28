// The Profile form (Edit your Profile, and the sign-up step after connecting Lichess) as it comes back from a refused
// save: what is wrong with each wrong field is said beside that field, tied to it for a screen reader, the first of
// them from the top takes the focus, and what was typed is kept. The save is the server's own (saveProfile), with the
// session, the database and the fetch of a Company's website faked; what it hands back is given to the form as
// useActionState would.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProfile, type ProfileFormState } from "./actions";
import styles from "./profile/profile.module.css";
import { ProfileForm } from "./profile/profile-form";
import ui from "./ui.module.css";
import WelcomeProfile, { Step } from "./welcome/profile/page";
import welcome from "./welcome/welcome.module.css";
import { fetchCompanyMeta } from "@/lib/company";
import { addPerson, db, people, resetDb } from "@/lib/fake-db";
import { OPEN_TO_MAX, POSITION_MAX } from "@/lib/profile";

// The form's hooks as React runs them for one form on a page: the save's answer and whether one is under way; what each
// later hook keeps from one drawing of the form to the next, a ref or an effect's dependencies, in the order they are
// called, from useActionState, the first; and the effects due once a drawing is on the page, as React runs an effect
// when the form first shows and again only when its dependencies change.
const hooks = vi.hoisted(() => ({
  state: null as ProfileFormState,
  pending: false,
  kept: [] as unknown[],
  next: 0,
  due: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: () => {
    hooks.next = 0;
    return [hooks.state, () => {}, hooks.pending];
  },
  useRef: (initial: unknown) => (hooks.kept[hooks.next++] ??= { current: initial }),
  useEffect: (effect: () => void, deps?: unknown[]) => {
    const before = hooks.kept[hooks.next] as unknown[] | undefined;
    hooks.kept[hooks.next++] = deps;
    if (!deps || !before || deps.some((dep, i) => !Object.is(dep, before[i]))) hooks.due.push(effect);
  },
}));
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));
vi.mock("@/lib/company", async (original) => ({
  ...(await original<typeof import("@/lib/company")>()),
  fetchCompanyMeta: vi.fn(),
}));

const fields = ["companyWebsite", "position", "linkedInUrl", "openTo"] as const;
const typed = { companyWebsite: "example.com", position: "Backend engineer", linkedInUrl: "", openTo: "" };

beforeEach(() => {
  resetDb();
  addPerson("ana", { position: "CTO" });
  getSession.mockReset().mockResolvedValue({ user: { ...people.get("ana") } });
  // A page loaded afresh.
  Object.assign(hooks, { state: null, pending: false, kept: [], due: [] });
});

// What the server answers a Member who saved `changes`, which it refused.
async function answer(changes: Partial<typeof typed>) {
  const sent = new FormData();
  for (const [name, value] of Object.entries({ ...typed, ...changes })) sent.set(name, value);
  const state = await saveProfile(null, sent);
  if (!state) throw new Error("expected a refusal");
  return state;
}

// The form given that answer, on the edit page or the sign-up step.
async function refused(changes: Partial<typeof typed>, welcome = false) {
  hooks.state = await answer(changes);
  return { html: renderToStaticMarkup(createElement(ProfileForm, { saved: null, welcome })), problems: hooks.state.problems };
}

// Each field's control, and what comes just before it.
const control = (html: string, id: string) => html.match(new RegExp(`(<p[^>]*>[^<]*</p>)?<(input|textarea)[^>]*id="${id}"[^>]*>`))!;
const text = (html: string) => html.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');

// An element of the form as its component returns it, found by its type.
type Drawn = { type: unknown; props: { children?: unknown; onKeyDown?: (event: unknown) => void; ref?: { current: unknown } } };
const find = (node: unknown, type: string): Drawn | undefined => {
  if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  return (node as Drawn).type === type ? (node as Drawn) : find((node as Drawn).props.children, type);
};

describe("a refused Profile", () => {
  it.each([
    ["companyWebsite", { companyWebsite: "localhost" }],
    ["position", { position: "p".repeat(POSITION_MAX + 1) }],
    ["linkedInUrl", { linkedInUrl: "example.com/ana" }],
    ["openTo", { openTo: "o".repeat(OPEN_TO_MAX + 1) }],
  ] as const)("says what is wrong with %s just above it, and marks that field alone", async (id, changes) => {
    const { html, problems } = await refused(changes);
    expect(Object.keys(problems)).toEqual([id]);
    const [field, before] = control(html, id);
    expect(before).toMatch(new RegExp(`^<p id="${id}-error" role="alert"`));
    expect(text(before)).toBe(problems[id]);
    expect(field).toContain('aria-invalid="true"');
    expect(field).toMatch(new RegExp(`aria-describedby="[^"]*${id}-error"`));
    for (const other of fields.filter((name) => name !== id)) expect(control(html, other)[0]).not.toContain("aria-invalid");
    expect(html.match(/role="alert"/g)).toHaveLength(1);
  });

  it.each([
    ["a Company website and a LinkedIn link", { companyWebsite: "not a website", linkedInUrl: "my linkedin" }],
    [
      "every field",
      { companyWebsite: "localhost", position: "p".repeat(POSITION_MAX + 1), linkedInUrl: "my linkedin", openTo: "o".repeat(OPEN_TO_MAX + 1) },
    ],
  ] as const)(
    "says what is wrong with %s at once, each just above its own field and tied to it, on both pages, and saves nothing",
    async (_, changes) => {
      const wrong = Object.keys(changes);
      for (const welcome of [true, false]) {
        const { html, problems } = await refused(changes, welcome);
        expect(Object.keys(problems).sort()).toEqual([...wrong].sort());
        for (const id of fields) {
          const [field, before] = control(html, id);
          if (!wrong.includes(id)) {
            expect(field).not.toContain("aria-invalid");
            continue;
          }
          expect(before).toMatch(new RegExp(`^<p id="${id}-error" role="alert"`));
          expect(text(before)).toBe(problems[id]);
          expect(field).toContain('aria-invalid="true"');
          expect(field).toMatch(new RegExp(`aria-describedby="[^"]*${id}-error"`));
        }
        expect(html.match(/role="alert"/g)).toHaveLength(wrong.length);
        // What was typed in every field is kept.
        expect(html).toContain(`value="${changes.companyWebsite}"`);
        expect(html).toContain('value="my linkedin"');
      }
      expect(db.query).not.toHaveBeenCalled();
      expect(fetchCompanyMeta).not.toHaveBeenCalled();
      expect(people.get("ana")).toMatchObject({ position: "CTO", companyDomain: null, linkedInUrl: null });
    },
  );

  it("keeps what was typed, the open-to line in a box of four lines", async () => {
    const openTo = `A coffee & "talks" ${"o".repeat(OPEN_TO_MAX)}`;
    const { html } = await refused({ openTo });
    expect(html).toMatch(/<textarea[^>]*id="openTo"[^>]*rows="4"[^>]*>A coffee &amp; &quot;talks&quot; o+<\/textarea>/);
    expect(html).toContain('value="Backend engineer"');
  });

  // As when the site is deployed, or rolled back, between the page's loading and its save.
  it("keeps what was typed when the answer has the shape the code before #111 gave it", () => {
    hooks.state = { problem: "That isn't a LinkedIn profile address.", typed: { ...typed, linkedInUrl: "my linkedin" } } as never;
    expect(renderToStaticMarkup(createElement(ProfileForm, { saved: null }))).toContain('value="my linkedin"');
  });
});

// Where the focus goes once the form is drawn again, on the sign-up step on a phone scrolled down to its button, as after
// a tap on it. The page is the server's, with its own styles, in Google Chrome. The form's script runs as React runs it,
// given a stand-in for the form element that notes what is read from it and called on it, and from what those give;
// the same is then done to the form in Chrome.
describe("the focus after a save", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  beforeAll(async () => {
    vi.stubEnv("TELEGRAM_INVITE_LINK", "https://t.me/+a-pretend-invite");
    browser = await chromium.launch({ channel: "chrome", timeout: 180_000 });
  }, 0);
  afterEach(async () => {
    await context?.close();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await browser?.close();
  });

  // The sign-up step, its Profile form as the last save left it, with globals.css and each CSS Module it uses, each
  // class named as the rendering names it.
  async function signUpStep() {
    const shell = WelcomeProfile();
    const html = `<main class="${shell.props.className}">${renderToStaticMarkup(shell.props.children[0])}${renderToStaticMarkup(await Step())}</main>`;
    const named = (file: string, classes: Record<string, string>) =>
      readFileSync(join(__dirname, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/url\([^)]*\)/g, "none")
        .replace(/\.([a-zA-Z][\w-]*)/g, (whole, name: string) => (classes[name] ? `.${classes[name]}` : whole));
    const css = [
      readFileSync(join(__dirname, "globals.css"), "utf8"),
      named("ui.module.css", ui),
      named("welcome/welcome.module.css", welcome),
      named("profile/profile.module.css", styles),
    ];
    return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.join("\n")}</style>${html}`;
  }

  // A phone with the sign-up step open. `draw` draws the page with the save's answer, and shows it scrolled down to its
  // button when it changed (React would change it in place); `run` runs the form's script where React would; `seen` says
  // what has the focus, whether the screen moved since the page was shown, and whether it shows that field's label,
  // the message saying what is wrong with it, and its box.
  async function phone() {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const tab = await context.newPage();
    let shown = "";
    let at = 0;
    return {
      tab,
      async draw(state: ProfileFormState) {
        hooks.state = state;
        const page = await signUpStep();
        if (page === shown) return;
        shown = page;
        await tab.setContent(page);
        at = await tab.evaluate(() => {
          scrollTo(0, document.documentElement.scrollHeight);
          return scrollY;
        });
      },
      async run() {
        type Step = { from: number; get?: string; args?: unknown[] };
        const steps: Step[] = [];
        const noted = (from: number): unknown =>
          new Proxy(() => {}, {
            get: (_, key) => noted(steps.push({ from, get: String(key) })),
            apply: (_, __, args) => noted(steps.push({ from, args })),
          });
        // React gives the form's ref the form element.
        find(ProfileForm({ saved: null }), "form")!.props.ref!.current = noted(0);
        for (const effect of hooks.due.splice(0)) effect();
        // Each step reads from, or calls, what an earlier one gave, the form first; from nothing it gives nothing, as `?.`.
        await tab.evaluate((steps) => {
          const given: unknown[] = [document.querySelector("form")];
          const from: unknown[] = [null];
          for (const step of steps) {
            const value = given[step.from] as Record<string, unknown> & ((...args: unknown[]) => unknown);
            from.push(value);
            given.push(value == null ? value : step.get !== undefined ? value[step.get] : value.apply(from[step.from], step.args!));
          }
        }, steps);
      },
      seen: () =>
        tab.evaluate((at) => {
          const inView = (element: Element | null) => {
            const box = element?.getBoundingClientRect();
            return !!box && box.top >= 0 && box.bottom <= innerHeight;
          };
          const focused = document.activeElement!;
          return {
            focused: focused.id || focused.tagName,
            moved: scrollY !== at,
            shows: focused.id ? [document.querySelector(`label[for="${focused.id}"]`), document.getElementById(`${focused.id}-error`), focused].map(inView) : [],
          };
        }, at),
    };
  }

  // The page loaded with the form empty, then the save's answer drawn.
  async function saved(changes: Partial<typeof typed>) {
    const step = await phone();
    await step.draw(null);
    await step.run();
    await step.draw(await answer(changes));
    await step.run();
    return step;
  }

  it("goes to the first wrong field from the top, which a phone then shows with what is wrong with it", async () => {
    const step = await saved({ companyWebsite: "not a website", linkedInUrl: "my linkedin", openTo: "o".repeat(OPEN_TO_MAX + 1) });
    expect(await step.seen()).toEqual({ focused: "companyWebsite", moved: true, shows: [true, true, true] });
  });

  it("goes to the one wrong field when there is one", async () => {
    const step = await saved({ linkedInUrl: "my linkedin" });
    expect(await step.seen()).toMatchObject({ focused: "linkedInUrl", shows: [true, true, true] });
  });

  it("stays where it is on a form not yet saved", async () => {
    const step = await phone();
    await step.draw(null);
    await step.run();
    expect(await step.seen()).toEqual({ focused: "BODY", moved: false, shows: [] });
  });

  it("moves once for each answer, not each time the form is drawn again with it", async () => {
    const step = await saved({ companyWebsite: "not a website", linkedInUrl: "my linkedin" });
    await step.tab.focus("#position");
    await step.draw(hooks.state);
    await step.run();
    expect((await step.seen()).focused).toBe("position");
  });

  // A form posted before the page's scripts had loaded comes back drawn by the server with its messages; by the time the
  // scripts run, the person may be typing in another field.
  it("stays where it is when the answer came before the page's scripts ran", async () => {
    const step = await phone();
    await step.draw(await answer({ companyWebsite: "not a website", linkedInUrl: "my linkedin" }));
    await step.tab.focus("#position");
    await step.run();
    expect((await step.seen()).focused).toBe("position");
  });
});

// The open-to box is four lines tall, but Enter in it saves the form, as it did when it was one line: a line break
// would only be saved as a space. Its key is pressed here as the browser hands it to the form, a phone's return key
// included, which says so (enterkeyhint).
describe("Enter in the open-to box", () => {
  function press(key: string, { shiftKey = false, isComposing = false, keyCode = key === "Enter" ? 13 : 65 } = {}) {
    const box = find(ProfileForm({ saved: null }), "textarea")!;
    const requestSubmit = vi.fn();
    const preventDefault = vi.fn();
    box.props.onKeyDown!({ key, keyCode, shiftKey, nativeEvent: { isComposing }, preventDefault, currentTarget: { form: { requestSubmit } } });
    return { saved: requestSubmit.mock.calls.length, lineStopped: preventDefault.mock.calls.length > 0 };
  }

  it("saves the form instead of starting a line, with Shift as without", () => {
    expect(press("Enter")).toEqual({ saved: 1, lineStopped: true });
    expect(press("Enter", { shiftKey: true })).toEqual({ saved: 1, lineStopped: true });
    expect(renderToStaticMarkup(createElement(ProfileForm, { saved: null }))).toMatch(/<textarea[^>]*enterKeyHint="go"/i);
  });

  it("leaves any other key, and the Enter that chooses a word being composed, to the box", () => {
    expect(press("a")).toEqual({ saved: 0, lineStopped: false });
    expect(press("Enter", { isComposing: true })).toEqual({ saved: 0, lineStopped: false });
    // As Safari sends it: composing, said by key code 229 alone.
    expect(press("Enter", { keyCode: 229 })).toEqual({ saved: 0, lineStopped: false });
  });

  it("does not save again while a save is under way, as a disabled button stops Enter in a field", () => {
    hooks.pending = true;
    expect(press("Enter")).toEqual({ saved: 0, lineStopped: true });
  });
});
