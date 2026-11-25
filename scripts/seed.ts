// The standard local Club: invented people and history, dated from today, so that every state of every page can be seen
// in a browser. Only on a database `pnpm db:start` made: it refuses any other DATABASE_URL, a database without its mark,
// and one holding people it did not make. It reads the block db:start wrote to .env.local.
//
//   pnpm seed [club|season-over|empty]  empties the database, seeds one scenario (default club), lists who is in it, then
//                                       checks through the site's own code that every state it promises is there
//   pnpm seed:cookies                   writes each seeded person's session cookie, keyed by id, to cookies.json beside
//                                       the database, for Playwright: context.addCookies([cookies.ana])
//
// club: Season 1 over with one champion, Season 2 over with a shared title and a Sunday whose results never came in (on
// the Organiser page's list), Season 3 under way with a skipped Sunday, a warm-up before Season 1 (all draws) and a
// Matchday in the week off that nobody now on the Leaderboards played; the Organiser (org) connected, both scheduled
// jobs run, and gone left and removed from the Lichess team. season-over: Season 1 just over, its champion on the home
// page, Season 2's first Matchday played on Lichess and its results not collected yet, its second skipped with a
// tournament the site could not cancel, the Organiser's permission expired and the job's failure recorded, then gone
// left and could not be removed from the Lichess team. empty: two
// sign-ups short of sixteen, nothing played or connected. Each has step1 and step2 part-way through signing up.
//
// club's Organiser page also has Posting to Telegram run once, which posted the latest Recap to an in-process fake
// Telegram; with `pnpm fake-telegram` running, the seed prints the `pnpm post-to-telegram` commands that post the next
// Matchday's two reminders there, and in season-over `pnpm collect-results` posts the Recap of the Matchday it collects.
// Both have Backing up run, which says backups aren't set up, as no local block has the store's token, and Alerting you
// run twice, which in season-over sends the Organiser the failure privately, once, and in club has nothing to send.
//
// Season 2's first Matchday in season-over is on Lichess only: with LICHESS_URL set, the seed writes its tournament,
// finished, to fake-lichess.json beside the database, where `pnpm fake-lichess` finds it, and `pnpm collect-results`
// then collects it as the scheduled job would.
//
// Names are chess puns and faces drawings. Seeded links still reach real sites if clicked, under names they do not allow:
// LinkedIn (underscores and "linkedin" in the handle), Lichess names (a double hyphen), Games and tournaments (ids of the
// wrong length, but for the next Matchday's, which is random, and the one waiting to be collected, PreTend1); and
// "Replay the Game" loads lichess.org's board.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { madeByDbStart, notLocal } from "./local-db.mjs";
import { alertOrganiser, alertsProblem, JOB as ALERTS } from "@/lib/alerts";
import { auth, getProfile } from "@/lib/auth";
import { backUp, backupProblem, JOB as BACKUP } from "@/lib/backup";
import { mustWelcome } from "@/lib/consent";
import { collectResults, JOB as COLLECT, uncollected } from "@/lib/collect-results";
import { createUpcomingMatchday, dueFrom, JOB as CREATE, tournamentName } from "@/lib/create-matchdays";
import { db } from "@/lib/db";
import { createFakeLichess, type FakeSwiss } from "@/lib/fixtures/fake-lichess";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { GAMES_SHOWN, getHistory } from "@/lib/history";
import { lastFailure, lastRun } from "@/lib/jobs";
import { getAllTime, getSeason, newChampions, readLeaderboards, seasonOfMatchday } from "@/lib/leaderboards";
import { removeMember, teamRemovals } from "@/lib/leaving";
import { matchdayOn } from "@/lib/matchdays";
import { mustConnectLichess } from "@/lib/members";
import { isOrganiser } from "@/lib/organiser";
import { finishOrganiserConnection, organiserPermission, startOrganiserConnection } from "@/lib/organiser-lichess";
import { JOB as POST, postToTelegram, REMINDER_HOURS } from "@/lib/post-to-telegram";
import { getRecap, recapDates } from "@/lib/recaps";
import { skipMatchday, tournamentCancellations } from "@/lib/reschedule";
import { addDays, firstSeasonStart, latestSunday, matchdayStart, MEMBERS_TO_START, signUpsNeeded, START_HOUR } from "@/lib/schedule";
import { readSchedule, seasonDates, upcomingMatchday, type Schedule } from "@/lib/seasons";
import { countSignUps, signUpTimes } from "@/lib/signups";
import { postingSetUp } from "@/lib/telegram";
import { tokenKey } from "@/lib/token-box";

type Person = {
  id: string;
  name: string;
  about?: string;
  rating?: number | null; // blitz when connected; null for an account that had none
  step?: 1 | 2; // part-way through signing up: 1 has not agreed yet, 2 has agreed but not connected Lichess
  plays?: RegExp; // the Matchdays they play, by tag; `sometimes`, only three in four; `noGames`, against non-Members only
  joins?: string; // the tag of the Matchday they joined just before, or "lately"; anyone else joined before Season 1
  formerly?: string; // their Company until Season 1 ended
  photo?: string; // the background of a drawn face, or "broken"
  company?: string; position?: string; openTo?: string; linkedIn?: true;
  sometimes?: true; noGames?: true; marked?: true; closed?: true; leaves?: true;
};

const ORGANISER = "org";
const GONE = "gone";

const PEOPLE: Person[] = [
  { id: ORGANISER, name: "Rasa Arbiter", rating: 1560, plays: /^(warmup|s1m[1-4]|s2m[2-6]|s3)/, position: "Engineering lead",
    photo: "#d4a373", about: "the Organiser (ORGANISER_USER_ID): /organiser" },
  { id: "ana", name: "Ana Fianchetto", rating: 1480, plays: /^(?!off)/, company: "example.com", position: "Engineering manager",
    openTo: "A coffee after Sunday's Games, or a chat about hiring", linkedIn: true, photo: "#7c9cbf",
    about: "every Profile field, a Company and a photo; more Games than a Profile lists at first, and a Streak" },
  { id: "champ", name: "Kęstutis Checkmate", rating: 1890, plays: /^(warmup|s1|s2m[12]$|s3m[23]$)/, company: "example.org",
    position: "Staff engineer", photo: "#c98f5a", about: "the Season 1 champion" },
  { id: "twin1", name: "Rūta Castling", rating: 1720, plays: /^(s1m[3-6]|s2|s3)/, company: "example.com",
    position: "Product designer", openTo: "Mentoring junior designers", photo: "#9bbf7c", about: "shares the Season 2 title" },
  { id: "twin2", name: "Žygimantas Zugzwang", rating: 1705, plays: /^(s1m[4-6]|s2|s3m1)/, position: "Founder",
    about: "shares the Season 2 title" },
  { id: "plain", name: "Jonas Pawn", rating: 1210, plays: /^(warmup|s1m[12]|s2m5)$/,
    about: "nothing added: no Company, position, open-to line, LinkedIn or photo" },
  { id: "domain", name: "Eglė Endgame", rating: 1350, plays: /^(s1|s2m[1-3]|s3)/, company: "example.net",
    position: "Data analyst", about: "a Company whose website gave no name, so its domain is its name" },
  { id: "mover", name: "Vytautas Gambit", rating: 1600, plays: /^s/, company: "example.com", formerly: "example.org",
    position: "Backend engineer", about: "changed Company after Season 1, so older Recaps show the old one" },
  { id: "long", name: "Aleksandra Bishopsonaitė-Kingsidecastle", rating: 1250, plays: /^(s2m6|s3)/, joins: "s2m6",
    company: "example.org", position: "Principal infrastructure engineer, platform reliability and developer tooling",
    openTo: "Pairing on gnarly infrastructure problems, conference talks, and hearing about staff-level platform roles",
    about: "the longest name, Company, position and open-to line" },
  { id: "marked", name: "Mantas Engine", rating: 2050, plays: /^(s1|off|s2)/, marked: true,
    about: "Lichess marked the account, so it is left off every Leaderboard and Award" },
  { id: "closed", name: "Greta Closedfile", rating: 1400, plays: /^(s1m[1-3]|off)$/, closed: true,
    about: "the Lichess account is closed, so likewise" },
  { id: GONE, name: "Paulius Resigns", rating: 1550, plays: /^(warmup|s1m[1-4]|off)$/, leaves: true,
    about: "left the Club: their results and Awards went with them, their Games show 'a former member', and Awards won against them show no Game" },
  { id: "newbie", name: "Lukas Firstmove", rating: null, joins: "lately",
    about: "a Member who has not played a Matchday yet, whose account had no blitz rating" },
  { id: "guest", name: "Ieva Bye", rating: 1300, plays: /^s3m3$/, joins: "s3m3", noGames: true,
    about: "played one Matchday, without a Game against another Member" },
  { id: "broken", name: "Dovilė Diagonal", rating: 1420, plays: /^s[23]/, company: "example.com", photo: "broken",
    about: "a photo address that no longer loads, so initials instead" },
  { id: "benas", name: "Benas Rookside", rating: 1180, plays: /^s/, sometimes: true },
  { id: "gintare", name: "Gintarė Knightley", rating: 1640, plays: /^s/, sometimes: true, company: "example.org" },
  { id: "sarunas", name: "Šarūnas Sicilian", rating: 1960, plays: /^s/, sometimes: true },
  { id: "ugne", name: "Ugnė En Passant", rating: 1090, plays: /^s/, sometimes: true, photo: "#b58cc2" },
  { id: "mindaugas", name: "Mindaugas Stalemate", rating: 1510, plays: /^s/, sometimes: true },
  { id: "juste", name: "Justė Forkwell", rating: 1330, plays: /^(warmup|s)/, sometimes: true },
  { id: "step1", name: "Milda Opening", step: 1, about: "signed in, has not agreed yet: /welcome" },
  { id: "step2", name: "Tadas Development", step: 2, about: "has agreed, no Lichess yet: /welcome/lichess" },
];

// Each scenario's Matchdays by tag, "s2m4" being Season 2's fourth, and how many weeks before the latest Sunday
// Season 1 starts. Sundays not listed have no Matchday. `played` is a Matchday played on Lichess whose results have not
// been collected yet; `lost`, one whose tournament is recorded but whose results never came in, which runs have long
// stopped looking for: Season 2's fourth in club, seven Sundays ago, so the last the Organiser page still lists.
const SCENARIOS: Record<string, { weeks?: number; skip?: number; tags: string[]; played?: string; lost?: string }> = {
  // skip: weeks after Season 1's start, between Season 3's first two Matchdays
  club: {
    weeks: 17, skip: 15,
    tags: ["warmup", "s1m1", "s1m2", "s1m3", "s1m4", "s1m5", "s1m6", "off", "s2m1", "s2m2", "s2m3", "s2m5", "s2m6", "s3m1", "s3m2", "s3m3"],
    lost: "s2m4",
  },
  "season-over": { weeks: 7, tags: ["warmup", "s1m1", "s1m2", "s1m3", "s1m4", "s1m5", "s1m6"], played: "s2m1" },
  empty: { tags: [] },
};

const EMAIL = "@seed.invalid";
// The tournament of the Matchday played on Lichess and not collected yet, and the file beside the database in which
// `pnpm fake-lichess` finds it.
const WAITING = "PreTend1";
const FAKE_LICHESS_FILE = "fake-lichess.json";
// The tournament of the Matchday whose results never came in. No Lichess has it.
const LOST = "PreTend2";
const now = new Date();
// What the in-process fake Telegram was sent while seeding: to the group, and to the Organiser alone.
let telegramPosts: string[] = [];
let alertsSent: string[] = [];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Two hyphens in a row, which no new Lichess account may have (lila's nameRules.newUsernameLetters).
const lichessId = (p: Person) => `pretend--${p.id}`;
const lichessName = (p: Person) => `Pretend--${p.id[0].toUpperCase()}${p.id.slice(1)}`;
const token = (p: Person) => `seed-session-${p.id}`;

// Better Auth's session cookie: `<token>.<HMAC-SHA256 of it>`, signed with the site's secret and URI-encoded
// (better-call's signCookieValue). Plain http, so without the __Secure- prefix.
const cookie = (p: Person) => {
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token(p)).digest("base64");
  return { name: "better-auth.session_token", value: encodeURIComponent(`${token(p)}.${signature}`) };
};

// The same history on every run, only dated afresh: a fixed pseudo-random sequence (mulberry32).
let state = 20261125;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

// The items in an order drawn from that sequence (Fisher-Yates), the same on every JavaScript engine. A sort with a
// random comparator is not: how often, and on which pairs, an engine calls the comparator is the engine's own choice, so
// another Node.js draws other pairings and seeds another history.
function shuffled<T>(items: T[]): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// A drawn face on a coloured square, as LinkedIn's photo would sit there: plainly not anyone's photo.
const face = (background: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${background}"/><circle cx="24" cy="20" r="10" fill="#f1d2b0"/><path d="M6 48q18-22 36 0" fill="#f1d2b0"/><circle cx="20" cy="19" r="1.5"/><circle cx="28" cy="19" r="1.5"/><path d="M20 24q4 3 8 0" fill="none" stroke="#000" stroke-width="1.4"/></svg>`,
  )}`;

type Game = [id: string, date: string, white: string, black: string, winner: "white" | "black" | null, status: string,
  plies: number, whiteRating: number, blackRating: number, winnerClock: number | null, finishedAt: Date];

// A Swiss-like evening: five rounds of pairings by the circle method, a bye (a point, no Game) for an odd one out.
// Games follow ratings, except that the Season 1 champion beats everyone in Season 1 and the two who share Season 2
// beat everyone else in Season 2 and draw with each other. The warm-up is all draws, so it has no Awards; Season 2's
// last has no win with under a minute left, so its closest call reads in minutes. In Season 1's first, the first
// opponent in good standing of the one who leaves mates them in a few moves, far faster than any other mate, so that
// a Recap has an Award won against someone who has since left, whatever the draw.
function evening(tag: string, date: string, players: Person[], games: Game[]) {
  const ratings = new Map(players.map((p) => [p.id, (p.rating ?? 1500) + between(-15, 15)]));
  const points = new Map(players.map((p) => [p.id, 0]));
  const seats: (Person | null)[] = shuffled(players.filter((p) => !p.noGames));
  let quickMate = tag === "s1m1";
  if (seats.length % 2) seats.push(null);
  for (let round = 0; round < Math.min(5, seats.length - 1); round++) {
    for (let i = 0; i < seats.length / 2; i++) {
      const [a, b] = [seats[i], seats[seats.length - 1 - i]];
      if (!a || !b) {
        points.set((a ?? b)!.id, points.get((a ?? b)!.id)! + 1);
        continue;
      }
      const [white, black] = (round + i) % 2 ? [a, b] : [b, a];
      const [rw, rb] = [ratings.get(white.id)!, ratings.get(black.id)!];
      const forced = (id: string) =>
        (/^s1/.test(tag) && id === "champ") || (/^s2/.test(tag) && (id === "twin1" || id === "twin2"));
      let winner: "white" | "black" | null =
        tag === "warmup" || (forced(white.id) && forced(black.id)) ? null
        : forced(white.id) ? "white"
        : forced(black.id) ? "black"
        : random() < 0.12 ? null
        : random() < 1 / (1 + 10 ** ((rb - rw) / 400)) ? "white"
        : "black";
      let status = winner ? ["mate", "resign", "resign", "outoftime"][between(0, 3)] : "draw";
      let plies = between(24, 110);
      if (status === "mate" && plies % 2 !== (winner === "white" ? 1 : 0)) plies++; // the mating move is the winner's
      let clock = !winner ? null : tag === "s2m6" ? between(6000, 24000) : status === "outoftime" ? between(150, 4000) : between(300, 24000);
      const finished = new Date(matchdayStart(date).getTime() + (round * 14 + between(4, 12)) * 60_000);
      // After every draw for this Game, so that the rest of the sequence, and of the history, stays as it was.
      if (quickMate && (white.leaves || black.leaves) && ![white, black].some((p) => p.marked || p.closed)) {
        [winner, status, plies, clock, quickMate] = [white.leaves ? "black" : "white", "mate", white.leaves ? 4 : 5, clock ?? 18_000, false];
      }
      games.push([`pretend${String(games.length + 1).padStart(4, "0")}`, date, white.id, black.id, winner, status, plies, rw, rb, clock, finished]);
      for (const [id, colour] of [[white.id, "white"], [black.id, "black"]] as const)
        points.set(id, points.get(id)! + (winner === colour ? 1 : winner === null ? 0.5 : 0));
    }
    seats.splice(1, 0, seats.pop()!);
  }
  for (const p of players) if (p.noGames) points.set(p.id, 3);
  return [...players]
    .sort((a, b) => points.get(b.id)! - points.get(a.id)! || ratings.get(b.id)! - ratings.get(a.id)!)
    .map((p, i) => ({ id: p.id, rank: i + 1, points: points.get(p.id)!, rating: ratings.get(p.id)! }));
}

// Who is in a scenario: in empty, the first Members who could have joined without playing (nobody is marked or closed
// before a Matchday), so that two more sign-ups start Season 1.
const peopleOf = (name: string) =>
  name !== "empty"
    ? PEOPLE
    : [...PEOPLE.filter((p) => !p.step && !p.leaves && !p.marked && !p.closed).slice(0, MEMBERS_TO_START - 2), ...PEOPLE.filter((p) => p.step)];

async function seed(name: string) {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from "user" where email not like $1`, [`%${EMAIL}`]);
  if (rows[0].n > 0)
    throw new Error(`Refusing to seed: the database holds people the seed did not make (${rows[0].n}). Use a fresh one: pnpm db:start --dir <new dir>.`);

  const scenario = SCENARIOS[name];
  const latest = latestSunday(now);
  const start = scenario.weeks === undefined ? null : addDays(latest, -7 * scenario.weeks);
  const schedule: Schedule = { seasons: start ? [{ number: 1, start }] : [], skipped: start && scenario.skip ? [addDays(start, 7 * scenario.skip)] : [] };
  const dateOf = (tag: string): string => {
    if (tag === "warmup") return addDays(start!, -7);
    if (tag === "off") return addDays(dateOf("s1m6"), 7);
    const [season, n] = tag.slice(1).split("m").map(Number);
    return seasonDates(schedule, season)![n - 1];
  };
  const people = peopleOf(name);
  const evenings = scenario.tags.map((tag) => ({
    tag,
    date: dateOf(tag),
    players: people.filter((p) => !p.step && p.plays?.test(tag) && (!p.sometimes || random() < 0.75)),
  }));
  const games: Game[] = [];
  const results = evenings.map(({ tag, date, players }) => ({ tag, date, rows: evening(tag, date, players, games) }));
  // Generated after the others, so that their history stays the same, and its Games numbered on from theirs, as no two
  // Lichess Games share an id.
  let waiting: { date: string; swiss: FakeSwiss } | null = null;
  if (scenario.played) {
    const tag = scenario.played;
    const date = dateOf(tag);
    const first = games.length;
    const rows = evening(tag, date, people.filter((p) => !p.step && p.plays?.test(tag) && (!p.sometimes || random() < 0.75)), games);
    waiting = { date, swiss: onLichess(date, rows, games.splice(first)) };
  }
  // Ingestion keeps each Member's blitz rating as Lichess showed it at their latest Matchday.
  const rating = new Map(people.map((p) => [p.id, p.rating ?? null]));
  for (const { rows } of results) for (const r of rows) rating.set(r.id, r.rating);

  // When each joined. Before Season 1, sixteen sign-ups by the Saturday eight days before its first Sunday, which is
  // what scheduled it then (firstSeasonStart), and two more within hours, so that it still follows from the sign-ups
  // once one of them has left. Late joiners a few days before their first Matchday; the rest of empty's, and the
  // part-way, in the last few weeks.
  const early = people.filter((p) => !p.step && !p.joins);
  const cutoff = start ? matchdayStart(start).getTime() - 8 * DAY : 0;
  const joined = (p: Person, i: number) => {
    const order = early.indexOf(p);
    if (start && order >= 0) return new Date(cutoff + (order - (MEMBERS_TO_START - 1)) * (order < MEMBERS_TO_START ? DAY : HOUR));
    if (p.joins && scenario.tags.includes(p.joins)) return new Date(matchdayStart(dateOf(p.joins)).getTime() - 3 * DAY);
    return new Date(now.getTime() - (people.length - i) * DAY);
  };

  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `truncate "game", "matchdayResult", "matchday", "skippedSunday", "season", "session", "account", "verification", "user",
         "company", "organiserLichess", "scheduledJob", "jobFailure", "teamRemoval", "tournamentCancellation", "telegramPost" cascade`,
    );
    await client.query(
      `insert into "company" ("domain", "name", "fetchedAt", "fetchAttempts") values
         ('example.com', 'Pretend Robotics', now(), 1),
         ('example.org', 'Ministry of Imaginary Affairs and Unreasonably Long Company Names', now(), 1),
         ('example.net', 'example.net', null, 3)`, // every attempt used, so nothing ever fetches the website
    );
    for (const [i, p] of people.entries()) {
      const at = joined(p, i);
      const agreed = p.step === 1 ? null : new Date(at.getTime() - 5 * 60_000);
      const member = !p.step;
      await client.query(
        `insert into "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", "publicDisplayConsentAt",
           "houseRulesAcceptedAt", "position", "linkedInUrl", "openTo", "lichessId", "lichessUsername", "lichessBlitzRating",
           "lichessConnectedAt", "companyDomain", "lichessMarked", "lichessClosed")
         values ($1, $2, $3, true, $4, $5, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [p.id, p.name, `${p.id}${EMAIL}`, p.photo === "broken" ? "https://photo.invalid/expired.jpg" : p.photo ? face(p.photo) : null,
          new Date(at.getTime() - 10 * 60_000), agreed, p.position ?? null,
          p.linkedIn ? `https://www.linkedin.com/in/pretend_${p.name.toLowerCase().replace(/ /g, "_")}_not_on_linkedin` : null,
          p.openTo ?? null, member ? lichessId(p) : null, member ? lichessName(p) : null,
          member ? rating.get(p.id) : null, member ? at : null, member ? (p.company ?? null) : null, !!p.marked, !!p.closed],
      );
      // Signing in with LinkedIn leaves an account row, with no LinkedIn token kept (lib/auth.ts), and a session.
      await client.query(
        `insert into "account" (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") values ($1, $2, 'linkedin', $3, $4, $4)`,
        [`seed-account-${p.id}`, `pretend-linkedin-${p.id}`, p.id, at],
      );
      await client.query(`insert into "session" (id, "expiresAt", token, "updatedAt", "userId") values ($1, $2, $3, now(), $4)`, [
        `seed-${p.id}`, new Date(now.getTime() + 30 * DAY), token(p), p.id]);
    }
    if (start) await client.query(`insert into "season" ("number", "start") values (1, $1)`, [start]);
    for (const date of schedule.skipped) await client.query(`insert into "skippedSunday" ("date") values ($1)`, [date]);
    for (const { tag, date, rows } of results) {
      await client.query(`insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values ($1, $2, $3)`, [
        date, `pretend${date.replaceAll("-", "")}`, new Date(matchdayStart(date).getTime() + 2 * HOUR)]);
      for (const r of rows) {
        const p = PEOPLE.find((person) => person.id === r.id)!;
        const company = p.formerly && /^(warmup|s1)/.test(tag) ? p.formerly : (p.company ?? null);
        await client.query(
          `insert into "matchdayResult" ("matchdayDate", "userId", "rank", "points", "rating", "companyDomain") values ($1, $2, $3, $4, $5, $6)`,
          [date, r.id, r.rank, r.points, r.rating, company],
        );
      }
    }
    if (waiting) await client.query(`insert into "matchday" ("date", "lichessTournamentId") values ($1, $2)`, [waiting.date, WAITING]);
    if (scenario.lost) await client.query(`insert into "matchday" ("date", "lichessTournamentId") values ($1, $2)`, [dateOf(scenario.lost), LOST]);
    for (const game of games)
      await client.query(
        `insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating",
           "blackRating", "winnerClockCentis", "finishedAt") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        game,
      );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  if (name !== "empty") [telegramPosts, alertsSent] = await organiser(name);
  // Without LICHESS_URL there is no fake Lichess to read it.
  if (process.env.LICHESS_URL)
    writeFileSync(await besideDatabase(FAKE_LICHESS_FILE), JSON.stringify(waiting ? [waiting.swiss] : []), { mode: 0o600 });

  console.log(`Seeded "${name}": ${people.length} people, ${results.length} Matchdays, ${games.length} Games, as of ${now.toISOString()}.`);
  if (waiting)
    console.log(`The Matchday of ${waiting.date} was played on Lichess, and its results are not collected yet: with pnpm fake-lichess running, pnpm collect-results collects them.`);
  const next = await upcomingMatchday(now);
  if (next && (await matchdayOn(next.date))?.lichessTournamentId && postingSetUp()) {
    const reminder = (hour: number) => new Date(next.start.getTime() - (START_HOUR - hour) * HOUR).toISOString();
    console.log(`With pnpm fake-telegram running, these post the next Matchday's reminders there: ${REMINDER_HOURS.map((h) => `pnpm post-to-telegram ${reminder(h)}`).join(", then ")}.`);
  }
  console.log("Sign in as any of them but the one who left with the cookies pnpm seed:cookies writes:");
  for (const p of people) console.log(`  ${p.id.padEnd(10)} ${p.name.padEnd(40)} ${p.about ?? "a Member who plays some Sundays"}`);
}

// A Matchday's tournament as Lichess exports it (lib/fixtures/fake-lichess.ts): its standings and its Games, as ndjson,
// with only the fields ingestion reads besides those that say what each line is. The moves are knights going out and
// back, as many as the Game had; every clock entry is the winner's time left.
function onLichess(date: string, rows: ReturnType<typeof evening>, played: Game[]): FakeSwiss {
  const person = (id: string) => PEOPLE.find((p) => p.id === id)!;
  const player = (id: string, rating: number) => ({ user: { name: lichessName(person(id)), id: lichessId(person(id)) }, rating });
  const ndjson = (lines: object[]) => lines.map((line) => `${JSON.stringify(line)}\n`).join("");
  const knights = ["Nf3", "Nf6", "Ng1", "Ng8"];
  return {
    id: WAITING,
    teamId: process.env.LICHESS_TEAM_ID!,
    status: "finished",
    startsAt: matchdayStart(date).toISOString(),
    name: tournamentName(date),
    createdBy: lichessId(person(ORGANISER)),
    results: ndjson(rows.map((r) => ({ rank: r.rank, points: r.points, rating: r.rating, username: lichessName(person(r.id)) }))),
    games: ndjson(
      played.map(([id, , white, black, winner, status, plies, whiteRating, blackRating, clock, finishedAt]) => ({
        id,
        rated: true,
        variant: "standard",
        speed: "blitz",
        status,
        lastMoveAt: finishedAt.getTime(),
        players: { white: player(white, whiteRating), black: player(black, blackRating) },
        ...(winner && { winner }),
        moves: Array.from({ length: plies }, (_, i) => knights[i % 4]).join(" "),
        clocks: Array(plies).fill(clock ?? 18_000),
        swissTour: { id: WAITING },
      })),
    ),
  };
}

// The Organiser's Lichess permission, the scheduled jobs' runs and the one who left, written by the site's own code
// against an in-process fake Lichess, so nothing leaves this process: the Organiser connects as the leader of the Club's
// team, the jobs run once, and then the one who left leaves (lib/leaving.ts), which removes them from the team. In
// season-over Creating Matchdays makes Season 2's second Matchday's tournament, at its due time at the latest; then the
// permission expires, and the Organiser skips that Sunday (lib/reschedule.ts), so that the site cannot cancel the
// tournament and the Organiser page lists it to cancel by hand, and the skip's notice is posted to an in-process fake
// Telegram; Creating Matchdays runs again at the next Matchday's due time at the latest, so that it reaches the
// permission and records the failure; Collecting results has not run, and would find a tournament this fake does not
// have; and the one who left, leaving after that, cannot be removed from the team, so the Organiser page lists their
// account to remove by hand. In club, Posting to Telegram runs twice against that fake Telegram. Returns what the fake
// Telegram was sent.
async function organiser(name: string) {
  const org = PEOPLE.find((p) => p.id === ORGANISER)!;
  const lichess = createFakeLichess({ teamId: process.env.LICHESS_TEAM_ID!, teamPassword: "", accounts: [{ id: lichessId(org), username: lichessName(org) }] });
  lichess.team.leaders.add(lichessId(org));
  for (const p of PEOPLE) if (!p.step) lichess.team.members.add(lichessId(p));
  lichess.signedInAs = lichessId(org);
  const group = process.env.TELEGRAM_GROUP_ID ?? "";
  const telegram = createFakeTelegram({ token: process.env.TELEGRAM_BOT_TOKEN ?? "", chats: [group, process.env.TELEGRAM_ORGANISER_CHAT_ID ?? ""] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    new URL(input instanceof Request ? input.url : String(input)).pathname.startsWith("/bot") ? telegram.fetch(input, init) : lichess.fetch(input, init)) as typeof fetch;
  try {
    const started = startOrganiserConnection(ORGANISER);
    const back = new URL((await lichess.handle(new Request(started.url))).headers.get("location")!);
    const to = await finishOrganiserConnection({ id: ORGANISER }, back.searchParams, started.cookie);
    if (to !== "/organiser?lichess=connected") throw new Error(`The Organiser's Lichess did not connect: ${to}`);
    // When the next Matchday is due for its tournament, if that is later than now.
    const dueAtTheLatest = async () => {
      const next = await upcomingMatchday(now);
      const due = next ? dueFrom(next.start) : now;
      return due > now ? due : now;
    };
    if (name === "season-over") {
      const second = (await upcomingMatchday(now))!;
      await createUpcomingMatchday(await dueAtTheLatest());
      await db.query(`update "organiserLichess" set "connectedAt" = now() - interval '369 days', "expiresAt" = now() - interval '4 days'`);
      const skipped = await skipMatchday(second.date, now);
      if (!skipped.problem) throw new Error(`Skipping ${second.date} went otherwise than the seed expects: ${skipped.text}`);
      await createUpcomingMatchday(await dueAtTheLatest());
    } else await createUpcomingMatchday(now);
    if (name === "club") await collectResults(now);
    if (name === "club") for (let run = 0; run < 2; run++) await postToTelegram(now);
    for (const p of PEOPLE.filter((person) => person.leaves)) {
      if (!(await removeMember(p.id))) throw new Error(`${p.id} could not leave: they were not there.`);
      if (name === "club" && lichess.team.members.has(lichessId(p))) throw new Error(`${p.id} left, but is still in the fake Lichess team.`);
    }
    await backUp(now);
    for (let run = 0; run < 2; run++) await alertOrganiser(now);
  } finally {
    globalThis.fetch = realFetch;
  }
  const texts = (toGroup: boolean) => telegram.posts.filter((post) => (post.chatId === group) === toGroup).map((post) => post.text);
  return [texts(true), texts(false)];
}

// What each scenario promises, asked of the database through the same code the pages use.
async function check(name: string) {
  const people = peopleOf(name).filter((p) => !p.leaves);
  const signIn = async (p: Person) => {
    const { name: cookieName, value } = cookie(p);
    return [p.id, (await auth.api.getSession({ headers: new Headers({ cookie: `${cookieName}=${value}` }) }))?.user] as const;
  };
  const sessions = new Map(await Promise.all(people.map(signIn)));
  const user = (id: string) => sessions.get(id)!;
  const reading = await readLeaderboards(now);
  const season = (n: number) => getSeason(n, reading);
  const played = (s: Awaited<ReturnType<typeof season>>) => s?.matchdays?.filter((m) => m.ingested).length ?? 0;
  const recaps = (await Promise.all((await recapDates()).map(getRecap))).filter((r) => r !== null);
  const allTime = await getAllTime();
  const [permission, run, collecting, failure, removals, cancellations, posting] = await Promise.all([
    organiserPermission(),
    lastRun(CREATE),
    lastRun(COLLECT),
    lastFailure(),
    teamRemovals(),
    tournamentCancellations(),
    lastRun(POST),
  ]);
  const promises: [string, boolean][] = [
    ["every seeded person signs in with their cookie, as Better Auth reads it",
      people.every((p) => sessions.get(p.id)?.id === p.id)],
    ["one person at each of the first two welcome steps",
      mustWelcome(user("step1")) && !mustWelcome(user("step2")) && mustConnectLichess(user("step2"))],
    ["the Organiser can open /organiser", isOrganiser(user(ORGANISER))],
  ];
  if (name === "empty") {
    promises.push(
      ["two sign-ups short of sixteen, so the home page counts down", signUpsNeeded(await countSignUps()) === 2],
      ["no Season scheduled, so no next Matchday", (await upcomingMatchday(now)) === null && (await season(1))?.matchdays === null],
      ["no Recaps and an empty all-time Leaderboard", recaps.length === 0 && allTime.length === 0],
      ["nothing on the Organiser page: no permission, no run, no failure, nobody to remove from the Lichess team, no tournament to cancel",
        permission === null && run === null && collecting === null && failure === null && removals.length === 0 && cancellations.length === 0],
    );
  } else {
    const gone = PEOPLE.find((p) => p.id === GONE)!;
    const [s1, s2, s3, s4, s5] = await Promise.all([1, 2, 3, 4, 5].map(season));
    const champions = await newChampions(now);
    const histories = new Map(
      await Promise.all(people.filter((p) => !p.step).map(async (p) => [p.id, await getHistory(p.id, p.id, { all: true })] as const)),
    );
    const onLeaderboards = new Set([
      ...allTime.map((row) => row.memberId),
      ...recaps.flatMap((r) => r.leaderboard.map((row) => row.memberId)),
      ...[s1, s2, s3].flatMap((s) => s?.leaderboard.map((row) => row.memberId) ?? []),
    ]);
    const [ana, plain, newbie] = await Promise.all(["ana", "plain", "newbie"].map(getProfile));
    const company = (id: string, rows: { memberId: string; company: { domain: string } | null }[]) =>
      rows.find((row) => row.memberId === id)?.company?.domain;
    promises.push(
      ["Season 1 starts when its sixteenth sign-up scheduled it",
        firstSeasonStart(await signUpTimes()) === (await readSchedule(now)).seasons.find((s) => s.number === 1)?.start],
      ["Season 1 over, all six Matchdays played, one champion", !!s1?.over && played(s1) === 6 && s1.champions.length === 1],
      ["a next Matchday on the home page", (await upcomingMatchday(now)) !== null],
      ["a Recap with all three Awards", recaps.some((r) => r.awards.length === 3)],
      ["a Recap with a Leaderboard and no Awards", recaps.some((r) => r.leaderboard.length > 0 && r.awards.length === 0)],
      ["a Recap of a Matchday outside every Season",
        (await Promise.all(recaps.map((r) => seasonOfMatchday(r.date, now)))).some((place) => place === null)],
      ["a marked and a closed Lichess account, which played but are on no Leaderboard",
        ["marked", "closed"].every((id) => histories.get(id)!.played > 0 && !onLeaderboards.has(id))],
      ["Games against a former member", [...histories.values()].some((h) => h.games.some((g) => g.opponent === null))],
      ["the one who left is in no Recap, on no Leaderboard and has no Profile",
        !onLeaderboards.has(gone.id) && !recaps.some((r) => r.awards.some((a) => a.memberId === gone.id)) && (await getProfile(gone.id)) === null],
      ["an Award won against a former member, whose Game is shown to nobody", recaps.some((r) => r.awards.some((a) => a.opponentLeft))],
      ["a Member with every optional Profile field and a Company",
        !!(ana?.company && ana.position && ana.openTo && ana.linkedInUrl)],
      ["a Member with none of them", !!plain && !plain.company && !plain.position && !plain.openTo && !plain.linkedInUrl],
      ["a Member who has not played a Matchday, whose account had no blitz rating",
        histories.get("newbie")!.played === 0 && newbie?.lichessBlitzRating === null],
    );
    if (name === "season-over")
      promises.push(
        ["the home page names Season 1's champion", champions?.season === 1 && champions.champions.length === 1],
        ["Season 2's first Matchday started, its results not in yet",
          !!s2?.matchdays && played(s2) === 0 && !s2.over && matchdayStart(s2.matchdays[0].date) <= now],
        ["its tournament finished on Lichess, waiting for Collecting results, which has never run, and listed on the Organiser page",
          (await matchdayOn(s2!.matchdays![0].date))?.lichessTournamentId === WAITING && collecting === null &&
            JSON.stringify(await uncollected(now)) === JSON.stringify([{ date: s2!.matchdays![0].date, lichessTournamentId: WAITING }])],
        ["the Organiser's permission has expired, and the job's failure is recorded",
          !!permission && permission.expiresAt <= now && run?.outcome === "failed" && !!failure?.problem.includes("expired")],
        ["Posting to Telegram has not run; the skip's notice is all the group was sent",
          posting === null && telegramPosts.length === (postingSetUp() ? 1 : 0) && telegramPosts.every((text) => text.startsWith("No Matchday on "))],
        ["the one who left could not be removed from the Lichess team, so the Organiser page lists their account to remove by hand",
          removals.length === 1 && removals[0].lichessId === lichessId(gone) && removals[0].problem.includes("expired")],
        ["Season 2's second Sunday skipped after its tournament was made, which the expired permission could not cancel, so the Organiser page lists it to cancel by hand and offers to undo the skip",
          cancellations.length === 1 && cancellations[0].problem.includes("expired") && matchdayStart(cancellations[0].date) > now &&
            (await readSchedule(now)).skipped.includes(cancellations[0].date) && (await matchdayOn(cancellations[0].date)) === null],
      );
    else {
      const ana = histories.get("ana")!;
      promises.push(
        ["Season 2 over with five of its six Matchdays played, and a shared title",
          !!s2?.over && played(s2) === 5 && s2.champions.length === 2],
        ["Season 3 under way: three Matchdays played and the next to come",
          !!s3?.matchdays && !s3.over && played(s3) === 3 && matchdayStart(s3.matchdays[3].date) > now],
        ["a skipped Sunday inside Season 3",
          (await readSchedule(now)).skipped.some((date) => s3!.matchdays![0].date < date && date < s3!.matchdays![1].date)],
        ["Season 4's page before its first Matchday, and no page for Season 5", !!s4 && played(s4) === 0 && !s4.over && s5 === null],
        ["no champion on the home page while Season 3 runs", champions === null],
        ["a Recap nobody is on", recaps.some((r) => r.leaderboard.length === 0)],
        ["a closest call of a minute or more", recaps.some((r) => r.awards.some((a) => a.kind === "leastTimeLeft" && a.value >= 6000))],
        ["a Profile with more Games than it lists at first, and a Streak", ana.total > GAMES_SHOWN && ana.streak >= 2],
        ["a Member who played without a Game against another Member",
          histories.get("guest")!.played === 1 && histories.get("guest")!.total === 0],
        ["a Company named by its domain alone", allTime.some((row) => !!row.company && row.company.name === row.company.domain)],
        ["a Member whose older Recaps keep the Company they had then",
          recaps.some((r) => !!company("mover", r.leaderboard) && company("mover", r.leaderboard) !== company("mover", allTime))],
        ["the Organiser's permission connected and readable, and all three jobs last ran without failing",
          !!permission?.readable && permission.expiresAt > now && [run, collecting, posting].every((r) => !!r && r.outcome !== "failed") && failure === null],
        postingSetUp()
          ? ["Posting to Telegram posted the latest Recap to the group once, though it ran twice, and the next Matchday is on Lichess for its reminders",
              telegramPosts.length === 1 && telegramPosts[0].startsWith(`The Recap of `) && telegramPosts[0].includes(`/recaps/${latestSunday(now)}`) &&
                posting?.detail === "Nothing to post." && !!(await matchdayOn((await upcomingMatchday(now))!.date))?.lichessTournamentId]
          : ["Posting to Telegram ran, and says Telegram isn't set up: .env.local has no Telegram settings", posting?.detail === "Telegram isn't set up, so nothing is posted."],
        ["a Matchday whose results never came in, which runs no longer look for, listed on the Organiser page",
          JSON.stringify(await uncollected(now)) === JSON.stringify([{ date: s2!.matchdays![3].date, lichessTournamentId: LOST }]) &&
            s2!.matchdays![3].date < latestSunday(now)],
        ["the one who left was removed from the Lichess team, so nobody is left to remove by hand", removals.length === 0],
      );
    }
  }
  // The nightly backup and the alerts to the Organiser (#17).
  if (name !== "empty") {
    const [backingUp, alerting] = await Promise.all([lastRun(BACKUP), lastRun(ALERTS)]);
    promises.push(["Backing up ran, and says backups aren't set up, as no local block has the store's token",
      backingUp?.outcome === "skipped" && backingUp.detail === backupProblem()]);
    if (alertsProblem())
      promises.push(["Alerting you ran, and says alerts are off, as the environment hasn't the Telegram settings for them",
        alerting?.detail === alertsProblem() && alertsSent.length === 0]);
    else if (name === "season-over")
      promises.push(["Alerting you sent the Organiser the failure of Creating Matchdays privately, once though it ran twice, and nothing to the group",
        alertsSent.length === 1 && alertsSent[0].startsWith("Creating Matchdays: The Matchday of ") && alerting?.detail === "Nothing to tell you." &&
          !telegramPosts.some((text) => text.startsWith("Creating Matchdays"))]);
    else promises.push(["Alerting you ran twice, and had nothing to tell the Organiser", alertsSent.length === 0 && alerting?.detail === "Nothing to tell you."]);
  }
  for (const [promise, kept] of promises) console.log(`${kept ? "✓" : "✗ MISSING:"} ${promise}`);
  const kept = promises.filter(([, k]) => k).length;
  console.log(`${kept} of ${promises.length} states the "${name}" scenario promises are there.`);
  return kept === promises.length;
}

// Each seeded person's session cookie in Playwright's form, written beside the database.
async function cookies() {
  const url = process.env.BETTER_AUTH_URL;
  const { rows } = await db.query<{ id: string }>(`select u.id from "session" s join "user" u on u.id = s."userId" where u.email like $1`, [
    `%${EMAIL}`]);
  const ids = new Set(rows.map((row) => row.id));
  const lines = PEOPLE.filter((p) => ids.has(p.id)).map((p) => `  ${JSON.stringify(p.id)}: ${JSON.stringify({ ...cookie(p), url, httpOnly: true, sameSite: "Lax" })}`);
  const file = await besideDatabase("cookies.json");
  writeFileSync(file, `{\n${lines.join(",\n")}\n}\n`, { mode: 0o600 });
  console.log(`Wrote the session cookies of ${lines.length} seeded people to ${file}, keyed by id, for Playwright's context.addCookies.`);
}

// A file in the database's own directory, which db:start made on this machine.
const besideDatabase = async (name: string) =>
  `${(await db.query<{ data_directory: string }>("show data_directory")).rows[0].data_directory}/${name}`;

// Why the seed must not run as asked, before it reads anything; null if it may.
function problem(args: string[]) {
  if (args.length > 1 || args.some((arg) => !Object.hasOwn(SCENARIOS, arg) && arg !== "--cookies"))
    return "Usage: pnpm seed [club|season-over|empty], or pnpm seed:cookies.";
  const local = notLocal(process.env.DATABASE_URL);
  if (local) return `Refusing: ${local}. The seed only uses a database pnpm db:start made on this machine.`;
  const missing = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "LICHESS_TEAM_ID"].find((name) => !process.env[name]);
  if (missing) return `${missing} is not set: put the block from pnpm db:start in .env.local.`;
  if (process.env.ORGANISER_USER_ID !== ORGANISER || !tokenKey())
    return `ORGANISER_USER_ID must be ${ORGANISER} and LICHESS_TOKEN_KEY 32 bytes, as pnpm db:start's block has them.`;
  // The seed runs the nightly backup, which would store the seeded Club in whatever store that token opens.
  if (process.env.BLOB_READ_WRITE_TOKEN) return "BLOB_READ_WRITE_TOKEN is set, and the seed backs up to no real store: unset it first.";
  return null;
}

async function main(args: string[]) {
  const why = problem(args);
  if (why) throw new Error(why);
  // The first statement: a database db:start did not make, such as a real one behind a forwarded port, is refused.
  if (!(await madeByDbStart(db))) throw new Error("Refusing: this database was not made by pnpm db:start, so the seed leaves it alone.");
  if (args.includes("--cookies")) return cookies().then(() => true);
  const name = args[0] ?? "club";
  await seed(name);
  return check(name);
}

main(process.argv.slice(2))
  .catch((error: Error) => {
    console.error(error.message);
    return false;
  })
  .then(async (ok) => {
    await db.end();
    process.exit(ok ? 0 : 1);
  });
