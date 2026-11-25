// The bot's posts to the Club's Telegram group (#13), through the ways they come about: the scheduled job (postToTelegram,
// at a supplied time), the endpoint Vercel calls and the schedule it calls it on (vercel.json); Collecting results and
// pnpm ingest storing a Matchday's results (postRecap); and the changes to the schedule (lib/seasons.ts). Faked:
// Telegram (lib/fixtures/fake-telegram.ts) and Lichess (lib/fixtures/fake-lichess.ts), standing in for fetch, the
// database (lib/fake-db.ts) and the clock. Everything else is the app's own code.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cronRequest } from "@/app/api/jobs/post-to-telegram/route";
import { addCompany, addPerson, db, jobFailures, matchdays, people, resetDb, results, scheduledJobs, seasons, skippedSundays, telegramPosts } from "@/lib/fake-db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { collectResults, SETTLE_MS } from "./collect-results";
import type { JobRun } from "./jobs";
import { removeMember } from "./leaving";
import { ingestTournament, registerTournament } from "./matchdays";
import { finishOrganiserConnection, startOrganiserConnection } from "./organiser-lichess";
import { JOB, postRecap, postToTelegram } from "./post-to-telegram";
import { changeSeasonStart, skipMatchday, unskipMatchday } from "./reschedule";
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
// What is said of a post Telegram may have posted, by its first line, whichever run says it.
const unsure = (text: string) => `It isn't known whether Telegram posted "${text.split("\n")[0]}", so it won't be posted again. Check the group.`;

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

  // A run that cannot tell whether Telegram posted the reminder fails, asking the Organiser to look: one failure, in the
  // words a later run would use. Later runs never send it again, and record only what they do themselves.
  const neverAgain = async (run: Promise<JobRun> | JobRun) => {
    expect(await run).toMatchObject({ outcome: "failed", detail: unsure(MORNING) });
    telegram.override = undefined;
    for (const time of ["10:07", "10:16", "11:07", "18:07"]) expect(await runAt(vilnius(time))).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(await runAt(vilnius("19:07"))).toMatchObject({ outcome: "done", detail: POSTED_ONE }); // the 19:00 one
    expect(telegram.calls.filter((call) => call.params.text === MORNING)).toHaveLength(1);
    expect([...jobFailures.values()].map((f) => f.problem)).toEqual([unsure(MORNING)]);
  };

  it.each([
    ["Telegram posted it and its answer never came", "lost", 1],
    ["Telegram never answered", "silent", 0],
  ] as const)("are never posted twice: not again when %s within 10 seconds", async (_, override, posts) => {
    telegram.override = () => override;
    vi.setSystemTime(vilnius("10:00"));
    const run = postToTelegram(vilnius("10:00"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(telegram.posts).toHaveLength(posts);
    await neverAgain(run);
  });

  it("are never posted twice: not again when the connection broke once the request was out", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
    });
    telegram.calls.push({ method: "sendMessage", token: TOKEN, params: { chat_id: GROUP, text: MORNING } }); // as Telegram got it
    const run = await runAt(vilnius("10:00"));
    vi.stubGlobal("fetch", telegram.fetch);
    await neverAgain(run);
  });

  it("are never posted twice: not again when an answer that is not Telegram's came back", async () => {
    telegram.override = () => new Response("<html>502 Bad Gateway</html>", { status: 502 });
    await neverAgain(await runAt(vilnius("10:00")));
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
    Object.assign(people.get("cora")!, { name: `J. R. O'Neil-Šimkutė ${"ą".repeat(300)}` });
    await collectAt(OVER);
    const [, top, awards] = posted()[0].split("\n\n");
    expect(top.split("\n")).toEqual([
      "1. Ana evil example https t me scam: 4 points",
      "2. pretend scammer free USD start ben mail example: 2 points",
      `3. J. R. O'Neil-Šimkutė ${"ą".repeat(100 - "J. R. O'Neil-Šimkutė ".length)}: 0.5 points`,
    ]);
    expect(awards).toContain("Biggest upset: Ana evil example https t me scam beat someone");
    Object.assign(people.get("ana")!, { name: "@@@ 123" });
    expect(await postRecap(DATE, OVER)).toBe("Nothing to post."); // sent already: a new text would not be
  });

  // Whether Telegram's apps take `text` for an address in the TON blockchain, as TDLib checks one
  // (TonWalletManager::check_ton_address): 48 characters of base64, 36 bytes whose first is tagged 0x11 in its low six
  // bits and whose last two are the CRC-16/XMODEM of the rest.
  const isTonAddress = (text: string) => {
    const bytes = Buffer.from(text, "base64url");
    let crc = 0;
    for (const byte of bytes.subarray(0, 34)) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return text.length === 48 && bytes.length === 36 && (bytes[0] & 0x3f) === 0x11 && crc === bytes.readUInt16BE(34);
  };

  it("writes no TON address, which can be letters alone: an unbroken run of 40 or more ASCII characters is left out", async () => {
    const address = "UQDgfzSWkgMaLQUjwGDxcetPqbqfyqXyQKbIcKxuGEJeCxjl";
    expect(isTonAddress(address)).toBe(true);
    const run = (length: number) => "Ab-".repeat(14).slice(0, length);
    Object.assign(people.get("ana")!, { name: `Ana ${address}` });
    Object.assign(people.get("ben")!, { name: `Ben ${run(39)}` });
    Object.assign(people.get("cora")!, { name: `Cora ${run(40)}Šimkutė` });
    await collectAt(OVER);
    expect(posted()[0].split("\n\n")[1].split("\n")).toEqual(["1. Ana: 4 points", `2. Ben ${run(39)}: 2 points`, "3. Cora Šimkutė: 0.5 points"]);
    expect(posted()[0]).not.toContain(address);
  });

  it("keeps a Cyrillic, Greek or CJK name as it is", async () => {
    const names = { ana: "Иван Петров", ben: "Ἀριστοτέλης Παπαδόπουλος", cora: "山田太郎" };
    for (const [id, name] of Object.entries(names)) Object.assign(people.get(id)!, { name });
    await collectAt(OVER);
    expect(posted()[0].split("\n\n")[1].split("\n")).toEqual([`1. ${names.ana}: 4 points`, `2. ${names.ben}: 2 points`, `3. ${names.cora}: 0.5 points`]);
  });

  it("names someone whose name is nothing a post can write, or only full stops, hyphens and apostrophes, as \"a Member\"", async () => {
    Object.assign(people.get("ana")!, { name: "@@@ 123 ://" });
    Object.assign(people.get("ben")!, { name: "..." });
    Object.assign(people.get("cora")!, { name: "- '’ -." });
    await collectAt(OVER);
    expect(posted()[0].split("\n\n")[1].split("\n")).toEqual(["1. a Member: 4 points", "2. a Member: 2 points", "3. a Member: 0.5 points"]);
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
  const failures = () => [...jobFailures.values()].map(({ job, problem }) => `${job}: ${problem}`);

  it("is one failure, found by the next run, when it was the Recap Collecting results sent", async () => {
    telegram.override = () => "lost";
    vi.setSystemTime(OVER);
    const run = collectResults(OVER);
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10_000);
    expect((await run).outcome).toBe("done");
    telegram.override = undefined;
    for (const time of ["2026-11-29T20:07:00Z", "2026-11-29T21:07:00Z"])
      expect(await runAt(at(time))).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(failures()).toEqual([`${JOB}: ${unsure(RECAP)}`]);
    expect(posted()).toEqual([RECAP]); // the one Telegram got, and no other
  });

  it("is one failure, found by the next run, when it was a notice the change sent", async () => {
    telegram.override = () => "lost";
    const skipping = skipMatchday("2026-12-06", WEDNESDAY);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await skipping).toMatchObject({ problem: false });
    telegram.override = undefined;
    const notice = "No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00.";
    for (const time of ["2026-11-25T13:07:00Z", "2026-11-25T14:07:00Z"])
      expect(await runAt(at(time))).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(failures()).toEqual([`${JOB}: ${unsure(notice)}`]);
    expect(posted()).toEqual([notice]);
  });

  it("is a failure once a delivery has held it for 15 minutes without sending it, as when the run died", async () => {
    await queuePost({ key: "reminder:2026-11-29:10", text: MORNING, until: vilnius("19:00") });
    telegramPosts.get("reminder:2026-11-29:10")!.claimedAt = vilnius("10:00"); // and then nothing
    expect(await runAt(vilnius("10:14"))).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(failures()).toEqual([]);
    expect(await runAt(vilnius("10:15"))).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(failures()).toEqual([`${JOB}: ${unsure(MORNING)}`]);
    expect(posted()).toEqual([]);
  });

  it("is let go a day after it was sent, though it is kept, never sent, until its Sunday: a notice a year ahead", async () => {
    telegram.override = () => "lost";
    const skipping = skipMatchday("2027-11-21", WEDNESDAY);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await skipping).toMatchObject({ problem: false });
    telegram.override = undefined;
    const [notice] = posted();
    for (const time of ["2026-11-25T13:07:00Z", "2026-11-26T11:59:00Z", "2026-11-26T12:00:00Z", "2027-03-01T10:07:00Z", "2027-11-20T10:07:00Z"])
      expect((await runAt(at(time))).outcome).not.toBe("failed");
    expect(failures()).toEqual([`${JOB}: ${unsure(notice)}`]);
    expect([...telegramPosts.values()]).toMatchObject([{ text: notice, sentAt: null, claimedAt: expect.any(Date) }]);
    await runAt(matchdayStart("2027-11-21"));
    expect(telegramPosts.size).toBe(0);
    expect(posted()).toEqual([notice]);
  });

  it("leaves each run to record what it did: one that posts a notice meanwhile is done", async () => {
    telegram.override = () => "lost";
    vi.setSystemTime(vilnius("10:00"));
    const run = postToTelegram(vilnius("10:00"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await run).toMatchObject({ outcome: "failed", detail: unsure(MORNING) });
    telegram.override = undefined;
    await skipSunday("2026-12-13", vilnius("11:00"));
    expect(await runAt(vilnius("11:07"))).toEqual({ outcome: "done", detail: POSTED_ONE, matchdayDate: null });
    expect(failures()).toEqual([`${JOB}: ${unsure(MORNING)}`]);
    expect(posted()).toEqual([MORNING, "No Matchday on Sunday 13 December. The next one is on Sunday 20 December at 20:00."]);
  });
});

describe("a Recap waiting to be posted", () => {
  // Leaving, and the Organiser's removing a Member, are this one removal (lib/leaving.ts, app/organiser/actions.ts).
  const leaves = async (id: string) => expect(await removeMember(id)).toBe(true);

  it("names nobody who has left, or been removed by the Organiser, since it was queued", async () => {
    telegram.override = refused;
    await collectAt(OVER);
    await leaves("ben");
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
    await leaves("ben");
    await runAt(at("2026-11-29T20:07:00Z"));
    expect(telegramPosts.get("recap:2026-11-29")?.text).toBe(RECAP);
  });
});

describe("a skipped Sunday", () => {
  const notice = "No Matchday on Sunday 29 November. The next one is on Sunday 6 December at 20:00.";

  it("gets no reminder Telegram refused before it was skipped: only the notice goes out", async () => {
    telegram.override = refused;
    await runAt(vilnius("10:00"));
    telegram.override = undefined;
    vi.setSystemTime(vilnius("15:00"));
    expect(await skipMatchday(DATE, vilnius("15:00"))).toMatchObject({ text: expect.stringMatching(/^Sunday 29 November is skipped/) });
    for (const time of ["15:07", "16:07", "19:00", "19:07"]) await runAt(vilnius(time));
    expect(posted()).toEqual([notice]);
  });

  it("leaves a reminder Telegram may have posted as it is, never sent again, and its one failure", async () => {
    telegram.override = () => new Response("Bad Gateway", { status: 502 });
    expect(await runAt(vilnius("10:00"))).toMatchObject({ outcome: "failed", detail: unsure(MORNING) });
    telegram.override = undefined;
    vi.setSystemTime(vilnius("15:00"));
    expect(await skipMatchday(DATE, vilnius("15:00"))).toMatchObject({ text: expect.stringMatching(/^Sunday 29 November is skipped/) });
    expect(await runAt(vilnius("15:07"))).toMatchObject({ outcome: "skipped", detail: "Nothing to post." });
    expect(telegramPosts.get(`reminder:${DATE}:10`)).toMatchObject({ sentAt: null, claimedAt: expect.any(Date) });
    expect([...jobFailures.values()].map((f) => f.problem)).toEqual([unsure(MORNING)]);
    expect(posted()).toEqual([notice]);
  });
});

describe("a waiting reminder, decided on what is true when it is sent", () => {
  const refusedAtTen = async () => {
    telegram.override = refused;
    await runAt(vilnius("10:00"));
    telegram.override = undefined;
  };

  it("is not sent once a Season's new start has made its Sunday no Matchday", async () => {
    await refusedAtTen();
    vi.setSystemTime(vilnius("10:30"));
    expect(await changeSeasonStart(1, "2026-12-06", vilnius("10:30"))).toMatchObject({ text: expect.stringContaining("Season 1 now starts on Sunday 6 December") });
    expect(matchdays.has(DATE)).toBe(false); // its tournament cleared, to cancel on Lichess (lib/reschedule.ts)
    for (const time of ["11:07", "19:00", "19:07"]) await runAt(vilnius(time));
    expect(posted()).toEqual(["Season 1 starts on Sunday 6 December at 20:00."]);
  });

  it("is not sent once its Sunday's tournament has been cleared, and the run says why", async () => {
    await refusedAtTen();
    matchdays.delete(DATE); // as Creating Matchdays' sweep clears one (lib/reschedule.ts, sweepTournaments)
    expect(await runAt(vilnius("11:07"))).toMatchObject({
      outcome: "skipped",
      detail: "The Matchday of Sunday 29 November isn't on Lichess, so its 10:00 reminder wasn't posted.",
    });
    expect(posted()).toEqual([]);
    expect(telegramPosts.size).toBe(0);
  });
});

describe("a change to the schedule from the Organiser page", () => {
  it("posts the notice it queued, or an older one, and nothing else: one request to Telegram at most", async () => {
    telegram.override = refused;
    await collectAt(OVER); // the Recap, refused, waits
    await skipMatchday("2026-12-13", OVER); // its notice, refused, waits
    telegram.override = undefined;
    const before = telegram.calls.length;
    expect(await skipMatchday("2026-12-20", OVER)).toMatchObject({ problem: false });
    expect(telegram.calls.length - before).toBe(1);
    expect(posted()).toEqual(["No Matchday on Sunday 13 December. The next one is on Sunday 20 December at 20:00."]);
  });

  it("posts its notice after the change is saved, and after Lichess is asked to cancel the tournament it strands", async () => {
    vi.stubEnv("ORGANISER_USER_ID", "ana");
    vi.stubEnv("LICHESS_TOKEN_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("BETTER_AUTH_SECRET", "test secret");
    lichess.accounts.set("boss", { id: "boss", username: "Boss" });
    lichess.team.leaders.add("boss");
    lichess.signedInAs = "boss";
    const { url, cookie } = startOrganiserConnection("ana");
    const back = new URL((await lichess.handle(new Request(url))).headers.get("location")!);
    expect(await finishOrganiserConnection({ id: "ana" }, back.searchParams, cookie)).toBe("/organiser?lichess=connected");
    Object.assign(lichess.tournaments.get(TOURNAMENT)!, { status: "created", createdBy: "boss" });
    const events: string[] = [];
    const connect = db.connect.getMockImplementation()!;
    db.connect.mockImplementation(async () => {
      const connection = await connect();
      return { ...connection, query: ((sql: string, params?: unknown[]) => (sql === "commit" && events.push("saved"), connection.query(sql, params))) as typeof connection.query };
    });
    lichess.override = (call) => void (call.path.endsWith("/terminate") && events.push("cancelled on Lichess"));
    telegram.override = () => void events.push("posted to Telegram");
    expect(await skipMatchday(DATE, WEDNESDAY)).toMatchObject({ problem: false });
    expect(events).toEqual(["saved", "cancelled on Lichess", "posted to Telegram"]);
    expect(posted()).toEqual(["No Matchday on Sunday 29 November. The next one is on Sunday 6 December at 20:00."]);
  });

  it("queues no notice for a change the site stops before saving, posts none, and takes back no reminder", async () => {
    await queuePost({ key: "reminder:2026-12-06:10", text: MORNING, until: vilnius("19:00", "2026-12-06") });
    const connect = db.connect.getMockImplementation()!;
    db.connect.mockImplementation(async () => {
      const connection = await connect();
      return { ...connection, query: ((sql: string, params?: unknown[]) => (sql === "commit" ? Promise.reject(new Error("Connection terminated unexpectedly")) : connection.query(sql, params))) as typeof connection.query };
    });
    await expect(skipMatchday("2026-12-06", WEDNESDAY)).rejects.toThrow("Connection terminated unexpectedly");
    db.connect.mockImplementation(connect);
    expect(skippedSundays.size).toBe(0);
    expect([...telegramPosts.keys()]).toEqual(["reminder:2026-12-06:10"]);
    expect(telegram.calls).toEqual([]);
  });

  it("is made, and says so, when the database fails as it posts the notice; the next run posts it", async () => {
    const answer = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('set "claimedAt" = now()')) throw new Error("the database went away");
      return answer(sql, params);
    });
    expect(await skipMatchday("2026-12-06", WEDNESDAY)).toMatchObject({ problem: false });
    db.query.mockImplementation(answer);
    expect(skippedSundays.has("2026-12-06")).toBe(true);
    expect(logged).toContain("Posting a notice to Telegram failed: the database went away");
    await runAt(at("2026-11-25T13:07:00Z"));
    expect(posted()).toEqual(["No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00."]);
  });

  it("queues one notice for two skips of a Sunday at the same moment, the second told it is already skipped", async () => {
    const said = await Promise.all([skipSunday("2026-12-06", WEDNESDAY), skipSunday("2026-12-06", WEDNESDAY)]);
    expect(said).toEqual([null, "2026-12-06 is already skipped."]);
    const twice = await Promise.all([skipMatchday("2026-12-13", WEDNESDAY), skipMatchday("2026-12-13", WEDNESDAY)]);
    expect(twice.map((s) => s.problem)).toEqual([false, true]);
    expect(twice[1].text).toBe("Sunday 13 December is already skipped.");
    // The second skip's change posted the oldest notice waiting, the first's; the run, the other.
    await runAt(at("2026-11-25T13:07:00Z"));
    expect(posted()).toEqual([
      "No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00.",
      "No Matchday on Sunday 13 December. The next one is on Sunday 20 December at 20:00.",
    ]);
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
    expect(await skipMatchday("2026-12-06", WEDNESDAY)).toMatchObject({ problem: false });
    expect(posted()).toEqual(["No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00."]);
    expect(await skipMatchday("2026-12-06", WEDNESDAY)).toEqual({ text: "Sunday 6 December is already skipped.", problem: true });
    await runAt(at("2026-11-25T13:07:00Z"));
    expect(posted()).toEqual(["No Matchday on Sunday 6 December. The next one is on Sunday 13 December at 20:00."]);
  });

  it("tell the group when a skipped Sunday has its Matchday back, in the order they happened", async () => {
    await skipMatchday("2026-12-06", WEDNESDAY);
    expect(await unskipMatchday("2026-12-06", WEDNESDAY)).toMatchObject({ problem: false });
    expect(await unskipMatchday("2026-12-06", WEDNESDAY)).toMatchObject({ problem: true });
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
    expect(await changeSeasonStart(2, "2027-01-24", WEDNESDAY)).toMatchObject({ problem: false });
    expect(await changeSeasonStart(2, "2027-01-24", WEDNESDAY)).toMatchObject({ problem: true });
    // Set by two callers at once, without the Organiser page's check, the start is changed, and announced, once.
    await Promise.all([setSeasonStart(2, "2027-02-07", WEDNESDAY), setSeasonStart(2, "2027-02-07", WEDNESDAY)]);
    // Season 3 then starts on 28 March by itself, two weeks after Season 2's last Matchday: setting that is not news.
    expect(await setSeasonStart(3, "2027-03-28", WEDNESDAY)).toBeNull();
    expect(seasons.get(3)).toEqual({ number: 3, start: "2027-03-28" });
    // This change posts the oldest notice waiting, 7 February's; the run, its own.
    expect(await changeSeasonStart(2, "2027-01-31", WEDNESDAY)).toMatchObject({ problem: false });
    await runAt(at("2026-11-25T13:07:00Z"));
    expect(posted()).toEqual([
      "Season 2 starts on Sunday 24 January at 20:00.",
      "Season 2 starts on Sunday 7 February at 20:00.",
      "Season 2 starts on Sunday 31 January at 20:00.",
    ]);
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
    expect(await skipMatchday("2026-12-06", WEDNESDAY)).toMatchObject({ problem: false });
    // The skip moves Season 2 to 24 January by itself; the Organiser sets it a week later.
    expect(await changeSeasonStart(2, "2027-01-31", WEDNESDAY)).toMatchObject({ problem: false });
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
