// The standard local Club: pretend people and history, dated from today, so that every state of every page can be seen
// in a browser. Only for a database on this machine (`pnpm db:start`); it refuses any other DATABASE_URL, and any
// database holding people it did not make.
//
//   pnpm seed [club|season-over|empty]
//     Empties the database, fills it with one scenario (default club), lists who is in it, then checks through the
//     site's own code that every state the scenario promises is there, and exits with 1 if one is not.
//   pnpm seed:cookies
//     Prints each seeded person's session cookie, signed with BETTER_AUTH_SECRET, as JSON keyed by their id, for
//     Playwright: context.addCookies([cookies.ana]).
//
// The scenarios, which one database cannot hold at once:
//   club         Season 1 over with one champion; Season 2 over with a Sunday not played and a shared title; Season 3
//                under way with a skipped Sunday; a warm-up Matchday before Season 1, all draws, and one in the week
//                off after it that only people now off the Leaderboards played.
//   season-over  Season 1 just over, so the home page names its champion; Season 2's first Matchday played but its
//                results not in yet.
//   empty        Two sign-ups short of the sixteen Season 1 waits for: no Matchday, Recap or Leaderboard yet.
// Each also has someone part-way through signing up at each of the first two welcome steps, step1 and step2, who can
// finish through `pnpm fake-lichess`; in empty, the two of them make the sixteen that schedule Season 1.
import { createHmac } from "node:crypto";
import { notLocal } from "./local-db.mjs";
import { db } from "@/lib/db";
import { GAMES_SHOWN, getHistory } from "@/lib/history";
import { getAllTime, getSeason, newChampions, readLeaderboards, seasonOfMatchday } from "@/lib/leaderboards";
import { MEMBER_SQL } from "@/lib/members";
import { getRecap, recapDates } from "@/lib/recaps";
import { addDays, matchdayStart, MEMBERS_TO_START, signUpsNeeded, vilniusDate } from "@/lib/schedule";
import { seasonDates, upcomingMatchday, type Schedule } from "@/lib/seasons";
import { countSignUps } from "@/lib/signups";

const why = notLocal(process.env.DATABASE_URL);
if (why) {
  console.error(`Refusing: ${why}. The seed only uses a database on this machine (pnpm db:start).`);
  process.exit(1);
}

type Person = {
  id: string;
  name: string;
  about?: string;
  rating?: number | null; // blitz; null for an account that has none
  step?: 1 | 2; // part-way through signing up: 1 has not agreed yet, 2 has agreed but not connected Lichess
  plays?: RegExp; // the Matchdays they play, by tag
  sometimes?: true; // and then only about three in four of them
  noGames?: true; // their opponents were not Members
  company?: string;
  formerly?: string; // their Company until Season 1 ended
  position?: string;
  openTo?: string;
  linkedIn?: true;
  photo?: string; // the background of a drawn face, or "broken"
  marked?: true;
  closed?: true;
  leaves?: true;
};

// Every name is a chess pun, so nobody could take one for a real person.
const PEOPLE: Person[] = [
  { id: "ana", name: "Ana Fianchetto", rating: 1480, plays: /^(?!off)/, company: "example.com", position: "Engineering manager",
    openTo: "A coffee after Sunday's Games, or a chat about hiring", linkedIn: true, photo: "#7c9cbf",
    about: "every Profile field, a Company and a photo; more Games than a Profile lists at first, and a Streak" },
  { id: "champ", name: "Kęstutis Checkmate", rating: 1890, plays: /^(warmup|s1|s2m[12]$|s3m[23]$)/, company: "example.org",
    position: "Staff engineer", photo: "#c98f5a", about: "the Season 1 champion" },
  { id: "twin1", name: "Rūta Castling", rating: 1720, plays: /^(s1m[3-6]|s2|s3)/, company: "example.com",
    position: "Product designer", openTo: "Mentoring junior designers", photo: "#9bbf7c", about: "shares the Season 2 title" },
  { id: "twin2", name: "Žygimantas Zugzwang", rating: 1705, plays: /^(s1m[4-6]|s2|s3m1)/, position: "Founder",
    about: "shares the Season 2 title" },
  { id: "plain", name: "Jonas Pawn", rating: null, plays: /^(warmup|s1m[12]|s2m5)$/,
    about: "nothing added: no Company, position or photo, and no blitz rating" },
  { id: "domain", name: "Eglė Endgame", rating: 1350, plays: /^(s1|s2m[1-3]|s3)/, company: "example.net",
    position: "Data analyst", about: "a Company whose website gave no name, so its domain is its name" },
  { id: "mover", name: "Vytautas Gambit", rating: 1600, plays: /^s/, company: "example.com", formerly: "example.org",
    position: "Backend engineer", about: "changed Company after Season 1, so older Recaps show the old one" },
  { id: "long", name: "Aleksandra Bishopsonaitė-Kingsidecastle", rating: 1250, plays: /^(s2m6|s3)/, company: "example.org",
    position: "Principal infrastructure engineer, platform reliability and developer tooling",
    openTo: "Pairing on gnarly infrastructure problems, conference talks, and hearing about staff-level platform roles",
    about: "the longest name, Company, position and open-to line" },
  { id: "marked", name: "Mantas Engine", rating: 2050, plays: /^(s1|off|s2)/, marked: true,
    about: "Lichess marked the account, so it is left off every Leaderboard and Award" },
  { id: "closed", name: "Greta Closedfile", rating: 1400, plays: /^(s1m[1-3]|off)$/, closed: true,
    about: "the Lichess account is closed, so likewise" },
  { id: "gone", name: "Paulius Resigns", rating: 1550, plays: /^(warmup|s1m[1-4]|off)$/, leaves: true,
    about: "left the Club: their results went with them, and their Games show 'a former member'" },
  { id: "newbie", name: "Lukas Firstmove", rating: 1150, about: "a Member who has not played a Matchday yet" },
  { id: "guest", name: "Ieva Bye", rating: 1300, plays: /^s3m3$/, noGames: true,
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
// Season 1 starts. Season 2's fourth is missing from club: it was never played. Sundays not listed have no Matchday.
const SCENARIOS: Record<string, { weeks?: number; skip?: number; tags: string[] }> = {
  club: {
    weeks: 17,
    skip: 15, // weeks after Season 1's start: between Season 3's first two Matchdays
    tags: ["warmup", "s1m1", "s1m2", "s1m3", "s1m4", "s1m5", "s1m6", "off", "s2m1", "s2m2", "s2m3", "s2m5", "s2m6", "s3m1", "s3m2", "s3m3"],
  },
  "season-over": { weeks: 7, tags: ["warmup", "s1m1", "s1m2", "s1m3", "s1m4", "s1m5", "s1m6"] },
  empty: { tags: [] },
};

const EMAIL = "@seed.invalid";
const now = new Date();
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

// The same history on every run, only dated afresh: a fixed pseudo-random sequence (mulberry32).
let state = 20261125;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

// A drawn face on a coloured square, as LinkedIn's photo would sit there: plainly not anyone's photo.
const face = (background: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${background}"/><circle cx="24" cy="20" r="10" fill="#f1d2b0"/><path d="M6 48q18-22 36 0" fill="#f1d2b0"/><circle cx="20" cy="19" r="1.5"/><circle cx="28" cy="19" r="1.5"/><path d="M20 24q4 3 8 0" fill="none" stroke="#000" stroke-width="1.4"/></svg>`,
  )}`;

// The latest Sunday whose Matchday has started.
function latestSunday() {
  const today = vilniusDate(now);
  const sunday = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay());
  return matchdayStart(sunday) <= now ? sunday : addDays(sunday, -7);
}

type Game = [id: string, date: string, white: string, black: string, winner: "white" | "black" | null, status: string,
  plies: number, whiteRating: number, blackRating: number, winnerClock: number | null, finishedAt: Date];

// A Swiss-like evening: five rounds of pairings by the circle method, a bye (a point, no Game) for an odd one out.
// Games follow ratings, except that the Season 1 champion beats everyone in Season 1 and the two who share Season 2
// beat everyone else in Season 2 and draw with each other. The warm-up is all draws, so it has no Awards; Season 2's
// last has no win with under a minute left, so its closest call reads in minutes.
function evening(tag: string, date: string, players: Person[], games: Game[]) {
  const ratings = new Map(players.map((p) => [p.id, (p.rating ?? 1500) + between(-15, 15)]));
  const points = new Map(players.map((p) => [p.id, 0]));
  const seats: (Person | null)[] = players.filter((p) => !p.noGames).sort(() => random() - 0.5);
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
      const winner =
        tag === "warmup" || (forced(white.id) && forced(black.id)) ? null
        : forced(white.id) ? "white"
        : forced(black.id) ? "black"
        : random() < 0.12 ? null
        : random() < 1 / (1 + 10 ** ((rb - rw) / 400)) ? "white"
        : "black";
      const status = winner ? ["mate", "resign", "resign", "outoftime"][between(0, 3)] : "draw";
      let plies = between(24, 110);
      if (status === "mate" && plies % 2 !== (winner === "white" ? 1 : 0)) plies++; // the mating move is the winner's
      const clock = !winner ? null : tag === "s2m6" ? between(6000, 24000) : status === "outoftime" ? between(150, 4000) : between(300, 24000);
      const finished = new Date(matchdayStart(date).getTime() + (round * 14 + between(4, 12)) * 60_000);
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

async function seed(name: string) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`No scenario "${name}": choose one of ${Object.keys(SCENARIOS).join(", ")}.`);
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from "user" where email not like $1`, [`%${EMAIL}`]);
  if (rows[0].n > 0)
    throw new Error(`Refusing to seed: the database holds people the seed did not make (${rows[0].n}). Use a fresh one: pnpm db:start --dir <new dir>.`);

  const latest = latestSunday();
  const start = scenario.weeks === undefined ? null : addDays(latest, -7 * scenario.weeks);
  const schedule: Schedule = { seasons: start ? [{ number: 1, start }] : [], skipped: start && scenario.skip ? [addDays(start, 7 * scenario.skip)] : [] };
  const dateOf = (tag: string): string => {
    if (tag === "warmup") return addDays(start!, -7);
    if (tag === "off") return addDays(dateOf("s1m6"), 7);
    const [season, n] = tag.slice(1).split("m").map(Number);
    return seasonDates(schedule, season)![n - 1];
  };
  // Who is in the scenario: in empty, the first Members only, so that two more sign-ups start Season 1.
  const members = PEOPLE.filter((p) => !p.step && !(name === "empty" && p.leaves));
  const people = name === "empty" ? [...members.slice(0, MEMBERS_TO_START - 2), ...PEOPLE.filter((p) => p.step)] : PEOPLE;

  const evenings = scenario.tags.map((tag) => ({
    tag,
    date: dateOf(tag),
    players: people.filter((p) => !p.step && p.plays?.test(tag) && (!p.sometimes || random() < 0.75)),
  }));
  const games: Game[] = [];
  const results = evenings.map(({ tag, date, players }) => ({ tag, date, rows: evening(tag, date, players, games) }));
  // Members joined a few days before their first Matchday, or lately if they have not played one.
  const joined = new Map(
    people.map((p, i) => {
      const first = evenings.find((e) => e.players.includes(p));
      return [p.id, first ? new Date(matchdayStart(first.date).getTime() - (3 + i) * DAY) : daysAgo(people.length - i)];
    }),
  );

  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `truncate "game", "matchdayResult", "matchday", "skippedSunday", "season", "session", "account", "verification", "user", "company" cascade`,
    );
    await client.query(
      `insert into "company" ("domain", "name", "fetchedAt", "fetchAttempts") values
         ('example.com', 'Pretend Robotics', now(), 1),
         ('example.org', 'Ministry of Imaginary Affairs and Unreasonably Long Company Names', now(), 1),
         ('example.net', 'example.net', null, 3)`, // every attempt used, so nothing ever fetches the website
    );
    for (const p of people) {
      const at = joined.get(p.id)!;
      const agreed = p.step === 1 ? null : new Date(at.getTime() - 5 * 60_000);
      const lichess = p.step ? null : `pretend-${p.id}`;
      await client.query(
        `insert into "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", "publicDisplayConsentAt",
           "houseRulesAcceptedAt", "position", "linkedInUrl", "openTo", "lichessId", "lichessUsername", "lichessBlitzRating",
           "lichessConnectedAt", "companyDomain", "lichessMarked", "lichessClosed")
         values ($1, $2, $3, true, $4, $5, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [p.id, p.name, `${p.id}${EMAIL}`, p.photo === "broken" ? "https://photo.invalid/expired.jpg" : p.photo ? face(p.photo) : null,
          new Date(at.getTime() - 10 * 60_000), agreed, p.position ?? null,
          p.linkedIn ? `https://www.linkedin.com/in/${p.name.toLowerCase().replace(/ /g, "-")}` : null, p.openTo ?? null,
          lichess, lichess && `Pretend-${p.id[0].toUpperCase()}${p.id.slice(1)}`, p.step ? null : (p.rating ?? null),
          p.step ? null : at, p.step ? null : (p.company ?? null), !!p.marked, !!p.closed],
      );
      if (!p.leaves)
        await client.query(
          `insert into "session" (id, "expiresAt", token, "updatedAt", "userId") values ($1, $2, $3, now(), $4)`,
          [`seed-${p.id}`, new Date(now.getTime() + 30 * DAY), `seed-session-${p.id}`, p.id],
        );
    }
    if (start) await client.query(`insert into "season" ("number", "start") values (1, $1)`, [start]);
    for (const date of schedule.skipped) await client.query(`insert into "skippedSunday" ("date") values ($1)`, [date]);
    for (const { tag, date, rows } of results) {
      await client.query(`insert into "matchday" ("date", "lichessTournamentId", "ingestedAt") values ($1, $2, $3)`, [
        date, `pretend${date.replaceAll("-", "")}`, new Date(matchdayStart(date).getTime() + 2 * 3_600_000)]);
      for (const r of rows) {
        const p = PEOPLE.find((person) => person.id === r.id)!;
        const company = p.formerly && /^(warmup|s1)/.test(tag) ? p.formerly : (p.company ?? null);
        await client.query(
          `insert into "matchdayResult" ("matchdayDate", "userId", "rank", "points", "rating", "companyDomain") values ($1, $2, $3, $4, $5, $6)`,
          [date, r.id, r.rank, r.points, r.rating, company],
        );
      }
    }
    for (const game of games)
      await client.query(
        `insert into "game" ("lichessGameId", "matchdayDate", "whiteId", "blackId", "winner", "status", "plies", "whiteRating",
           "blackRating", "winnerClockCentis", "finishedAt") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        game,
      );
    // Leaving deletes the account: the results go, and each Game stays with that side empty.
    await client.query(`delete from "user" where id = any($1)`, [people.filter((p) => p.leaves).map((p) => p.id)]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  console.log(`Seeded "${name}": ${people.length} people, ${results.length} Matchdays, ${games.length} Games, as of ${now.toISOString()}.`);
  console.log("Sign in as any of them (but the one who left) with the cookies from pnpm seed:cookies:");
  for (const p of people) console.log(`  ${p.id.padEnd(10)} ${p.name.padEnd(40)} ${p.about ?? "a Member who plays some Sundays"}`);
}

// What each scenario promises, asked of the database through the same code the pages use.
async function check(name: string) {
  const reading = await readLeaderboards(now);
  const season = (n: number) => getSeason(n, reading);
  const played = (s: Awaited<ReturnType<typeof season>>) => s?.matchdays?.filter((m) => m.ingested).length ?? 0;
  const count = async (sql: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n;
  const recaps = await Promise.all((await recapDates()).map(getRecap));
  const members = await countSignUps();
  const promises: [string, boolean][] = [
    ["one person part-way through each of the first two welcome steps",
      (await count(`"user" where "publicDisplayConsentAt" is null`)) === 1 &&
      (await count(`"user" where "publicDisplayConsentAt" is not null and "lichessId" is null`)) === 1],
    ["a session for every seeded person", (await count(`"session"`)) === (await count(`"user"`))],
  ];
  if (name === "empty") {
    promises.push(
      ["two sign-ups short of sixteen, so the home page counts down", signUpsNeeded(members) === 2],
      ["no Season scheduled, so no next Matchday", (await upcomingMatchday(now)) === null && (await season(1))?.matchdays === null],
      ["no Recaps and an empty all-time Leaderboard", recaps.length === 0 && (await getAllTime()).length === 0],
    );
  } else {
    const [s1, s2, s3, s4, s5] = await Promise.all([1, 2, 3, 4, 5].map(season));
    const champions = await newChampions(now);
    promises.push(
      ["at least sixteen Members", members >= MEMBERS_TO_START],
      ["Season 1 over, all six Matchdays played, one champion", !!s1?.over && played(s1) === 6 && s1.champions.length === 1],
      ["a next Matchday on the home page", (await upcomingMatchday(now)) !== null],
      ["a Recap with all three Awards", recaps.some((r) => r?.awards.length === 3)],
      ["a Recap with a Leaderboard and no Awards", recaps.some((r) => r && r.leaderboard.length > 0 && r.awards.length === 0)],
      ["a Recap of a Matchday outside every Season",
        (await Promise.all(recaps.map((r) => seasonOfMatchday(r!.date, now)))).some((place) => place === null)],
      ["a marked Lichess account and a closed one",
        (await count(`"user" where "lichessMarked"`)) === 1 && (await count(`"user" where "lichessClosed"`)) === 1],
      ["the all-time Leaderboard without them",
        (await getAllTime()).every((row) => row.memberId !== "marked" && row.memberId !== "closed")],
      ["a former member's Games, with their side empty", (await count(`"game" where "whiteId" is null or "blackId" is null`)) > 0],
      ["a Member with every optional Profile field and a Company",
        (await count(`"user" where ${MEMBER_SQL} and "position" is not null and "openTo" is not null and "linkedInUrl" is not null and "companyDomain" is not null`)) > 0],
      ["a Member with none of them",
        (await count(`"user" where ${MEMBER_SQL} and "position" is null and "openTo" is null and "linkedInUrl" is null and "companyDomain" is null`)) > 0],
      ["a Member who has not played a Matchday", (await getHistory("newbie", "ana")).played === 0],
    );
    if (name === "season-over")
      promises.push(
        ["the home page names Season 1's champion", champions?.season === 1 && champions.champions.length === 1],
        ["Season 2's first Matchday started, its results not in yet",
          !!s2?.matchdays && played(s2) === 0 && !s2.over && matchdayStart(s2.matchdays[0].date) <= now],
      );
    else {
      const history = await getHistory("ana", "ana");
      promises.push(
        ["Season 2 over with five of its six Matchdays played, and a shared title",
          !!s2?.over && played(s2) === 5 && s2.champions.length === 2],
        ["Season 3 under way: three Matchdays played and the next to come",
          !!s3?.matchdays && !s3.over && played(s3) === 3 && matchdayStart(s3.matchdays[3].date) > now],
        ["a skipped Sunday inside Season 3",
          (await count(`"skippedSunday"`)) === 1 && s3!.matchdays![1].date === addDays(s3!.matchdays![0].date, 14)],
        ["Season 4's page before its first Matchday, and no page for Season 5", !!s4 && played(s4) === 0 && !s4.over && s5 === null],
        ["no champion on the home page while Season 3 runs", champions === null],
        ["a Recap nobody is on", recaps.some((r) => r?.leaderboard.length === 0)],
        ["a closest call of a minute or more", recaps.some((r) => r?.awards.some((a) => a.kind === "leastTimeLeft" && a.value >= 6000))],
        ["a Profile with more Games than it lists at first, and a Streak", history.total > GAMES_SHOWN && history.streak >= 2],
        ["a Member who played without a Game against another Member",
          await getHistory("guest", "ana").then((h) => h.played === 1 && h.total === 0)],
        ["a Company named by its domain alone", (await count(`"company" where "name" = "domain"`)) === 1],
        ["a Member whose older results keep the Company they had then",
          (await count(`"matchdayResult" r join "user" u on u.id = r."userId" where r."companyDomain" is distinct from u."companyDomain"`)) > 0],
      );
    }
  }
  for (const [promise, kept] of promises) console.log(`${kept ? "✓" : "✗ MISSING:"} ${promise}`);
  const kept = promises.filter(([, k]) => k).length;
  console.log(`${kept} of ${promises.length} states the "${name}" scenario promises are there.`);
  return kept === promises.length;
}

// Playwright's form of each seeded session cookie, which Better Auth reads as `<token>.<HMAC-SHA256 of it>`, signed
// with the site's secret and URI-encoded (better-call's signCookieValue). Plain http, so without the __Secure- prefix.
async function cookies() {
  const { BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: url } = process.env;
  if (!secret || !url) throw new Error("BETTER_AUTH_SECRET and BETTER_AUTH_URL must be set: put the block from pnpm db:start in .env.local.");
  const { rows } = await db.query<{ id: string; token: string }>(
    `select u.id, s.token from "session" s join "user" u on u.id = s."userId" where u.email like $1`,
    [`%${EMAIL}`],
  );
  const tokens = new Map(rows.map((row) => [row.id, row.token]));
  const sign = (token: string) => encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`);
  const lines = PEOPLE.filter((p) => tokens.has(p.id)).map((p) => {
    const cookie = { name: "better-auth.session_token", value: sign(tokens.get(p.id)!), url, httpOnly: true, sameSite: "Lax" };
    return `  ${JSON.stringify(p.id)}: ${JSON.stringify(cookie)}`;
  });
  console.log(`{\n${lines.join(",\n")}\n}`);
}

const args = process.argv.slice(2);
const name = args.find((arg) => !arg.startsWith("--")) ?? "club";
(args.includes("--cookies") ? cookies().then(() => true) : seed(name).then(() => check(name)))
  .catch((error: Error) => {
    console.error(error.message);
    return false;
  })
  .then(async (ok) => {
    await db.end();
    process.exit(ok ? 0 : 1);
  });
