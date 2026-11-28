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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProfile, type ProfileFormState } from "./actions";
import styles from "./profile/profile.module.css";
import { ProfileForm } from "./profile/profile-form";
import ui from "./ui.module.css";
import WelcomeProfile, { Step } from "./welcome/profile/page";
import welcome from "./welcome/welcome.module.css";
import { fetchCompanyMeta } from "@/lib/company";
import { addPerson, db, people, resetDb } from "@/lib/fake-db";
import { OPEN_TO_MAX, POSITION_MAX } from "@/lib/profile";

// What the form's hooks give it, the save's answer and whether it is under way, and the script it runs once shown.
const returned = vi.hoisted(() => ({ state: null as ProfileFormState, pending: false, effects: [] as (() => void)[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: () => [returned.state, () => {}, returned.pending],
  useEffect: (effect: () => void) => void returned.effects.push(effect),
  useRef: () => ({ current: null }),
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
  returned.state = null;
  returned.pending = false;
  returned.effects.length = 0;
});

// The form after a Member saved `changes`, which the server refused, on the edit page or the sign-up step.
async function refused(changes: Partial<typeof typed>, welcome = false) {
  const sent = new FormData();
  for (const [name, value] of Object.entries({ ...typed, ...changes })) sent.set(name, value);
  returned.state = await saveProfile(null, sent);
  if (!returned.state) throw new Error("expected a refusal");
  return { html: renderToStaticMarkup(createElement(ProfileForm, { saved: null, welcome })), problems: returned.state.problems };
}

// Each field's control, and what comes just before it.
const control = (html: string, id: string) => html.match(new RegExp(`(<p[^>]*>[^<]*</p>)?<(input|textarea)[^>]*id="${id}"[^>]*>`))!;
const text = (html: string) => html.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');

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
});

// Where the focus goes once the form is shown again, on the sign-up step on a phone scrolled down to the button, as after
// a tap on it: the form's own script runs in Google Chrome, on the page as the server builds it, with its own styles.
describe("the focus after a save", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  beforeAll(async () => {
    vi.stubEnv("TELEGRAM_INVITE_LINK", "https://t.me/+a-pretend-invite");
    browser = await chromium.launch({ channel: "chrome", timeout: 180_000 });
  }, 0);
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

  // The element focused once the form's script has run, whether the screen moved, and whether it shows that field's
  // label, the message saying what is wrong with it, and its box.
  async function shown() {
    const page = await signUpStep();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const tab = await context.newPage();
      await tab.setContent(page);
      const before = await tab.evaluate(() => {
        scrollTo(0, document.documentElement.scrollHeight);
        return scrollY;
      });
      await tab.evaluate(`((form) => (${returned.effects.at(-1)})())({ current: document.querySelector("form") })`);
      return await tab.evaluate((before) => {
        const seen = (element: Element | null) => {
          const box = element!.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        };
        const focused = document.activeElement!;
        return {
          focused: focused.id || focused.tagName,
          moved: scrollY !== before,
          shows: focused.id ? [document.querySelector(`label[for="${focused.id}"]`), document.getElementById(`${focused.id}-error`), focused].map(seen) : [],
        };
      }, before);
    } finally {
      await context.close();
    }
  }

  it("goes to the first wrong field from the top, which a phone then shows with what is wrong with it", async () => {
    await refused({ companyWebsite: "not a website", linkedInUrl: "my linkedin", openTo: "o".repeat(OPEN_TO_MAX + 1) }, true);
    expect(await shown()).toEqual({ focused: "companyWebsite", moved: true, shows: [true, true, true] });
  });

  it("goes to the one wrong field when there is one", async () => {
    await refused({ linkedInUrl: "my linkedin" }, true);
    expect(await shown()).toMatchObject({ focused: "linkedInUrl", shows: [true, true, true] });
  });

  it("stays where it is on a form not yet saved", async () => {
    expect(await shown()).toEqual({ focused: "BODY", moved: false, shows: [] });
  });
});

// The open-to box is four lines tall, but Enter in it saves the form, as it did when it was one line: a line break
// would only be saved as a space. Its key is pressed here as the browser hands it to the form, a phone's return key
// included, which says so (enterkeyhint).
describe("Enter in the open-to box", () => {
  type Element = { type: unknown; props: { children?: unknown; onKeyDown?: (event: unknown) => void } };
  const find = (node: unknown, type: string): Element | undefined => {
    if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
    if (!node || typeof node !== "object" || !("props" in node)) return undefined;
    return (node as Element).type === type ? (node as Element) : find((node as Element).props.children, type);
  };

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
    returned.pending = true;
    expect(press("Enter")).toEqual({ saved: 0, lineStopped: true });
  });
});
