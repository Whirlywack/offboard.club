// The bot's posts to the Club's Telegram group (#13), through the ways they come about: the scheduled job (postToTelegram,
// at a supplied time), the endpoint Vercel calls and the schedule it calls it on (vercel.json); Collecting results and
// pnpm ingest storing a Matchday's results (postRecap); and the changes to the schedule (lib/seasons.ts). Faked:
// Telegram (lib/fixtures/fake-telegram.ts) and Lichess (lib/fixtures/fake-lichess.ts), standing in for fetch, the
// database (lib/fake-db.ts) and the clock. Everything else is the app's own code.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cronRequest } from "@/app/api/jobs/post-to-telegram/route";
import { addCompany, addPerson, db, games, jobFailures, matchdays, people, resetDb, results, scheduledJobs, seasons, skippedSundays, telegramPosts } from "@/lib/fake-db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { collectResults, SETTLE_MS } from "./collect-results";
import { ingestTournament, registerTournament } from "./matchdays";
import { JOB, postRecap, postToTelegram } from "./post-to-telegram";
import { matchdayStart } from "./schedule";
import { setSeasonStart, skipSunday, unskipSunday, upcomingMatchday } from "./seasons";
import { deliverPosts, queuePost } from "./telegram";

vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const TOKEN = "a-pretend-telegram-token";
const GROUP = "@pretend_group";
const SECRET = "a-cron-secret-of-forty-characters-123456";
const TEAM = "offboard-team";
const TOURNAMENT = "PreTend1";
const MINUTE = 60_000;

// Season 1 starts on Sunday 29 November 2026, in winter time: 20:00 in Vilnius is 18:00 UTC.
const DATE = "2026-11-29";
const START = matchdayStart(DATE);
const at = (iso: string) => new Date(iso);
const vilnius = (time: string, date = DATE) => at(`${date}T${time}:00+02:00`); // winter time
const WEDNESDAY = at("2026-11-25T12:00:00Z");

// They send Members to the site, whose home page links a signed-in Member to the tournament (docs/adr/0002).
const MORNING = "Matchday tonight at 20:00: five Games of 5+3 on Lichess. The link to join is on https://offboard.test once you're signed in.";
const HOUR_BEFORE = "Matchday starts in an hour, at 20:00. The link to join is on https://offboard.test once you're signed in.";
const POSTED_ONE = "Posted 1 message to the Telegram group.";
// What a run says of a post Telegram may have posted, by its first line, and why it could not tell when the run knows.
const unsure = (text: string, why?: string) =>
  `It isn't known whether Telegram posted "${text.split("\n")[0]}"${why ? ` (${why})` : ""}, so it won't be posted again. Check the group.`;

// The Matchday as Lichess exports it once played: ana, ben and cora are Members, zed is not. ana, rated 1500, mated
// ben, rated 1550, in 31 half-moves with 42 seconds left; zed beat cora on time; ben and cora drew.
const lines = (rows: object[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join("");
const standings = lines([
  { rank: 1, points: 4, tieBreak: 9, rating: 1610, username: "Lichess-ana" },
  { rank: 2, points: 3.5, tieBreak: 8, rating: 1720, username: "Lichess-zed" },
  { rank: 3, points: 2, tieBreak: 5, rating: 1530, username: "Lichess-ben" },
  { rank: 4, points: 0.5, tieBreak: 1, rating: 1440, username: "Lichess-cora" },
]);
const game = (id: string, white: string, black: string, winner: "white" | "black" | null, status: string, plies: number) => ({
  id,
  rated: true,
  status,
  lastMoveAt: START.getTime() + 70 * MINUTE,
  players: {
    white: { user: { name: `Lichess-${white}`, id: `lichess-${white}` }, rating: 1500 },
    black: { user: { name: `Lichess-${black}`, id: `lichess-${black}` }, rating: 1550 },
  },
  ...(winner && { winner }),
  moves: Array(plies).fill("Nf3").join(" "),
  clocks: Array(plies).fill(4200),
});
const exported = lines([
  game("Pretend01", "ana", "ben", "white", "mate", 31),
  game("Pretend02", "zed", "cora", "white", "outoftime", 60),
  game("Pretend03", "ben", "cora", null, "draw", 80),
]);
const RECAP = [
  "The Recap of Sunday 29 November is up: https://offboard.test/recaps/2026-11-29",
  "1. Member ana: 4 points\n2. Member ben: 2 points\n3. Member cora: 0.5 points",
  "Biggest upset: Member ana beat someone rated 50 points higher.\nClosest call: Member ana won with 42.0 seconds left on the clock.\nFastest checkmate: Member ana checkmated their opponent in 16 moves.",
].join("\n\n");
const OVER = new Date(START.getTime() + 90 * MINUTE); // 21:30 in Vilnius, once the tournament has finished

let telegram: ReturnType<typeof createFakeTelegram>;
let lichess: ReturnType<typeof createFakeLichess>;
let logged: string[];

const posted = () => telegram.posts.map((post) => post.text);

// One run of the job at `now`, with the database's clock at `now` too.
async function runAt(now: Date) {
  vi.setSystemTime(now);
  return postToTelegram(now);
}

// One run of Collecting results at `now`; the seconds it waits for Lichess's final standings pass at once.
async function collectAt(now: Date) {
  vi.setSystemTime(now);
  const run = collectResults(now);
  await vi.advanceTimersByTimeAsync(SETTLE_MS);
  return run;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(WEDNESDAY);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
  vi.stubEnv("TELEGRAM_GROUP_ID", GROUP);
  vi.stubEnv("TELEGRAM_INVITE_LINK", "https://t.me/+a-pretend-invite");
  vi.stubEnv("TELEGRAM_URL", "");
  vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.stubEnv("LICHESS_TEAM_ID", TEAM);
  vi.stubEnv("CRON_SECRET", SECRET);
  telegram = createFakeTelegram({ token: TOKEN, chats: [GROUP] });
  lichess = createFakeLichess({
    teamId: TEAM,
    teamPassword: "pw",
    accounts: ["ana", "ben", "cora", "zed"].map((id) => ({ id: `lichess-${id}`, username: `Lichess-${id}` })),
    tournaments: [{ id: TOURNAMENT, teamId: TEAM, status: "finished", startsAt: START.toISOString(), results: standings, games: exported }],
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    new URL(input instanceof Request ? input.url : String(input)).origin === "https://api.telegram.org" ? telegram.fetch(input, init) : lichess.fetch(input, init),
  );
  resetDb();
  addCompany("example.com", "Pretend Robotics");
  addPerson("ana", { name: "Member ana", companyDomain: "example.com" });
  for (const id of ["ben", "cora"]) addPerson(id, { name: `Member ${id}` });
  seasons.set(1, { number: 1, start: DATE });
  expect(await registerTournament(DATE, TOURNAMENT)).toBe(true);
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
});

afterEach(() => {
  // The bot's token never reached the log, whatever happened.
  expect(logged.join("\n")).not.toContain(TOKEN);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the reminders on a Matchday Sunday", () => {
  it("go out at 10:00 and 19:00 Vilnius time, each sending Members to the site, and nothing else that day", async () => {
    const runs: [string, string][] = [];
    for (const time of ["07:00", "09:59", "10:00", "10:07", "11:07", "18:07", "18:59", "19:00", "19:07", "19:59", "20:00", "21:07"]) {
      const run = await runAt(vilnius(time));
      runs.push([time, run.detail]);
    }
    expect(posted()).toEqual([MORNING, HOUR_BEFORE]);
    expect(runs.filter(([, detail]) => detail === POSTED_ONE).map(([time]) => time)).toEqual(["10:00", "19:00"]);
    expect(runs.find(([time]) => time === "10:07")?.[1]).toBe("Nothing to post.");
  });

  it("go out once when Vercel delivers the same run twice, or two deliveries meet", async () => {
    vi.setSystemTime(vilnius("10:00"));
    const [first, second] = await Promise.all([postToTelegram(vilnius("10:00")), postToTelegram(vilnius("10:00"))]);
    expect([first.outcome, second.outcome].sort()).toEqual(["done", "skipped"]);
    await runAt(vilnius("10:00"));
    expect(posted()).toEqual([MORNING]);
    // Without the job's hold, as when Collecting results delivers while a run does: each post is claimed by one.
    await runAt(vilnius("19:00"));
    telegramPosts.forEach((post) => Object.assign(post, { claimedAt: null, sentAt: null })); // as if never sent
    await Promise.all([deliverPosts(vilnius("19:01")), deliverPosts(vilnius("19:01"))]);
    // Once more, not twice more; and the morning one no more, as the 19:00 one is due.
    expect(posted()).toEqual([MORNING, HOUR_BEFORE, HOUR_BEFORE]);
  });

  it("are tried again by the next run when Telegram refused one, until the next is due", async () => {
    telegram.override = () => Response.json({ ok: false, error_code: 500, description: "Internal Server Error" }, { status: 500 });
    expect(await runAt(vilnius("10:00"))).toEqual({
      outcome: "failed",
      detail: "Couldn't post to the Telegram group: Telegram refused it: Internal Server Error. The next run tries again.",
      matchdayDate: null,
    });
    expect(posted()).toEqual([]);
    expect([...jobFailures.values()].map((f) => f.job)).toEqual([JOB]);
    telegram.override = undefined;
    expect((await runAt(vilnius("10:07"))).detail).toBe(POSTED_ONE);
    expect(posted()).toEqual([MORNING]);
  });

  it("are not posted once the next is due: a morning reminder Telegram refused all day gives way to the 19:00 one", async () => {
    telegram.override = () => Response.json({ ok: false, error_code: 429, description: "Too Many Requests: retry after 5" }, { status: 429 });
    for (const time of ["10:00", "12:07", "18:07"]) expect((await runAt(vilnius(time))).outcome).toBe("failed");
    telegram.override = undefined;
    await runAt(vilnius("19:00"));
    expect(posted()).toEqual([HOUR_BEFORE]);
  });

  it("are tried again when Telegram could not be reached at all", async () => {
    telegram.override = () => "unreachable";
    expect((await runAt(vilnius("10:00"))).detail).toBe(
      "Couldn't post to the Telegram group: Telegram couldn't be reached. The next run tries again.",
    );
    telegram.override = undefined;
    await runAt(vilnius("10:07"));
    expect(posted()).toEqual([MORNING]);
  });

  // A run that cannot tell whether Telegram posted the reminder: later runs never send it again, and from 15 minutes
  // after it was claimed ask the Organiser to look, until it is out of date at 19:00.
  const neverAgain = async (why: string) => {
    telegram.override = undefined;
    expect((await runAt(vilnius("10:07"))).detail).toBe("Nothing to post."); // a delivery may still be at it
    for (const time of ["10:16", "11:07", "18:07"]) expect(await runAt(vilnius(time))).toMatchObject({ outcome: "failed", detail: unsure(MORNING) });
    expect(await runAt(vilnius("19:07"))).toMatchObject({ outcome: "done", detail: POSTED_ONE }); // the 19:00 one
    expect(telegram.calls.filter((call) => call.params.text === MORNING)).toHaveLength(1);
    expect([...jobFailures.values()].map((f) => f.problem)).toEqual([unsure(MORNING, why), unsure(MORNING)]);
  };

  it.each([
    ["Telegram posted it and its answer never came", "lost", 1],
    ["Telegram never answered", "silent", 0],
  ] as const)("are never posted twice: not again when %s within 10 seconds", async (_, override, posts) => {
    telegram.override = () => override;
    vi.setSystemTime(vilnius("10:00"));
    const run = postToTelegram(vilnius("10:00"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await run).outcome).toBe("failed");
    expect(telegram.posts).toHaveLength(posts);
    await neverAgain("Telegram didn't answer within 10 s");
  });

  it("are never posted twice: not again when the connection broke once the request was out", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
    });
    telegram.calls.push({ method: "sendMessage", token: TOKEN, params: { chat_id: GROUP, text: MORNING } }); // as Telegram got it
    expect((await runAt(vilnius("10:00"))).outcome).toBe("failed");
    vi.stubGlobal("fetch", telegram.fetch);
    await neverAgain("the connection to Telegram broke");
  });

  it("are never posted twice: not again when an answer that is not Telegram's came back", async () => {
    telegram.override = () => new Response("<html>502 Bad Gateway</html>", { status: 502 });
    expect((await runAt(vilnius("10:00"))).outcome).toBe("failed");
    await neverAgain("Telegram answered 502 without saying");
  });

  it("are not posted on a skipped Sunday, nor before the Matchday is on Lichess, which the run says", async () => {
    matchdays.clear();
    expect((await runAt(vilnius("10:00"))).detail).toBe("The Matchday of Sunday 29 November isn't on Lichess, so its 10:00 reminder wasn't posted.");
    expect(await registerTournament(DATE, TOURNAMENT)).toBe(true);
    expect((await runAt(vilnius("10:07"))).detail).toBe(POSTED_ONE); // once it is, within the hour
    skippedSundays.set("2026-12-06", { date: "2026-12-06" });
    expect(await runAt(vilnius("10:00", "2026-12-06"))).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(posted()).toEqual([MORNING]);
  });
});

describe("the Recap", () => {
  it("is posted as Collecting results stores the Matchday: its link, its top three and its Awards, by name", async () => {
    const run = await collectAt(OVER);
    expect(run.outcome).toBe("done");
    expect(posted()).toEqual([RECAP]);
    expect(telegram.posts[0].chatId).toBe(GROUP);
  });

  it("says less than the public Recap: no Company, Lichess username, rating, tournament or Game", async () => {
    await collectAt(OVER);
    for (const hidden of ["Pretend Robotics", "example.com", "Lichess-", "lichess.org", TOURNAMENT, "Pretend01", "1610", "1500"])
      expect(posted()[0]).not.toContain(hidden);
  });

  it("writes each name so that Telegram can make no link of it: no address, @username, #hashtag, $cashtag, /command or number", async () => {
    Object.assign(people.get("ana")!, { name: "Ana evil.example https://t.me/scam" });
    Object.assign(people.get("ben")!, { name: "@pretend_scammer #free $USD /start +37060000000 ben@mail.example" });
    Object.assign(people.get("cora")!, { name: `J. R. O'Neil-Šimkutė ${"x".repeat(300)}` });
    await collectAt(OVER);
    const [, top, awards] = posted()[0].split("\n\n");
    expect(top.split("\n")).toEqual([
      "1. Ana evil example https t me scam: 4 points",
      "2. pretend scammer free USD start ben mail example: 2 points",
      `3. J. R. O'Neil-Šimkutė ${"x".repeat(100 - "J. R. O'Neil-Šimkutė ".length)}: 0.5 points`,
    ]);
    expect(awards).toContain("Biggest upset: Ana evil example https t me scam beat someone");
    Object.assign(people.get("ana")!, { name: "@@@ 123" });
    expect(await postRecap(DATE, OVER)).toBe("Nothing to post."); // sent already: a new text would not be
  });

  it("names someone whose name is nothing a post can write as \"a Member\"", async () => {
    Object.assign(people.get("ana")!, { name: "@@@ 123 ://" });
    await collectAt(OVER);
    expect(posted()[0]).toContain("\n1. a Member: 4 points\n");
  });

  it("is posted once: not by later runs, nor when pnpm ingest or another collection finds it stored", async () => {
    await collectAt(OVER);
    await runAt(new Date(OVER.getTime() + 37 * MINUTE));
    expect(await postRecap(DATE, new Date(OVER.getTime() + 40 * MINUTE))).toBe("Nothing to post.");
    await collectAt(new Date(OVER.getTime() + 45 * MINUTE));
    expect(await ingestTournament(TOURNAMENT)).toEqual({ outcome: "unchanged", date: DATE });
    expect(posted()).toEqual([RECAP]);
  });

  it("never undoes or holds up the collection when it cannot be posted, and the next run posts it", async () => {
    telegram.override = () => Response.json({ ok: false, error_code: 502, description: "Bad Gateway" }, { status: 502 });
    const run = await collectAt(OVER);
    expect(run).toMatchObject({ outcome: "done", detail: expect.stringMatching(/^Collected the results of .*The Recap is public\.$/) });
    expect(results.size).toBe(3);
    expect(posted()).toEqual([]);
    telegram.override = undefined;
    expect((await runAt(at("2026-11-29T20:07:00Z"))).detail).toBe(POSTED_ONE);
    expect(posted()).toEqual([RECAP]);
  });

  it("never undoes the collection when the database fails while posting, and a later run posts it", async () => {
    const answer = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('"telegramPost"')) throw new Error("the database went away");
      return answer(sql, params);
    });
    const run = await collectAt(OVER);
    expect(run.outcome).toBe("done");
    expect(results.size).toBe(3);
    expect(logged).toContain("Posting the Recap failed: the database went away");
    db.query.mockImplementation(answer);
    await runAt(at("2026-11-29T20:07:00Z"));
    expect(posted()).toEqual([RECAP]);
  });

  it("is posted by the next run when its results were stored where Telegram is not set up, until the next Matchday starts", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(await postRecap(DATE, OVER)).toBe("Telegram isn't set up, so the Recap wasn't posted.");
    vi.setSystemTime(OVER);
    expect((await ingestTournament(TOURNAMENT)).outcome).toBe("ingested");
    expect(telegramPosts.size).toBe(0);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    // Once the next Matchday has started it would be old news; the Saturday before, it is not.
    expect(await runAt(matchdayStart("2026-12-06"))).toMatchObject({ detail: "Nothing to post." });
    expect(await runAt(at("2026-12-05T12:07:00Z"))).toMatchObject({ detail: POSTED_ONE });
    expect(posted()).toEqual([RECAP]);
  });
});

describe("the posts the site keeps", () => {
  it("are deleted by the first run after they stop being worth posting: a Recap's, which names Members, by the next Matchday", async () => {
    await collectAt(OVER);
    await skipSunday("2026-12-13", WEDNESDAY);
    expect(telegramPosts.size).toBe(2);
    await runAt(new Date(matchdayStart("2026-12-06").getTime() - MINUTE));
    expect(telegramPosts.size).toBe(2);
    await runAt(matchdayStart("2026-12-06"));
    expect([...telegramPosts.values()].map((post) => post.text)).toEqual([
      "No Matchday on Sunday 13 December. The next one is on Sunday 20 December at 20:00.",
    ]);
  });
});

const refused = () => Response.json({ ok: false, error_code: 500, description: "Internal Server Error" }, { status: 500 });

describe("a post Telegram may have posted, wherever it was sent from", () => {
  it("is reported by the next run when it was the Recap Collecting results sent", async () => {
    telegram.override = () => "lost";
    vi.setSystemTime(OVER);
    const run = collectResults(OVER);
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10_000);
    expect((await run).outcome).toBe("done");
    telegram.override = undefined;
    expect(await runAt(at("2026-11-29T20:07:00Z"))).toMatchObject({ outcome: "failed", detail: unsure(RECAP) });
    expect(posted()).toEqual([RECAP]); // the one Telegram got, and no other
  });

  it("is reported by the next run when it was a notice the change sent", async () => {
    telegram.override = () => "lost";
    const skipping = skipSunday("2026-12-06", WEDNESDAY);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await skipping).toBeNull();
    telegram.override = undefined;
    const notice = "No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00.";
    expect(await runAt(at("2026-11-25T13:07:00Z"))).toMatchObject({ outcome: "failed", detail: unsure(notice) });
    expect(posted()).toEqual([notice]);
  });

  it("is reported once a delivery has held it for 15 minutes without sending it, as when the run died", async () => {
    await queuePost({ key: "reminder:2026-11-29:10", text: MORNING, until: vilnius("19:00") });
    telegramPosts.get("reminder:2026-11-29:10")!.claimedAt = vilnius("10:00"); // and then nothing
    expect(await runAt(vilnius("10:14"))).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(await runAt(vilnius("10:15"))).toMatchObject({ outcome: "failed", detail: unsure(MORNING) });
    expect(posted()).toEqual([]);
  });
});

describe("a Recap waiting to be posted", () => {
  // Leaving deletes the "user" row: their results go with it, and each Game keeps an empty side (migrations/006).
  const leaves = (id: string) => {
    people.delete(id);
    for (const [key, row] of results) if (row.userId === id) results.delete(key);
    for (const g of games.values()) Object.assign(g, { whiteId: g.whiteId === id ? null : g.whiteId, blackId: g.blackId === id ? null : g.blackId });
  };

  it("names nobody who has left since it was queued", async () => {
    telegram.override = refused;
    await collectAt(OVER);
    leaves("ben");
    telegram.override = undefined;
    await runAt(at("2026-11-29T20:07:00Z"));
    expect(posted()).toEqual([RECAP.replace("2. Member ben: 2 points\n3. Member cora: 0.5 points", "2. Member cora: 0.5 points")]);
  });

  it("names nobody whose Lichess account has been marked since, and no Award of theirs", async () => {
    telegram.override = refused;
    await collectAt(OVER);
    people.get("ana")!.lichessMarked = true;
    telegram.override = undefined;
    await runAt(at("2026-11-29T20:07:00Z"));
    expect(posted()).toEqual(["The Recap of Sunday 29 November is up: https://offboard.test/recaps/2026-11-29\n\n1. Member ben: 2 points\n2. Member cora: 0.5 points"]);
  });

  it("keeps the text it was sent with once a delivery has claimed it", async () => {
    telegram.override = () => new Response("Bad Gateway", { status: 502 });
    await collectAt(OVER);
    leaves("ben");
    await runAt(at("2026-11-29T20:07:00Z"));
    expect(telegramPosts.get("recap:2026-11-29")?.text).toBe(RECAP);
  });
});

describe("a skipped Sunday", () => {
  const notice = "No Matchday on Sunday 29 November. The next one is on Sunday 6 December at 20:00.";

  it("takes back its reminder that Telegram refused, so that only the notice goes out", async () => {
    telegram.override = refused;
    await runAt(vilnius("10:00"));
    telegram.override = undefined;
    vi.setSystemTime(vilnius("15:00"));
    expect(await skipSunday(DATE, vilnius("15:00"))).toBeNull();
    for (const time of ["15:07", "16:07", "19:00", "19:07"]) await runAt(vilnius(time));
    expect(posted()).toEqual([notice]);
  });

  it("leaves a reminder Telegram may have posted, which the runs go on reporting", async () => {
    telegram.override = () => new Response("Bad Gateway", { status: 502 });
    await runAt(vilnius("10:00"));
    telegram.override = undefined;
    vi.setSystemTime(vilnius("15:00"));
    expect(await skipSunday(DATE, vilnius("15:00"))).toBeNull();
    expect(await runAt(vilnius("15:07"))).toMatchObject({ outcome: "failed", detail: unsure(MORNING) });
    expect(posted()).toEqual([notice]);
  });
});

describe("a change to the schedule", () => {
  it("posts the notice it queued, or an older one, and nothing else: one request to Telegram at most", async () => {
    telegram.override = refused;
    await collectAt(OVER); // the Recap, refused, waits
    await skipSunday("2026-12-13", OVER); // its notice, refused, waits
    telegram.override = undefined;
    const before = telegram.calls.length;
    expect(await skipSunday("2026-12-20", OVER)).toBeNull();
    expect(telegram.calls.length - before).toBe(1);
    expect(posted()).toEqual(["No Matchday on Sunday 13 December. The next one is on Sunday 20 December at 20:00."]);
  });
});

describe("Telegram's answers", () => {
  it("are read for its reason, cut to 200 characters, and for the new id of a group that became a supergroup", async () => {
    const long = `Bad Request: ${"x".repeat(400)}`;
    telegram.override = () => Response.json({ ok: false, error_code: 400, description: long }, { status: 400 });
    expect((await runAt(vilnius("10:00"))).detail).toBe(`Couldn't post to the Telegram group: Telegram refused it: ${long.slice(0, 200)}. The next run tries again.`);
    telegram.override = () =>
      Response.json(
        { ok: false, error_code: 400, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -1001234567890 } },
        { status: 400 },
      );
    expect((await runAt(vilnius("10:07"))).detail).toBe(
      "Couldn't post to the Telegram group: Telegram refused it: Bad Request: group chat was upgraded to a supergroup chat. The group's id is now -1001234567890. The next run tries again.",
    );
  });

  it("come from api.telegram.org alone in production, whatever TELEGRAM_URL says, and from the fake it names elsewhere", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(new URL(input instanceof Request ? input.url : String(input)).origin);
      return telegram.fetch(input, init);
    });
    vi.stubEnv("TELEGRAM_URL", "https://fake.telegram.example");
    vi.stubEnv("NODE_ENV", "production");
    await runAt(vilnius("10:00"));
    vi.stubEnv("NODE_ENV", "test");
    await runAt(vilnius("19:00"));
    expect(asked).toEqual(["https://api.telegram.org", "https://fake.telegram.example"]);
    expect(posted()).toEqual([MORNING, HOUR_BEFORE]);
  });
});

describe("the notices of the schedule", () => {
  it("tell the group once when a Sunday is skipped, with the next Matchday", async () => {
    expect(await skipSunday("2026-12-06", WEDNESDAY)).toBeNull();
    expect(posted()).toEqual(["No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00."]);
    expect(await skipSunday("2026-12-06", WEDNESDAY)).toBeNull();
    await Promise.all([skipSunday("2026-12-13", WEDNESDAY), skipSunday("2026-12-13", WEDNESDAY)]);
    await runAt(at("2026-11-25T13:07:00Z"));
    expect(posted()).toEqual([
      "No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00.",
      "No Matchday on Sunday 13 December. The next one is on Sunday 20 December at 20:00.",
    ]);
  });

  it("tell the group when a skipped Sunday has its Matchday back, in the order they happened", async () => {
    await skipSunday("2026-12-06", WEDNESDAY);
    expect(await unskipSunday("2026-12-06", WEDNESDAY)).toBeNull();
    expect(await unskipSunday("2026-12-06", WEDNESDAY)).toBeNull();
    expect(posted()).toEqual([
      "No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00.",
      "Sunday 6 December has a Matchday after all, at 20:00.",
    ]);
  });

  it("say nothing of a Sunday that had no Matchday to skip, nor of a change that is refused", async () => {
    // Season 1's six Matchdays end on 3 January; the week off is 10 January.
    expect(await skipSunday("2027-01-10", WEDNESDAY)).toBeNull();
    expect(await unskipSunday("2027-01-10", WEDNESDAY)).toBeNull();
    expect(await skipSunday("2026-12-08", WEDNESDAY)).toBe("2026-12-08 is not a Sunday.");
    expect(await skipSunday("2026-11-29", START)).toBe("It is too late to change 2026-11-29.");
    expect(telegramPosts.size).toBe(0);
    expect(posted()).toEqual([]);
  });

  it("announce a Season's start once when the Organiser sets it, and again when it moves", async () => {
    expect(await setSeasonStart(2, "2027-01-24", WEDNESDAY)).toBeNull();
    await Promise.all([setSeasonStart(2, "2027-01-24", WEDNESDAY), setSeasonStart(2, "2027-01-24", WEDNESDAY)]);
    // Season 3 starts on 14 March by itself, two weeks after Season 2's last Matchday: setting that is not news.
    expect(await setSeasonStart(3, "2027-03-14", WEDNESDAY)).toBeNull();
    expect(seasons.get(3)).toEqual({ number: 3, start: "2027-03-14" });
    expect(await setSeasonStart(2, "2027-01-31", WEDNESDAY)).toBeNull();
    expect(posted()).toEqual(["Season 2 starts on Sunday 24 January at 20:00.", "Season 2 starts on Sunday 31 January at 20:00."]);
  });

  it("announce Season 1 once when the sixteenth sign-up schedules it, at the next run, not on the page being read", async () => {
    seasons.clear();
    for (let n = 1; n <= 16; n++) addPerson(`m${n}`); // all on Tuesday 24 November: Season 1 starts 6 December
    await Promise.all([upcomingMatchday(WEDNESDAY), upcomingMatchday(WEDNESDAY)]);
    expect(seasons.get(1)).toEqual({ number: 1, start: "2026-12-06" });
    expect(posted()).toEqual([]);
    expect((await runAt(at("2026-11-25T13:07:00Z"))).detail).toBe(POSTED_ONE);
    expect(posted()).toEqual(["Season 1 starts on Sunday 6 December at 20:00."]);
  });

  it("leave the change made when Telegram refuses them, and are posted by the next run until their Sunday begins", async () => {
    telegram.override = () => Response.json({ ok: false, error_code: 500, description: "Internal Server Error" }, { status: 500 });
    expect(await skipSunday("2026-12-06", WEDNESDAY)).toBeNull();
    // The skip moves Season 2 to 24 January by itself; the Organiser sets it a week later.
    expect(await setSeasonStart(2, "2027-01-31", WEDNESDAY)).toBeNull();
    expect(skippedSundays.has("2026-12-06")).toBe(true);
    expect(seasons.get(2)).toEqual({ number: 2, start: "2027-01-31" });
    telegram.override = undefined;
    expect(await runAt(matchdayStart("2026-12-06"))).toMatchObject({ detail: POSTED_ONE }); // the skip is old news by then
    expect(posted()).toEqual(["Season 2 starts on Sunday 31 January at 20:00."]);
  });
});

describe("with Telegram not set up", () => {
  it.each([
    ["no token", { TELEGRAM_BOT_TOKEN: "" }],
    ["no group", { TELEGRAM_GROUP_ID: "" }],
    ["a token that is not in the form of one", { TELEGRAM_BOT_TOKEN: "pretend/../token" }],
    ["a group id that is not in the form of one", { TELEGRAM_GROUP_ID: "https://t.me/+a-pretend-invite" }],
  ])("posts nothing with %s: no error, and the job is skipped, not failed", async (_, settings) => {
    for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
    expect(await runAt(vilnius("10:00"))).toEqual({ outcome: "skipped", detail: "Telegram isn't set up, so nothing is posted.", matchdayDate: null });
    expect(await skipSunday("2026-12-06", WEDNESDAY)).toBeNull();
    expect(await setSeasonStart(2, "2027-01-24", WEDNESDAY)).toBeNull();
    expect((await collectAt(OVER)).outcome).toBe("done");
    expect(await deliverPosts(OVER)).toEqual({ posted: 0, failed: null });
    expect(telegramPosts.size).toBe(0);
    expect(telegram.calls).toEqual([]);
    expect(jobFailures.size).toBe(0);
  });

  it("keeps no post once it is out of date, though Telegram was switched off with posts waiting", async () => {
    telegram.override = refused;
    await collectAt(OVER); // the Recap, which names Members, waits
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(await runAt(new Date(matchdayStart("2026-12-06").getTime() - MINUTE))).toMatchObject({ outcome: "skipped" });
    expect(telegramPosts.size).toBe(1);
    expect(await runAt(matchdayStart("2026-12-06"))).toMatchObject({ outcome: "skipped" });
    expect(telegramPosts.size).toBe(0);
  });
});

describe("a delivery", () => {
  it("sends at most ten posts, and leaves the rest for the next", async () => {
    for (let n = 1; n <= 11; n++) await queuePost({ key: `post ${n}`, text: `Post ${n}`, until: START });
    expect(await deliverPosts(WEDNESDAY)).toEqual({ posted: 10, failed: null });
    expect(await deliverPosts(WEDNESDAY)).toEqual({ posted: 1, failed: null });
    expect(posted()).toEqual(Array.from({ length: 11 }, (_, i) => `Post ${i + 1}`));
  });

  it("sends nothing without the group, and asks Telegram nothing without the token, leaving the post to wait", async () => {
    await queuePost({ key: "waiting", text: "Waiting", until: START });
    vi.stubEnv("TELEGRAM_GROUP_ID", "");
    expect(await deliverPosts(WEDNESDAY)).toEqual({ posted: 0, failed: null });
    vi.stubEnv("TELEGRAM_GROUP_ID", GROUP);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(await deliverPosts(WEDNESDAY)).toEqual({ posted: 0, failed: { text: "Waiting", problem: "TELEGRAM_BOT_TOKEN isn't set", perhaps: false } });
    expect(telegram.calls).toEqual([]);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    expect(await deliverPosts(WEDNESDAY)).toEqual({ posted: 1, failed: null });
  });
});

describe("the bot", () => {
  it("only posts: every request it makes is sendMessage to the group, and it reads nothing", async () => {
    await skipSunday("2026-12-06", WEDNESDAY);
    await setSeasonStart(2, "2027-01-31", WEDNESDAY);
    await runAt(vilnius("10:00"));
    await runAt(vilnius("19:00"));
    await collectAt(OVER);
    expect(posted()).toHaveLength(5);
    expect(telegram.calls.map((call) => [call.method, call.token, call.params.chat_id])).toEqual(Array(5).fill(["sendMessage", TOKEN, GROUP]));
    expect(telegram.posts.every((post) => post.chatId === GROUP)).toBe(true);
  });
});

describe("the endpoint Vercel calls", () => {
  const call = (headers: Record<string, string> = {}) => cronRequest(new Request("https://offboard.test/api/jobs/post-to-telegram", { headers }));
  const fromVercel = { authorization: `Bearer ${SECRET}` };

  it.each([
    ["no credential", {}],
    ["the wrong secret", { authorization: "Bearer not-the-secret-at-all-000000" }],
  ])("refuses a request with %s, before reading anything", async (_, headers) => {
    db.query.mockClear();
    expect((await call(headers)).status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
    expect(telegram.calls).toEqual([]);
  });

  it("runs the job for Vercel's scheduled request, and answers what it did", async () => {
    vi.setSystemTime(vilnius("10:00"));
    const response = await call(fromVercel);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "done", detail: POSTED_ONE, matchdayDate: null });
    expect(scheduledJobs.get(JOB)?.lastOutcome).toBe("done");
  });

  it("answers 500 when the run failed", async () => {
    telegram.override = () => Response.json({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, { status: 400 });
    vi.setSystemTime(vilnius("10:00"));
    const response = await call(fromVercel);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ outcome: "failed" });
  });
});

describe("the schedule Vercel runs it on (vercel.json)", () => {
  const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")).crons;
  const schedules = crons.filter((c) => c.path === "/api/jobs/post-to-telegram").map((c) => c.schedule);

  // Whether a cron field ("*", "7", "7,8,16,17", "*/5", ranges) takes `value`. Vercel reads its expressions in UTC.
  const takes = (field: string, value: number) =>
    field.split(",").some((part) => {
      const [range, step = "1"] = part.split("/");
      const [low, high] = range === "*" ? [0, Infinity] : range.includes("-") ? range.split("-").map(Number) : [Number(range), Number(range)];
      return value >= low && value <= high && (value - (range === "*" ? 0 : low)) % Number(step) === 0;
    });
  const runsAt = (when: Date) =>
    schedules.some((schedule) => {
      const [minute, hour, day, month, weekday] = schedule.split(" ");
      return (
        takes(minute, when.getUTCMinutes()) &&
        takes(hour, when.getUTCHours()) &&
        takes(day, when.getUTCDate()) &&
        takes(month, when.getUTCMonth() + 1) &&
        takes(weekday, when.getUTCDay())
      );
    });

  it.each([
    ["in winter time", "2026-11-29", "+02:00"],
    ["in summer time", "2027-06-27", "+03:00"],
    ["on the Sunday summer time begins", "2027-03-28", "+03:00"],
    ["on the Sunday summer time ends", "2027-10-31", "+02:00"],
  ])("posts the reminders at 10:00 and 19:00 Vilnius time, once each, %s", async (_, date, offset) => {
    matchdays.clear();
    seasons.set(1, { number: 1, start: date });
    expect(await registerTournament(date, TOURNAMENT)).toBe(true);
    const postedAt: [string, string][] = [];
    for (let minute = Date.parse(`${date}T00:00:00Z`); minute < Date.parse(`${date}T24:00:00Z`); minute += MINUTE) {
      if (!runsAt(new Date(minute))) continue;
      const before = telegram.posts.length;
      await runAt(new Date(minute));
      for (const post of telegram.posts.slice(before)) postedAt.push([new Date(minute).toISOString(), post.text]);
    }
    expect(postedAt).toEqual([
      [at(`${date}T10:00:00${offset}`).toISOString(), MORNING],
      [at(`${date}T19:00:00${offset}`).toISOString(), HOUR_BEFORE],
    ]);
  });

  it("runs at least once an hour all week, to try again what failed", () => {
    for (let when = Date.parse("2026-11-30T00:00:00Z"); when < Date.parse("2026-12-07T00:00:00Z"); when += 17 * MINUTE) {
      let next = Math.ceil(when / MINUTE) * MINUTE;
      while (!runsAt(new Date(next))) next += MINUTE;
      expect(next - when).toBeLessThanOrEqual(60 * MINUTE);
    }
  });
});
