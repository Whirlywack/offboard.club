// Privacy and terms (#34): the page, the link to it in every page's footer and beside the sign-in button, and the welcome
// step, which says who runs the Club before anyone agrees. Faked: the session and the database (lib/fake-db.ts).
// Everything else is the app's own code.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE_RULES } from "@/lib/consent";
import { addPerson, db, people, resetDb } from "@/lib/fake-db";
import GlobalError from "./global-error";
import RootLayout from "./layout";
import PrivacyPage from "./privacy/page";
import { SignIn } from "./sign-in";
import Welcome from "./welcome/page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("next/font/google", () => ({ Newsreader: () => ({ variable: "newsreader" }) }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const ORGANISER = "Person organiser";
let signedIn: string | null;

// Text as it appears in the markup, apostrophes escaped.
const markup = (text: string) => text.replaceAll("'", "&#x27;");

const privacyPage = () => renderToStaticMarkup(PrivacyPage());

// The welcome step as its viewer gets it: the page is a static shell, and what reads the session is inside <Suspense>.
async function welcomeStep() {
  const inner = Welcome().props.children[1].props.children;
  return renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
}

beforeEach(() => {
  vi.stubEnv("ORGANISER_USER_ID", "organiser");
  vi.stubEnv("ORGANISER_CONTACT_EMAIL", "organiser@pretend.invalid");
  resetDb();
  addPerson("organiser", { name: ORGANISER });
  addPerson("newcomer", { publicDisplayConsentAt: null, houseRulesAcceptedAt: null, lichessId: null, lichessUsername: null });
  signedIn = "newcomer";
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("the privacy and terms page", () => {
  it("says who runs Offboard, naming no person, and how to write to them", () => {
    const html = privacyPage();
    expect(html).toContain("<h1>Privacy and terms</h1>");
    expect(html).toContain("run by one volunteer, the Organiser");
    expect(html).toContain('<a href="mailto:organiser@pretend.invalid">organiser@pretend.invalid</a>');
    expect(html).not.toContain(ORGANISER);
  });

  it("offers no contact route while no address is set", () => {
    vi.stubEnv("ORGANISER_CONTACT_EMAIL", "");
    const html = privacyPage();
    expect(html).not.toContain("Write to the Organiser at");
    expect(html).not.toContain("mailto:null");
    expect(html).toContain("contact address isn&#x27;t set up yet");
  });

  it("says what is kept, from LinkedIn, Lichess, Matchdays and the Profile", () => {
    const kept = section(privacyPage(), "kept");
    for (const fact of ["your name, the address of your photo, your email address", "your account's id, username and blitz rating", "marked or closed", "Company", "position", "LinkedIn profile", "open to", "Games", "IP address", "user agent"])
      expect(kept).toContain(markup(fact));
  });

  it("says what is public and what only signed-in Members see", () => {
    const shown = section(privacyPage(), "public");
    expect(shown).toContain(
      "<strong>Anyone:</strong> your name and Company, with your place, points, Season score, Matchdays played and Awards, on Leaderboards, in Recaps and as Season champion.",
    );
    expect(shown).toContain("<strong>Signed-in Members:</strong> also your photo, Profile, Lichess username, blitz rating and Games");
    expect(shown).toContain("<strong>Only the Organiser,</strong> who can read everything the site keeps: your email address");
    expect(shown).toContain("Being listed in public is a condition of membership, so objecting to it means leaving the Club.");
  });

  it("names who else handles the data, and where", () => {
    const others = section(privacyPage(), "others");
    for (const fact of ["Vercel", "Neon", "Databricks", "Frankfurt", "Washington, D.C., USA", "LinkedIn", "Lichess", "Data Privacy Framework", "Standard Contractual Clauses"])
      expect(others).toContain(markup(fact));
  });

  it("says how long things are kept, and how to change, see or delete them, leaving included", () => {
    const html = privacyPage();
    const howLong = section(html, "how-long");
    expect(howLong).toContain(markup("Your account, Profile, Lichess connection, results and acceptances: while you're a Member."));
    expect(howLong).toContain("until the Organiser has removed it by hand");
    const leaving = section(html, "leaving");
    expect(leaving).toContain('To leave, choose “Delete your account” on <a href="/profile">Edit your Profile</a>');
    expect(leaving).toContain("results and acceptances are deleted at once");
    expect(leaving).toContain("The site asks Lichess to remove the Lichess account you have connected from the Club");
    expect(leaving).toContain(markup("Your Games stay in your opponents' histories"));
    expect(leaving).toContain("its Game is no longer shown");
    expect(section(html, "rights")).toContain("a copy of your data");
    expect(section(html, "complaints")).toContain('href="https://vdai.lrv.lt/en"');
  });

  it("discloses the sign-in cookie and its 7 days, which use does not extend", () => {
    expect(section(privacyPage(), "cookies")).toContain(
      "<code>__Secure-better-auth.session_token</code>): keeps you signed in for 7 days. Signing out removes it.",
    );
  });

  it("states the terms of membership: 18 or over, public listing, and the house rules accepted on the welcome step", async () => {
    const terms = section(privacyPage(), "terms");
    expect(terms).toContain("anyone 18 or over");
    expect(terms).toContain(markup("for as long as you're a Member"));
    const welcome = await welcomeStep();
    for (const rule of HOUSE_RULES) {
      expect(terms).toContain(`<li>${markup(rule)}</li>`);
      expect(welcome).toContain(`<li>${markup(rule)}</li>`);
    }
  });
});

describe("the link to the page", () => {
  it("is in the footer of every page", () => {
    const html = renderToStaticMarkup(RootLayout({ children: createElement("main"), params: Promise.resolve({}) }) as ReactElement);
    expect(html.slice(html.indexOf("<footer"))).toContain('<a href="/privacy">Privacy and terms</a>');
  });

  it("is beside Home on the page shown when the whole site fails, which has no footer", () => {
    const html = renderToStaticMarkup(createElement(GlobalError, { error: null, retry: () => {} }));
    expect(html).toMatch(/<a class="[^"]+" href="\/">Home<\/a><a href="\/privacy">Privacy and terms<\/a>/);
  });

  it("is beside the sign-in button, which says the site stores the LinkedIn name, photo and email at each sign-in", () => {
    const html = renderToStaticMarkup(createElement(SignIn));
    expect(html).toContain('<button aria-describedby="linkedin-notice">Sign in with LinkedIn</button>');
    expect(html).toMatch(
      /<p id="linkedin-notice"[^>]*>Signing in lets Offboard store your LinkedIn name, photo and email, updated each time you sign in\. <a href="\/privacy">Privacy and terms<\/a><\/p>/,
    );
  });
});

describe("the welcome step", () => {
  it("names the Organiser from their own account before anything is agreed, and links to the page", async () => {
    const html = await welcomeStep();
    expect(html).toContain(`run by one volunteer, ${ORGANISER}, the Organiser,`);
    expect(html).toContain('<a href="/privacy">Privacy and terms</a>');
    people.get("organiser")!.name = "Person renamed";
    expect(await welcomeStep()).toContain("run by one volunteer, Person renamed, the Organiser,");
  });

  it.each([
    ["ORGANISER_USER_ID is unset", ""],
    ["it names nobody the site knows", "nobody"],
    ["it names someone who has agreed but not connected Lichess", "halfway"],
  ])("says who runs the Club without a name when %s", async (_, id) => {
    addPerson("halfway", { name: "Person halfway", lichessId: null, lichessUsername: null });
    vi.stubEnv("ORGANISER_USER_ID", id);
    const html = await welcomeStep();
    expect(html).toContain("run by one volunteer, the Organiser, who is responsible");
    expect(html).not.toContain(ORGANISER);
    expect(html).not.toContain("Person halfway");
  });

  it("reads nothing for a signed-out visitor, who is sent home", async () => {
    signedIn = null;
    await expect(welcomeStep()).rejects.toThrow(/^redirect \/$/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("says names and Companies are public everywhere they are, as a condition of membership, and how to leave", async () => {
    const html = await welcomeStep();
    expect(html).toContain("Being listed is part of being a Member");
    expect(html).toContain("To leave later, delete your account on Edit your Profile. That takes you off every Leaderboard, Recap and Award.");
    expect(html).toContain(
      "I accept that my name, and my Company if I add one, appear publicly on Leaderboards, in Recaps and Awards, and as Season champion, for as long as I&#x27;m a Member.",
    );
  });
});

// One section of the page, by its heading's id, up to the next section.
function section(html: string, id: string) {
  const start = html.indexOf(`<h2 id="${id}">`);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}
