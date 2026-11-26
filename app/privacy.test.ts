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
vi.mock("next/font/google", () => ({ Bodoni_Moda: () => ({ variable: "bodoni" }), Hanken_Grotesk: () => ({ variable: "hanken" }) }));
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
    for (const fact of ["your name, a link to your photo, your email address", "your account's id, username and blitz rating", "marked or closed", "Company", "position", "LinkedIn profile", "open to", "Games", "IP address", "user agent"])
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
    expect(howLong).toContain("until the Organiser removes it by hand");
    // Someone who did not finish joining deletes what is kept about them themselves (#43).
    expect(howLong).toContain(
      markup("If you signed in but didn't finish joining: what came from LinkedIn, your sign-in records and any acceptances, until you choose “Delete your account” on the sign-up step you stopped at."),
    );
    expect(howLong).not.toContain("ask the Organiser");
    // The backups delete themselves within 14 days of being made (lib/backup.ts), so what leaving deletes goes from them too.
    expect(howLong).toContain("up to 14 days in the nightly database backups, which Vercel keeps in Frankfurt.");
    const leaving = section(html, "leaving");
    expect(leaving).toContain('To leave, choose “Delete your account” on <a href="/profile">Edit your Profile</a>');
    expect(leaving).toContain("results and acceptances at once");
    expect(leaving).toContain("The site asks Lichess to remove your Lichess account from the Club");
    expect(leaving).toContain(markup("Your Games stay in your opponents' histories"));
    expect(leaving).toContain("its Game is no longer shown");
    expect(section(html, "rights")).toContain("a copy of your data");
    expect(section(html, "complaints")).toContain('href="https://vdai.lrv.lt/en"');
  });

  // A reader on a phone finds what is kept, for how long, who sees it or how to leave without reading all that is above
  // it (#82): the headings, in the page's words and order, each a link to its section, above the first of them.
  it("lists its sections' headings before the first section, each leading to its section", () => {
    const html = privacyPage();
    const headings = [...html.matchAll(/<h2 id="([^"]+)">([^<]+)<\/h2>/g)].map(([, id, heading]) => [`#${id}`, heading]);
    const list = html.match(/<nav aria-label="Privacy and terms"[^>]*>(.*?)<\/nav>/)!;
    const links = [...list[1].matchAll(/<a href="([^"]+)"><span>([^<]+)<\/span>/g)].map(([, href, label]) => [href, label]);
    expect(headings.map(([, heading]) => heading)).toEqual(
      ["Who runs Offboard", "Who sees what", "Leaving", "What Offboard keeps", "Why it's kept", "Who else handles it", "How long it's kept", "Your rights", "Complaints", "Cookies", "Fair play", "Terms of membership"].map(markup),
    );
    expect(links).toEqual(headings);
    expect(list.index).toBeLessThan(html.indexOf("<h2"));
  });

  it("discloses the sign-in cookie and its 7 days, which use does not extend", () => {
    expect(section(privacyPage(), "cookies")).toContain(
      "<code>__Secure-better-auth.session_token</code>): keeps you signed in for 7 days. Signing out removes it.",
    );
  });

  // Every fact the page stated before its words were shortened (#74), and the nine added then, numbered as the privacy
  // deck lists them: a phrase of each, as the page reads now.
  const FACTS = [
    "Last changed 26 November 2026.",
    "Offboard is run by one volunteer, the Organiser,",
    "responsible for what the site keeps (its “controller”, in GDPR terms)",
    "The welcome step shows their name before you agree to anything.",
    "Write to the Organiser at organiser@pretend.invalid about anything on this page.",
    "Anyone: your name and Company, with your place, points, Season score, Matchdays played and Awards, on Leaderboards, in Recaps and as Season champion.",
    "Signed-in Members: also your photo, Profile, Lichess username, blitz rating and Games, with links to them on Lichess.",
    "The Club's Telegram group, whose invite link only Members see",
    "the names and points of each Recap's top three, and each Award's winner by name",
    "keeps what the site's bot posts there",
    "Only the Organiser, who can read everything the site keeps",
    "your email address, IP address and browser, and whether Lichess has marked or closed your account",
    "Being listed in public is a condition of membership",
    "so objecting to it means leaving the Club",
    "Lichess shows your username and Games publicly on its own site.",
    "To leave, choose “Delete your account” on Edit your Profile.",
    "That deletes your account, Profile, Lichess connection, results and acceptances at once",
    "signs you out and takes you off every Leaderboard, Recap and Award",
    "The site asks Lichess to remove your Lichess account from the Club's team.",
    "Your Games stay in your opponents' histories, against “a former member”, with the Game's Lichess id and both ratings.",
    "An Award someone won against you stays theirs",
    "but its Game is no longer shown",
    "Your Lichess account, its Games and Recaps already posted to the Telegram group stay as they are.",
    "Your Lichess account, its Games and Recaps already posted to the Telegram group stay as they are.",
    "From LinkedIn, at each sign-in: your name, a link to your photo, your email address, whether LinkedIn has verified it, and LinkedIn's id for you",
    "but not its sign-in tokens",
    "From Lichess, when you connect it: your account's id, username and blitz rating",
    "After each Matchday you play, the site checks the rating again, and whether Lichess has marked or closed the account.",
    "The permission you give on Lichess is used to read your account and join the Club's team",
    "then revoked",
    "From each Matchday you play, as Lichess records it: your place, points and rating that night,",
    "your Company at the time",
    "From your Profile, all optional:",
    "your Company's website, from which the site fetches its name and logo",
    "your position; your LinkedIn profile link; your “open to” line",
    "From the welcome step: when you accepted the terms of membership and the house rules.",
    "From each sign-in: when it began and expires",
    "your IP address, and your browser's user agent, which names your browser, operating system and device",
    "Offboard sends no email",
    "no page shows your email address",
    "Running your membership: your account, sign-in, Profile, Matchdays and Games are what you join for",
    "(contract, GDPR Art. 6(1)(b))",
    "Legitimate interests (GDPR Art. 6(1)(f)):",
    "Your name and Company in public, so people deciding whether to join can see the Club.",
    "Fair play: keeping Leaderboards honest.",
    "Security: keeping accounts and the site safe, with each sign-in's IP address and browser and Vercel's logs.",
    "Your Games after you leave: your opponents keep their own record.",
    "Vercel hosts the site in Frankfurt",
    "builds it in Washington, D.C., USA",
    "The build connects to the database only to update its structure, and reads nobody's data.",
    "Neon, part of Databricks, hosts the database in Frankfurt",
    "with some support staff and subcontractors in the USA",
    "LinkedIn (LinkedIn Ireland) signs you in.",
    "Members' browsers load your photo from LinkedIn, which sees their IP address.",
    "Lichess, a French non-profit with servers in the EU",
    "hosts the Matchdays, their Games and the Club's private team",
    "Opening an Award's Game loads Lichess's board from lichess.org.",
    "Telegram runs the Club's group",
    "which Members join if they want to",
    "keeps what the site's bot posts there",
    "Vercel and Databricks are US companies, so some data may be handled in the USA.",
    "Both are certified under the EU-U.S. Data Privacy Framework",
    "use the EU's Standard Contractual Clauses.",
    "Your account, Profile, Lichess connection, results and acceptances: while you're a Member.",
    "Each sign-in's record, with its IP address and browser: until you sign out of it or leave.",
    "If the site can't remove your Lichess account from the Club's team when you leave: its id, until the Organiser removes it by hand.",
    "If you signed in but didn't finish joining: what came from LinkedIn, your sign-in records and any acceptances, until you choose “Delete your account” on the sign-up step you stopped at.",
    "The site's copy of a Recap's post to the Telegram group: until the next Matchday starts.",
    "Deleted data: up to 6 hours in Neon's restore history",
    "up to 14 days in the nightly database backups",
    "which Vercel keeps in Frankfurt",
    "Vercel's logs of requests and errors: 1 day.",
    "Change or clear what you added to your Profile at any time, on Edit your Profile.",
    "Your name and photo come from LinkedIn",
    "change them there, and they change here at your next sign-in",
    "Under the GDPR you can also ask the Organiser for a copy of your data",
    "including one a computer can read",
    "ask them to correct it, delete it or limit its use",
    "and object to its use",
    "Please write to the Organiser first.",
    "You can also complain to the data protection authority of the EU country you live in",
    "or to Lithuania's State Data Protection Inspectorate (Valstybinė duomenų apsaugos inspekcija, vdai.lrv.lt",
    "The site has no ads, analytics or tracking.",
    "Reading it sets no cookies.",
    "Only signing in and connecting Lichess do",
    "nothing else is stored in your browser",
    "Your sign-in (__Secure-better-auth.session_token): keeps you signed in for 7 days. Signing out removes it.",
    "While you sign in (__Secure-better-auth.state): protects that step from forgery, for up to 5 minutes.",
    "While you connect Lichess (offboard-lichess, or offboard-organiser-lichess for the Organiser): remembers that step",
    "until you come back from Lichess, for up to 10 minutes",
    "While Lichess has your account marked for breaking its terms, or closed, you're left off Leaderboards and Awards.",
    "This is the only thing the site decides about you automatically",
    "it has no legal or similar effect",
    "Who may join: anyone 18 or over who works in tech in or around Vilnius.",
    "Each Member connects one Lichess account, which no other Member may use.",
    "Public listing: your name, and your Company if you add one, appear publicly on Leaderboards, in Recaps and Awards, and as Season champion, for as long as you're a Member.",
    "You can leave at any time.",
    HOUSE_RULES[0],
    HOUSE_RULES[1],
    "Lichess's own terms apply to the Games you play there.",
    "Removal: the Organiser can remove a Member who breaks a house rule or doesn't belong.",
    "That deletes their account, as leaving does.",
    "Free, with no prizes.",
    "Liability: Offboard comes as it is, without warranty",
    "the Organiser's liability is limited as far as the law allows",
    "Nothing here limits liability for intent, gross negligence, or harm to life or health.",
    "Changes: the Club may change or stop at any time",
    "no Matchday is guaranteed",
    "When this page changes, so does the date at the top.",
    "Law: Lithuanian.",
    // Added at the owner's word, with the shortening.
    "the names and points of each Recap's top three",
    "each Award's winner by name, with what they won it for",
    "whether LinkedIn has verified it",
    "and when you first connected it",
    "The site also keeps the date you last added a new Company and how many you added that day",
    "as it allows five a day",
    "LinkedIn (LinkedIn Ireland)",
    "Telegram says it keeps the data of people who signed up in the EEA in the Netherlands",
    "but names no place for groups",
  ];

  it("states each of the 119 facts in the privacy deck's list, and the day they were last changed", () => {
    expect(FACTS).toHaveLength(119);
    const text = words(privacyPage());
    expect(FACTS.map((fact, i) => [i + 1, fact]).filter(([, fact]) => !text.includes(fact as string))).toEqual([]);
    expect(privacyPage()).toContain('<time dateTime="2026-11-26">');
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
    expect(html.slice(html.indexOf("<footer"))).toContain(
      "<p>Offboard is a free chess Club for people who work in tech in and around Vilnius.</p><p>Offboard isn&#x27;t affiliated with Lichess or LinkedIn.</p>",
    );
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
    expect(html).toContain('responsible for what the site keeps about you. See <a href="/privacy">Privacy and terms</a>.');
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
    expect(html).toContain("<p>You&#x27;ll appear as Person newcomer. Only signed-in Members see your photo and Profile, and your email is never shown.</p>");
    expect(html).toContain(
      "<p>Being listed is part of being a Member. To leave later, delete your account on Edit your Profile. That takes you off every Leaderboard, Recap and Award.</p>",
    );
    expect(html).toMatch(/<legend>House rules<\/legend><ol/);
    expect(html).toContain(
      "I accept that my name, and my Company if I add one, appear publicly on Leaderboards, in Recaps and Awards, and as Season champion, for as long as I&#x27;m a Member.",
    );
  });

  it("asks consent to what the terms' Public listing says, in the same words", async () => {
    const box = words(await welcomeStep()).match(/I accept that (my name, .*? Member\.)/)![1];
    const listing = words(privacyPage()).match(/Public listing: (your name, .*? Member\.)/)![1];
    expect(box.replaceAll("my ", "your ").replace("if I add", "if you add").replace("I'm", "you're")).toBe(listing);
  });
});

// The words of a page as its reader reads them: tags dropped, the escaped characters back, one space between words.
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ");

// One section of the page, by its heading's id, up to the next section.
function section(html: string, id: string) {
  const start = html.indexOf(`<h2 id="${id}">`);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}
