// The home page: its words as each reader meets it, and its description in search results and link previews; the next
// Matchday, its time for everyone, and its Lichess tournament for Members once the site has created it; and who is
// signed in, when that cannot be read. Faked: the session and the database (lib/fake-db.ts). Everything else is the
// app's own code.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertOrganiser } from "@/lib/alerts";
import { addPerson, db, fromDatabase, matchdays, people, requestFailures, resetDb, results, seasons } from "@/lib/fake-db";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";
import { metadata } from "./layout";
import Home, { NextMatchday, SeasonChampions, You } from "./page";

const { getSession, request } = vi.hoisted(() => ({ getSession: vi.fn(), request: { headers: new Headers() } }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/font/google", () => ({ Bodoni_Moda: () => ({ variable: "bodoni" }), Hanken_Grotesk: () => ({ variable: "hanken" }) }));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const DATE = "2026-11-29";
let signedIn: string | null;

// The next Matchday as the viewer gets it: what the home page streams into its Next Matchday panel.
async function nextMatchday() {
  const shown = await NextMatchday();
  return shown ? renderToStaticMarkup(shown as ReactElement) : "";
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-25T12:00:00Z") });
  resetDb();
  addPerson("member");
  addPerson("newcomer", { lichessId: null, lichessUsername: null });
  seasons.set(1, { number: 1, start: DATE });
  signedIn = null;
  request.headers = new Headers();
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// The whole page as its reader gets it once every streamed part has arrived, as the text they read, top to bottom. Each
// part is kept in its place, however large, where React would otherwise send a large one last for its script to move.
async function page(query: Record<string, string> = {}) {
  const home = Home({ params: Promise.resolve({}), searchParams: Promise.resolve(query) });
  const { prelude } = await prerenderToNodeStream(home, { progressiveChunkSize: Number.POSITIVE_INFINITY });
  let html = "";
  for await (const chunk of prelude) html += chunk;
  return html
    .replace(/<script>[\s\S]*?<\/script>/g, "") // React's own, for a form sent before the page is interactive
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

// The words of the home page's deck (#74), in the order of the approved mock-up (#77). Initials stand in for a photo, and
// "(opens in a new tab)" is for screen readers: neither is the deck's.
describe("the home page as each reader meets it", () => {
  // The page's own header (#77): the strip, which says what the Season block says, then the name and the three links,
  // and for a visitor a second way to sign in.
  const head = (strip: string, { visitor }: { visitor: boolean }) =>
    [strip, "Offboard Season All-time Recaps", visitor && "Sign in with LinkedIn"].filter(Boolean).join(" ");
  const TOP =
    "Sunday chess for people in tech Free chess Club · Vilnius Working in tech keeps you busy, and busy gets lonely. We " +
    "think that's worth fixing. So every Sunday evening we play chess online, five Games against other people in tech. " +
    "With luck some of us become friends, and end up across a real board.";
  const TO_GO = "Season 1 15 more Members to go";
  const SEASON_1 = `${TO_GO} It starts once there are sixteen of us, on the first Sunday at least a week later.`;
  const NEXT = "Next Matchday Sunday 29 November at 20:00";
  const SIGN_IN =
    "Sign in with LinkedIn Signing in lets Offboard store your LinkedIn name, photo and email, updated each time you " +
    "sign in. Privacy and terms";
  const MEMBER =
    "PM Signed in as Person member Sign out Your Profile Edit your Profile Telegram group (opens in a new tab)";
  const JOIN = "Join this Matchday on Lichess (opens in a new tab)";
  const below = ({ telegram = "There's a Telegram group to talk in.", champion = "" } = {}) =>
    "The chess Matchdays start at 20:00 Vilnius time, on Lichess. Games are 5 minutes a side plus 3 seconds a move. " +
    "Knowing how the pieces move is enough. A Season is six Matchdays and your best four count, so you can miss two. " +
    "Meeting people Profiles can say where Members work and what they're open to, like a coffee or hearing about jobs. " +
    `${telegram} Nobody may sell to you or recruit you unless your Profile invites it. Leaderboards and Recaps Both ` +
    `are public and show your name. ${champion}This Season's Leaderboard All-time Leaderboard Recaps`;
  // Season 1 played to its sixth Matchday, its results in: the champion is named until Season 2's first, 17 January.
  const seasonOver = (winners: string[]) => {
    for (const date of ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27", "2027-01-03"]) {
      matchdays.set(date, { date, lichessTournamentId: `T${date.replaceAll("-", "")}`, ingestedAt: new Date() });
      for (const userId of winners)
        results.set(`${date} ${userId}`, { matchdayDate: date, userId, rank: 1, points: 4, rating: 1500, companyDomain: null });
    }
    vi.setSystemTime(new Date("2027-01-06T12:00:00Z"));
  };

  beforeEach(() => vi.stubEnv("TELEGRAM_INVITE_LINK", "https://t.me/+a-pretend-invite"));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    db.query.mockReset();
  });

  it("is the deck's page for a first-time visitor before Season 1", async () => {
    seasons.clear();
    expect(await page()).toBe(`${head(TO_GO, { visitor: true })} ${TOP} ${SEASON_1} ${SIGN_IN} ${below()}`);
  });

  it("gives a Member before Season 1 the same card, and their own links in place of the button", async () => {
    seasons.clear();
    signedIn = "member";
    expect(await page()).toBe(`${head(TO_GO, { visitor: false })} ${TOP} ${SEASON_1} ${MEMBER} ${below()}`);
  });

  it("shows a visitor the next Matchday's time alone once a Season is scheduled", async () => {
    expect(await page()).toBe(`${head(NEXT, { visitor: true })} ${TOP} ${NEXT} ${SIGN_IN} ${below()}`);
  });

  it("gives someone part-way through signing up the way to finish, and no Profile or Telegram links", async () => {
    signedIn = "newcomer";
    expect(await page()).toBe(
      `${head(NEXT, { visitor: false })} ${TOP} ${NEXT} PN Signed in as Person newcomer Sign out Finish signing up ${below()}`,
    );
  });

  it("gives a Member the Matchday coming up on Lichess once its tournament exists", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    signedIn = "member";
    expect(await page()).toBe(`${head(NEXT, { visitor: false })} ${TOP} ${NEXT} ${JOIN} ${MEMBER} ${below()}`);
  });

  it("gives a Member the Matchday under way, and until when Lichess lets them join", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    vi.setSystemTime(new Date(`${DATE}T20:40:00+02:00`));
    signedIn = "member";
    const underWay = "Matchday under way Sunday 29 November at 20:00";
    expect(await page()).toBe(
      `${head(underWay, { visitor: false })} ${TOP} ${underWay} Lichess lets you join until round 3 starts. ${JOIN} ${MEMBER} ${below()}`,
    );
  });

  it("names the Season's champion below what is public and above the links, once a Season is over", async () => {
    seasonOver(["member"]);
    const next = "Next Matchday Sunday 17 January at 20:00";
    const champion = "Person member is the Season 1 champion. ";
    expect(await page()).toBe(`${head(next, { visitor: true })} ${TOP} ${next} ${SIGN_IN} ${below({ champion })}`);
    signedIn = "member";
    expect(await page()).toBe(`${head(next, { visitor: false })} ${TOP} ${next} ${MEMBER} ${below({ champion })}`);
  });

  it("says that two share the title", async () => {
    addPerson("other");
    seasonOver(["member", "other"]);
    expect(await page()).toContain("Both are public and show your name. Person member and Person other share the Season 1 title. This Season's Leaderboard");
  });

  it("leaves out the strip, the card and the champion when the database is down, and says so to someone with a session", async () => {
    seasonOver(["member"]);
    const settled = keepWaitUntil();
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValue(fromDatabase(new Error("Connection terminated due to connection timeout")));
    expect(await page()).toBe(`${head("", { visitor: true })} ${TOP} ${SIGN_IN} ${below()}`);
    request.headers = new Headers({ cookie: "better-auth.session_token=a-pretend-session-token" });
    getSession.mockRejectedValue(new Error("Failed to get session"));
    expect(await page()).toBe(
      `${head("", { visitor: false })} ${TOP} Your sign-in can't be checked right now. Please try again in a minute. ${below()}`,
    );
    await settled();
  });

  it("says beside the button that LinkedIn sign-in failed", async () => {
    expect(await page({ signin: "failed" })).toContain(
      "Sign in with LinkedIn LinkedIn sign-in isn't working right now. Please try again in a few minutes. Signing in lets",
    );
  });

  it("says the Telegram group is still to come while no invite link is set", async () => {
    vi.stubEnv("TELEGRAM_INVITE_LINK", "");
    expect(await page()).toBe(
      `${head(NEXT, { visitor: true })} ${TOP} ${NEXT} ${SIGN_IN} ${below({ telegram: "A Telegram group to talk in is still to come." })}`,
    );
  });
});

// Before Season 1, sixteen pawns: one standing for each Member who has joined, an outline for each place still open.
describe("the pawns on the home page", () => {
  const pawns = (html: string) => [...html.matchAll(/ src="[^"]*%2F(pawn|pawn-empty)\.webp[^"]*"/g)].map(([, file]) => file);

  it("stand for every Member who has joined, from none to fifteen, and the rest are outlines", async () => {
    seasons.clear();
    people.clear();
    for (let joined = 0; joined < 16; joined++) {
      expect(pawns(await nextMatchday())).toEqual([...Array(joined).fill("pawn"), ...Array(16 - joined).fill("pawn-empty")]);
      addPerson(`joined-${joined}`);
    }
    expect(pawns(await nextMatchday())).toEqual([]);
    expect(await nextMatchday()).toContain("Next Matchday");
  });

  it("do not count anyone part-way through signing up", async () => {
    seasons.clear();
    expect(pawns(await nextMatchday())).toEqual(["pawn", ...Array(15).fill("pawn-empty")]);
  });
});

describe("the site's description in search results and link previews", () => {
  it("is the home page deck's", () => {
    const description =
      "Working in tech keeps you busy, and busy gets lonely. Offboard is free Sunday chess on Lichess for people in tech " +
      "in and around Vilnius.";
    expect(metadata.description).toBe(description);
    expect(metadata.openGraph?.description).toBe(description);
  });
});

describe("the next Matchday's tournament on the home page", () => {
  it("is linked for a Member once the site has created it", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    signedIn = "member";
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday");
    expect(html).toContain('<time dateTime="2026-11-29T18:00:00.000Z">Sunday 29 November at 20:00</time>');
    expect(html).toContain(
      '<a href="https://lichess.org/swiss/AbCd1234" target="_blank" rel="noopener noreferrer">Join this Matchday on Lichess<span class="visually-hidden"> (opens in a new tab)</span></a>',
    );
  });

  it("is not linked before it exists", async () => {
    signedIn = "member";
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday");
    expect(html).toContain("Sunday 29 November at 20:00");
    expect(html).not.toContain("lichess.org/swiss");
  });

  it("is not linked for a visitor or someone part-way through signing up, who see the time alone", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    for (const who of [null, "newcomer"]) {
      signedIn = who;
      const html = await nextMatchday();
      expect(html).toContain("Sunday 29 November at 20:00");
      expect(html).not.toContain("lichess.org/swiss");
    }
  });
});

// Lichess lets a Member join a five-round Swiss until its third round starts; the site keeps the link for 90 minutes.
describe("the Matchday under way on the home page", () => {
  const NEXT = "2026-12-06";
  const at = (time: string) => vi.setSystemTime(new Date(`${DATE}T${time}:00+02:00`)); // Vilnius time in winter

  beforeEach(() => matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null }));

  it("stays linked for a Member until 21:30, saying it has started and until when Lichess lets them join", async () => {
    signedIn = "member";
    for (const time of ["20:05", "21:29"]) {
      at(time);
      const html = await nextMatchday();
      expect(html).toContain("Matchday under way");
      expect(html).not.toContain("Next Matchday");
      expect(html).toContain('<time dateTime="2026-11-29T18:00:00.000Z">Sunday 29 November at 20:00</time>');
      expect(html).toContain("Lichess lets you join until round 3 starts.");
      expect(html).toContain('<a href="https://lichess.org/swiss/AbCd1234"');
    }
  });

  it("gives way at 21:30 to the next Matchday, with no link to the one just played", async () => {
    signedIn = "member";
    at("21:30");
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday");
    expect(html).toContain('<time dateTime="2026-12-06T18:00:00.000Z">Sunday 6 December at 20:00</time>');
    expect(html).not.toContain("under way");
    expect(html).not.toContain("lichess.org/swiss");
  });

  it("gives way to the next Matchday once its results are in, before 21:30", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: new Date(`${DATE}T21:10:00+02:00`) });
    signedIn = "member";
    at("21:15");
    const html = await nextMatchday();
    expect(html).toContain("Next Matchday");
    expect(html).toContain('<time dateTime="2026-12-06T18:00:00.000Z">Sunday 6 December at 20:00</time>');
    expect(html).not.toContain("under way");
    expect(html).not.toContain("lichess.org/swiss");
  });

  it("is not kept when the site never created its tournament: the next Matchday is shown instead", async () => {
    signedIn = "member";
    at("20:05");
    for (const row of [null, { date: DATE, lichessTournamentId: null, ingestedAt: null }]) {
      if (row) matchdays.set(DATE, row);
      else matchdays.delete(DATE);
      const html = await nextMatchday();
      expect(html).toContain("Next Matchday");
      expect(html).toContain('<time dateTime="2026-12-06T18:00:00.000Z">Sunday 6 December at 20:00</time>');
      expect(html).not.toContain("under way");
      expect(html).not.toContain("round 3");
    }
  });

  it("is never shown or linked to a visitor or someone part-way through signing up, who see the next Matchday", async () => {
    matchdays.set(NEXT, { date: NEXT, lichessTournamentId: "EfGh5678", ingestedAt: null });
    for (const [time, shown] of [["19:55", "Sunday 29 November"], ["20:05", "Sunday 6 December"], ["21:30", "Sunday 6 December"]]) {
      at(time);
      for (const who of [null, "newcomer"]) {
        signedIn = who;
        const html = await nextMatchday();
        expect(html).toContain("Next Matchday");
        expect(html).toContain(`${shown} at 20:00`);
        expect(html).not.toContain("lichess.org/swiss");
      }
    }
  });
});

// Who is signed in, when the database cannot be reached (#55). Until Better Auth has once checked its tables in the
// database, every call reads it, so a session cannot be read for a visitor with no session cookie either: only someone
// with the cookie is signed in, and must not be offered to sign in again.
describe("the signed-in panel on the home page", () => {
  const you = async (query: Record<string, string> = {}) =>
    renderToStaticMarkup((await You({ searchParams: Promise.resolve(query) })) as ReactElement);
  const unreadable = () => getSession.mockRejectedValue(new Error("Connection terminated due to connection timeout"));

  it("says plainly that the sign-in cannot be checked when a signed-in person's session cannot be read", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=a-pretend-session-token" });
    unreadable();
    const html = await you();
    expect(html).toContain("Your sign-in can&#x27;t be checked right now. Please try again in a minute.");
    expect(html).not.toContain("Sign in with LinkedIn");
  });

  it("shows a Member their own panel when their session reads, with the session cookie everyone signed in has", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=a-pretend-session-token" });
    signedIn = "member";
    const html = await you();
    expect(html).toContain("Signed in as");
    expect(html).not.toContain("can&#x27;t be checked");
  });

  it("offers to sign in to a visitor with no session cookie, whether or not the database can be read", async () => {
    expect(await you()).toContain("Sign in with LinkedIn");
    unreadable();
    const html = await you();
    expect(html).toContain("Sign in with LinkedIn");
    expect(html).not.toContain("can&#x27;t be checked");
  });

  it("says that signing in isn't working, beside the button, to someone Better Auth failed coming back from LinkedIn", async () => {
    expect(await you()).not.toContain("isn&#x27;t working");
    const html = await you({ signin: "failed" });
    expect(html).toContain("LinkedIn sign-in isn&#x27;t working right now. Please try again in a few minutes.");
    expect(html).toContain("Sign in with LinkedIn");
  });
});

// What the home page catches itself to show something in its place is a failed request all the same (#60 review),
// recorded as the page's, and the Organiser is told of it: what showed nothing on 25 November 2026 (#55).
describe("the home page's failures, which it shows plainly", () => {
  const CHAT = "123456789";
  // As the sign-in library threw it when the pool gave up connecting, marked as the pool marks it (lib/db.ts, #55).
  const timedOut = () =>
    Object.assign(
      new Error("Failed to get session", {
        cause: fromDatabase(new Error("Connection terminated due to connection timeout", { cause: new Error("Connection terminated unexpectedly") })),
      }),
      { name: "APIError" },
    );
  const recorded = () => [...requestFailures.values()].map(({ route, kind, reason }) => ({ route, kind, reason }));
  const ONE = [{ route: "/", kind: "page", reason: "the database couldn't be reached" }];
  let settled: () => Promise<unknown>;

  beforeEach(() => {
    settled = keepWaitUntil();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    db.query.mockReset();
  });

  it("is GET / with a session cookie whose session read timed out: shown plainly, recorded, and alerted", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=a-pretend-session-token" });
    getSession.mockRejectedValue(timedOut());
    const html = renderToStaticMarkup((await You({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toContain("Your sign-in can&#x27;t be checked right now. Please try again in a minute.");
    await settled();
    expect(recorded()).toEqual(ONE);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "a-pretend-telegram-token");
    vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", CHAT);
    vi.stubEnv("TELEGRAM_URL", "");
    const telegram = createFakeTelegram({ token: "a-pretend-telegram-token", chats: [CHAT] });
    vi.stubGlobal("fetch", telegram.fetch);
    await alertOrganiser(new Date(Date.now() + 60 * 60_000));
    expect(telegram.posts.map((post) => `${post.chatId} ${post.text}`)).toEqual([`${CHAT} A page failed at /: the database couldn't be reached.`]);
  });

  it("is the next Matchday's schedule that could not be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(timedOut().cause);
    expect(await nextMatchday()).toBe("");
    await settled();
    expect(recorded()).toEqual(ONE);
  });

  it("is a session that could not be read to tell whether a Member gets the tournament", async () => {
    matchdays.set(DATE, { date: DATE, lichessTournamentId: "AbCd1234", ingestedAt: null });
    getSession.mockRejectedValue(timedOut());
    const html = await nextMatchday();
    expect(html).toContain("Sunday 29 November at 20:00");
    expect(html).not.toContain("lichess.org/swiss");
    await settled();
    expect(recorded()).toEqual(ONE);
  });

  it("is the Season champion who could not be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(timedOut().cause);
    expect(await SeasonChampions()).toBeNull();
    await settled();
    expect(recorded()).toEqual(ONE);
  });
});
