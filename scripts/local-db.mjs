// A throwaway Postgres for a checkout, and an env block in which every other value is pretend, so that pages can be
// looked at in a browser with nothing real behind them. It belongs in a worktree: it refuses a checkout whose
// .env.local holds a database that is not on this machine, and a directory holding a Postgres it did not make.
//
//   pnpm db:start [--dir <dir>] [--port <port>]  Postgres in <dir> (default .local-db/, git-ignored) on 127.0.0.1, with a
//     database named for <dir> alone, marked and migrated, and the env block in <dir>/offboard.env, from which a missing
//     .env.local is created. The ports come as a set, Postgres 55432 + n, the site 3100 + n, the fake Lichess 8089 + n
//     and the fake Telegram 8189 + n, for the first n whose four are free (or the n of --port). When <dir>'s ports have
//     been taken since, or another db:start takes them between this one's choice and its start, it moves to the first
//     free set, and its block, and .env.local when that is <dir>'s block, are rewritten to match; any other .env.local
//     is never changed. The Postgres is of CI's major version (the image in .github/workflows/ci.yml) when one is
//     installed, on PATH, in Homebrew's folders or in /usr/lib/postgresql, else the newest there, which it says. Its
//     database sorts text by code point and keeps time in UTC, as the live database does (initdb() below). A <dir> made
//     by another major version, which cannot be opened, or made to sort or keep time otherwise, is made again.
//   pnpm db:stop [--dir <dir>]  Stops that Postgres, and nothing else.
//   pnpm dev:local [--dir <dir>]  `next dev` on 127.0.0.1 at the block's site port, in the foreground, once .env.local is
//     <dir>'s block; beside it `pnpm fake-lichess` and `pnpm fake-telegram`, also in the foreground; then `pnpm seed`
//     and `pnpm seed:cookies`.
//   pnpm local:list  Each Postgres, site and fake these tools started, from any worktree of this repository, that is
//     still running: what it is, its port, its age, its folder, even once that folder is gone, and the worktree it was
//     started from when that is another folder.
//   pnpm local:stop --dir <worktree>  Stops those started from that worktree, and nothing else: not what was started
//     from the worktrees inside it. pnpm local:stop --all stops every one of them; alone, it stops nothing.
// A second, empty database while the first runs, such as for the opt-in Postgres suites once the first is seeded:
// `pnpm db:start --dir .local-db-tests`, which prints its address.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// What db:start writes on the database it creates. The seed works only on a database that has it, so that a real one
// with nobody in it yet, behind a port forwarded to this machine, is refused too.
export const MARK = "offboard: a throwaway local database made by pnpm db:start";

// Whether the database `db` (a pg pool or client) is connected to carries that mark. The seed and pnpm collect-results
// ask it in their first statement, and touch nothing when it does not.
export async function madeByDbStart(db) {
  const { rows } = await db.query(
    "select shobj_description(oid, 'pg_database') as mark from pg_database where datname = current_database()",
  );
  return rows[0]?.mark === MARK;
}

// Why the database at `url` must not be touched, or null when it is on this machine. The seed and the fake Lichess
// ask this before anything else, as db:start does of a DATABASE_URL in its environment. pg prefers a `host` in the
// query string to the address's, and the URL parser drops spaces and line breaks that pg would read otherwise, so both
// are refused too.
export function notLocal(url) {
  if (!url) return "DATABASE_URL is not set";
  if (/[\s\0-\x1f\x7f]/.test(url)) return "DATABASE_URL has a space or a control character in it";
  const address = URL.parse(url);
  if (!address || !/^postgres(ql)?:$/.test(address.protocol)) return "DATABASE_URL is not a postgres:// address";
  if (address.searchParams.has("host")) return "DATABASE_URL names a host in its query string";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
    return `DATABASE_URL's host is ${address.hostname || "missing"}, not this machine (localhost, 127.0.0.1 or ::1)`;
  return null;
}

// Why this checkout must not get a local environment, or null. A .env.local whose DATABASE_URL is not on this machine,
// or that has none or cannot be read, holds real settings, as the owner's checkout does.
export function checkoutProblem(envLocal) {
  if (envLocal === null) return null;
  const url = /^[ \t]*DATABASE_URL[ \t]*=[ \t]*(.*?)[ \t]*$/m.exec(envLocal)?.[1].replace(/^(["'])(.*)\1$/, "$2");
  return notLocal(url)
    ? "This checkout's .env.local holds real settings (its DATABASE_URL is not a database on this machine), so nothing was started: the local environment belongs in a worktree of its own."
    : null;
}

// Writes `text` to `path` only if there is no such file; an existing one is never changed. True if it wrote.
export function createOnce(path, text) {
  try {
    writeFileSync(path, text, { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const ENV_LOCAL = `${root}/.env.local`;
const HEADER = "# From `pnpm db:start`: a throwaway database on this machine, and every other value pretend.";
const USAGE =
  "Usage: pnpm db:start [--dir <dir>] [--port <port>], pnpm db:stop [--dir <dir>], pnpm dev:local [--dir <dir>], pnpm local:list, pnpm local:stop --dir <worktree> or pnpm local:stop --all.";
const say = (line) => console.log(line);
const variables = (block) => Object.fromEntries([...block.matchAll(/^([A-Z_]+)=(.*)$/gm)].map(([, name, value]) => [name, value]));
const portOf = (url) => Number(new URL(url).port);

// pnpm runs every script on the Node.js of package.json's devEngines.runtime, which CI's setup-node reads too, and npm
// and npx refuse to run on another major version (EBADDEVENGINES), and a bin in node_modules/.bin runs on the Node.js
// pnpm put there. A line saying so, when this runs on another major version anyway, as `node` itself run from a shell
// does; null otherwise.
export function nodeNotice() {
  const file = `${root}/package.json`;
  const wanted = existsSync(file) && /^\D*(\d+)/.exec(JSON.parse(readFileSync(file, "utf8")).devEngines?.runtime?.version ?? "")?.[1];
  const major = process.versions.node.split(".")[0];
  return wanted && major !== wanted
    ? `This is Node.js ${process.versions.node}, and CI runs Node.js ${wanted}: run it through pnpm, which uses the Node.js of package.json's devEngines.runtime.`
    : null;
}

// Taken when anything listens on it at any local address: macOS lets a server take 127.0.0.1:3100 while another holds
// *:3100, so each is tried.
const takenAt = (port, host) =>
  new Promise((done) => {
    const server = createServer().once("error", (error) => done(error.code === "EADDRINUSE"));
    server.listen({ port, host, exclusive: true }, () => server.close(() => done(false)));
  });
const taken = async (port) => (await takenAt(port, "127.0.0.1")) || (await takenAt(port, "::1")) || (await takenAt(port));

const BASE = { postgres: 55432, site: 3100, lichess: 8089, telegram: 8189 };
const SETS = 100;

// The first set of ports from `port` (Postgres's) or from the first, whose four are all free.
async function freeSet(port) {
  const first = port === undefined ? 0 : Number(port) - BASE.postgres;
  if (!Number.isInteger(first) || first < 0 || first >= SETS)
    throw new Error(`--port must be from ${BASE.postgres} to ${BASE.postgres + SETS - 1}: the site and the fakes take the ports that go with it.`);
  for (let n = first; n < (port === undefined ? SETS : first + 1); n++) {
    const set = { postgres: BASE.postgres + n, site: BASE.site + n, lichess: BASE.lichess + n, telegram: BASE.telegram + n };
    if (!(await taken(set.postgres)) && !(await taken(set.site)) && !(await taken(set.lichess)) && !(await taken(set.telegram))) return set;
  }
  throw new Error(
    port === undefined ? "No set of free ports was found." : `Port ${port}, ${BASE.site + first}, ${BASE.lichess + first} or ${BASE.telegram + first} is taken.`,
  );
}

// A database name of the directory's own, so that another checkout's stale .env.local on the same ports finds nothing.
const block = ({ postgres, site, lichess, telegram }) =>
  [
    HEADER,
    `DATABASE_URL=postgres://offboard@127.0.0.1:${postgres}/offboard_${randomBytes(6).toString("hex")}`,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
    `BETTER_AUTH_URL=http://localhost:${site}`,
    "# Pretend: Sign in with LinkedIn leaves for linkedin.com, which refuses it. Sign in as a seeded person (pnpm seed:cookies).",
    "LINKEDIN_CLIENT_ID=pretend-linkedin-client-id",
    "LINKEDIN_CLIENT_SECRET=pretend-linkedin-client-secret",
    "LICHESS_TEAM_ID=pretend-team",
    "LICHESS_TEAM_PASSWORD=pretend-team-password",
    "# The fake Lichess: pnpm fake-lichess.",
    `LICHESS_URL=http://127.0.0.1:${lichess}`,
    "# The Organiser is the seeded Member org (scripts/seed.ts).",
    "ORGANISER_USER_ID=org",
    `LICHESS_TOKEN_KEY=${randomBytes(32).toString("base64")}`,
    `CRON_SECRET=${randomBytes(32).toString("hex")}`,
    "ORGANISER_CONTACT_EMAIL=organiser@pretend.invalid",
    "# Pretend: the bot posts to the fake Telegram, pnpm fake-telegram, which prints each post. The invite link leads to",
    "# t.me, which has no such group.",
    "TELEGRAM_BOT_TOKEN=pretend-telegram-bot-token",
    "TELEGRAM_GROUP_ID=@pretend_offboard_group",
    "TELEGRAM_INVITE_LINK=https://t.me/+pretend-invite-link",
    "# Pretend: the Organiser's own chat, where the fake Telegram takes the private alerts.",
    "TELEGRAM_ORGANISER_CHAT_ID=123456789",
    `TELEGRAM_URL=http://127.0.0.1:${telegram}`,
    "NEXT_TELEMETRY_DISABLED=1",
    "",
  ].join("\n");

// The block's ports, as a set; a block made before the fake Telegram has none of its own.
const portsOf = (text) => {
  const env = variables(text);
  return [env.DATABASE_URL, env.BETTER_AUTH_URL, env.LICHESS_URL, env.TELEGRAM_URL].filter(Boolean).map(portOf);
};

// The block with its ports moved to `set`, its database and secrets kept.
const moved = (text, { postgres, site, lichess, telegram }) =>
  text
    .replace(/^(DATABASE_URL=postgres:\/\/offboard@127\.0\.0\.1:)\d+/m, `$1${postgres}`)
    .replace(/^(BETTER_AUTH_URL=http:\/\/localhost:)\d+/m, `$1${site}`)
    .replace(/^(LICHESS_URL=http:\/\/127\.0\.0\.1:)\d+/m, `$1${lichess}`)
    .replace(/^(TELEGRAM_URL=http:\/\/127\.0\.0\.1:)\d+/m, `$1${telegram}`);

// The checkout's .env.local; "" if it is there but cannot be read, such as a link to nothing; null if there is none.
function envLocal() {
  if (!lstatSync(ENV_LOCAL, { throwIfNoEntry: false })) return null;
  try {
    return readFileSync(ENV_LOCAL, "utf8");
  } catch {
    return "";
  }
}

// <dir>'s block, or null if db:start has not used <dir>. A directory holding a Postgres that db:start did not make,
// such as the owner's own, is refused.
function blockOf(dir) {
  const file = `${dir}/offboard.env`;
  const text = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (text === null ? existsSync(`${dir}/PG_VERSION`) : !text.startsWith(HEADER))
    throw new Error(`${dir} holds a Postgres that db:start did not make, so it is left alone.`);
  return text;
}

// The Postgres that db:start runs: a folder holding initdb and pg_ctl, of CI's major version if one is installed, else
// the newest installed, with its version and a line saying which it is.
function postgres() {
  const ci = /^\s*image: postgres:(\d+)\s*$/m.exec(readFileSync(`${root}/.github/workflows/ci.yml`, "utf8"))?.[1];
  if (!ci) throw new Error("No `image: postgres:<major>` was found in .github/workflows/ci.yml.");
  const brew = process.env.HOMEBREW_PREFIX ? [process.env.HOMEBREW_PREFIX] : ["/opt/homebrew", "/usr/local"];
  const within = (dir, name) => (existsSync(dir) ? readdirSync(dir).filter((each) => name.test(each)).map((each) => `${dir}/${each}/bin`) : []);
  const folders = [
    ...(process.env.PATH ?? "").split(":"),
    ...brew.flatMap((prefix) => [`${prefix}/bin`, ...within(`${prefix}/opt`, /^postgresql(@\d+)?$/)]),
    ...within("/usr/lib/postgresql", /^\d+$/),
  ];
  const installed = [...new Set(folders)].flatMap((dir) => {
    if (!dir.startsWith("/") || !existsSync(`${dir}/initdb`) || !existsSync(`${dir}/pg_ctl`)) return [];
    const version = /\(PostgreSQL\) ((\d+)[.\d]*)/.exec(spawnSync(`${dir}/pg_ctl`, ["--version"], { encoding: "utf8" }).stdout ?? "");
    return version ? [{ dir, version: version[1], major: version[2] }] : [];
  });
  const same = installed.find(({ major }) => major === ci);
  const chosen = same ?? installed.sort((a, b) => b.major - a.major)[0];
  const where = "on PATH, in Homebrew or in /usr/lib/postgresql";
  if (!chosen) throw new Error(`No Postgres was found ${where}. CI runs Postgres ${ci}: brew install postgresql@${ci}.`);
  const which = same
    ? `Postgres ${chosen.version}, CI's major version, from ${chosen.dir}.`
    : `Postgres ${chosen.version} from ${chosen.dir}, not CI's ${ci}, as no Postgres ${ci} was found ${where} (brew install postgresql@${ci}).`;
  return { ...chosen, which };
}

// initdb's options, for a database that sorts and keeps time as the live one does: Neon's Postgres 18 has the builtin
// provider's C.UTF-8, which sorts text by code point, and CI's postgres:18 is made so too (POSTGRES_INITDB_ARGS in
// .github/workflows/ci.yml); both keep UTC. Postgres 16 and before have no builtin provider, and their C sorts by code
// point as well, but changes the case of ASCII letters alone. The folder records how it was made (offboard.initdb), and
// one made otherwise, such as with another sort before, is made again.
const builtin = (major) => Number(major) >= 17;
const initdb = (major) => [
  ...["-U", "offboard", "--auth=trust", "-E", "UTF8", "--no-instructions"],
  ...(builtin(major) ? ["--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--locale=C.UTF-8"] : ["--no-locale"]),
];
const madeAsNow = (major) => `${initdb(major).join(" ")} TZ=UTC`;

const run = (file, args, env = process.env) => execFileSync(file, args, { stdio: ["ignore", 2, 2], env });
const running = (pg, dir) => spawnSync(`${pg.dir}/pg_ctl`, ["-D", dir, "status"], { stdio: "ignore" }).status === 0;
const madeBy = (dir) => (existsSync(`${dir}/PG_VERSION`) ? readFileSync(`${dir}/PG_VERSION`, "utf8").trim() : null);
const madeAs = (dir) => (existsSync(`${dir}/offboard.initdb`) ? readFileSync(`${dir}/offboard.initdb`, "utf8").trim() : null);

// Each Postgres, site and fake these tools start is recorded in the repository's git folder, which every worktree of
// it shares and which outlives a worktree's folder, as <pid>.json: what it is, its port, its folder, the worktree it
// was started from (this checkout), and the start time and command line ps gives it. A record counts only while a
// process of that pid has both still, so that nothing else is ever listed or stopped, whatever has taken its pid since.
// A tool that runs these in a copy of a worktree gives them the repository's folder instead, so that what the copy
// starts is listed and stopped with the rest: OFFBOARD_LOCAL_REGISTRY=<git common dir>/offboard-local.
function registry() {
  const given = process.env.OFFBOARD_LOCAL_REGISTRY;
  if (given !== undefined && !given.startsWith("/")) throw new Error(`OFFBOARD_LOCAL_REGISTRY is ${JSON.stringify(given)}, not an absolute path, so nothing was started.`);
  if (given) return given;
  const git = spawnSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (git.status !== 0) throw new Error(`${root} is not a git checkout, where these tools record what they start, so nothing was started.`);
  return `${git.stdout.trim()}/offboard-local`;
}

// When the process `pid` started, in UTC whatever the caller's time zone, and its command line; null when there is no
// such process; undefined when ps cannot say.
function processOf(pid) {
  const ps = spawnSync("ps", ["-ww", "-o", "lstart=,command=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } });
  if (ps.error || ps.stderr.trim()) return undefined;
  const found = /^(\w{3} \w{3} +\d+ [\d:]{8} \d{4}) +(.*)$/m.exec(ps.stdout);
  return found ? { start: found[1], command: found[2] } : null;
}
const started = (start) => Date.parse(`${start} UTC`);

// Finds where records go before anything is started, so that nothing runs that could not be recorded: outside a git
// checkout it throws. What it returns records the process `pid` as `kind`, on `port`, started in `folder`.
export function recorder() {
  const dir = registry();
  return (kind, port, { folder = root, pid = process.pid } = {}) => {
    const found = processOf(pid);
    if (!found) throw new Error(`${kind} (process ${pid}) is not running, so it was not recorded.`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${pid}.tmp`, JSON.stringify({ kind, port, folder, worktree: root, pid, ...found }));
    renameSync(`${dir}/${pid}.tmp`, `${dir}/${pid}.json`);
  };
}

// The record in `file`, or null when it is not one these tools write.
function recordIn(file) {
  try {
    const each = JSON.parse(readFileSync(file, "utf8"));
    const strings = ["kind", "folder", "worktree", "start", "command"].every((name) => typeof each[name] === "string");
    return strings && Number.isInteger(each.port) && Number.isInteger(each.pid) && each.pid > 0 ? each : null;
  } catch {
    return null;
  }
}

// Each record whose process is still running, oldest first. The record of a process that has gone is removed; a file
// that is not a record, or whose process ps cannot ask about, is left as it is, and said so.
function recorded() {
  const dir = registry();
  const still = [];
  for (const name of existsSync(dir) ? readdirSync(dir).filter((each) => each.endsWith(".json")) : []) {
    const file = `${dir}/${name}`;
    const each = recordIn(file);
    const now = each && processOf(each.pid);
    if (!each) console.error(`${file} is not a record these tools write, so it was left alone.`);
    else if (now === undefined) console.error(`ps could not say whether process ${each.pid} runs, so ${file} was left alone.`);
    else if (now?.start === each.start && now.command === each.command) still.push(each);
    else rmSync(file, { force: true });
  }
  return still.sort((a, b) => started(a.start) - started(b.start));
}

function age(start) {
  const minutes = Math.floor((Date.now() - started(start)) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / (24 * 60))} d ${Math.floor(minutes / 60) % 24} h`;
}
const line = ({ kind, port, start, folder, worktree }) =>
  `${kind.padEnd(13)} ${String(port).padEnd(6)} ${age(start).padEnd(13)} ${folder}${existsSync(folder) ? "" : " (folder gone)"}${folder === worktree ? "" : `, from worktree ${worktree}`}`;

// Creates the block's database in initdb's own "postgres", by the address alone, and marks it, unless it is there.
async function ensureDatabase(url) {
  const name = new URL(url).pathname.slice(1);
  if (!/^offboard(_[0-9a-f]+)?$/.test(name)) throw new Error(`${name} is not a database name db:start gives.`);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url.replace(/[^/]+$/, "postgres") });
  await client.connect();
  try {
    if ((await client.query("select 1 from pg_database where datname = $1", [name])).rowCount) return;
    await client.query(`create database ${name}`);
    await client.query(`comment on database ${name} is '${MARK}'`);
  } finally {
    await client.end();
  }
}

async function start(dir, port) {
  const problem =
    checkoutProblem(envLocal()) ??
    (process.env.DATABASE_URL && notLocal(process.env.DATABASE_URL) && `Refusing to start beside a real DATABASE_URL in the environment: ${notLocal(process.env.DATABASE_URL)}. Unset it first.`);
  if (problem) throw new Error(problem);
  const saved = blockOf(dir);
  if (saved && port !== undefined && Number(port) !== portOf(variables(saved).DATABASE_URL))
    throw new Error(`${dir} uses port ${portOf(variables(saved).DATABASE_URL)}: leave out --port, or give another --dir.`);
  const pg = postgres();
  const record = recorder();
  let text = saved ?? block(await freeSet(port));
  if (saved && running(pg, dir)) {
    const made = madeBy(dir);
    say(
      made === pg.major && madeAs(dir) === madeAsNow(pg.major)
        ? `Postgres ${made} was running already.`
        : `Postgres ${made} was running already, made otherwise than db:start makes one now: pnpm db:stop, then pnpm db:start, makes it again on Postgres ${pg.major}, sorting and keeping time as the live database does.`,
    );
  } else {
    say(pg.which);
    say(
      builtin(pg.major)
        ? "It sorts text by code point (the builtin C.UTF-8) and keeps time in UTC, as the live database does."
        : `It sorts text by code point (C, as Postgres ${pg.major} has no builtin C.UTF-8, so upper() and lower() change ASCII letters alone, where the live database's change every letter) and keeps time in UTC.`,
    );
    // A port this worktree's own site or fakes hold is not taken by anyone else.
    const own = new Set(recorded().flatMap((each) => (each.worktree === root && each.kind !== "Postgres" ? [each.port] : [])));
    if (saved && (await Promise.all(portsOf(saved).map((each) => !own.has(each) && taken(each)))).some(Boolean)) {
      text = moved(saved, await freeSet(port));
      say(`The ports ${dir} had are taken now, so it has the first free set: ${portsOf(text).join(", ")}.`);
    }
    const made = saved && madeBy(dir);
    const fresh = made !== pg.major || madeAs(dir) !== madeAsNow(pg.major);
    if (fresh) {
      // A data folder opens only in the major version that made it, and keeps the sort it was made with. This one is
      // throwaway, so it is made again, empty.
      if (saved) rmSync(dir, { recursive: true, force: true });
      if (made && made !== pg.major) say(`${dir} was made by Postgres ${made}, which Postgres ${pg.major} cannot open, so it was made again, empty.`);
      else if (made) say(`${dir} was made to sort or keep time otherwise than the live database does, so it was made again, empty.`);
      run(`${pg.dir}/initdb`, ["-D", dir, ...initdb(pg.major)], { ...process.env, TZ: "UTC" });
      writeFileSync(`${dir}/offboard.initdb`, `${madeAsNow(pg.major)}\n`);
    }
    if (fresh || text !== saved) writeFileSync(`${dir}/offboard.env`, text, { mode: 0o600 }); // at once, so that a start that fails after this resumes
    if (saved && text !== saved && envLocal() === saved) {
      writeFileSync(ENV_LOCAL, text, { mode: 0o600 });
      say(".env.local, which was its block, has the new ports.");
    }
    // Scratch paths are too long for a Unix socket, so TCP on 127.0.0.1 only. Another db:start may have found the same
    // ports free a moment before this one, and taken them since: then this one moves to the next free set and tries again.
    for (let tries = 1; ; tries++) {
      const postgres = portOf(variables(text).DATABASE_URL);
      const options = `-c listen_addresses=127.0.0.1 -p ${postgres} -c unix_socket_directories=''`;
      try {
        run(`${pg.dir}/pg_ctl`, ["-D", dir, "-l", `${dir}/postgres.log`, "-o", options, "-w", "start"]);
        break;
      } catch (error) {
        if (running(pg, dir)) break; // pg_ctl stopped waiting, but the server came up all the same: it is this folder's
        if (tries === 5 || !(await taken(postgres))) throw error;
        const before = text;
        text = moved(text, await freeSet(port));
        writeFileSync(`${dir}/offboard.env`, text, { mode: 0o600 });
        if (envLocal() === before) writeFileSync(ENV_LOCAL, text, { mode: 0o600 });
        say(`Port ${postgres} was taken a moment ago, so ${dir} has the next free set: ${portsOf(text).join(", ")}.`);
      }
    }
  }
  const env = variables(text);
  const pid = Number(readFileSync(`${dir}/postmaster.pid`, "utf8").split("\n")[0]);
  record("Postgres", portOf(env.DATABASE_URL), { folder: realpathSync(dir), pid });
  await ensureDatabase(env.DATABASE_URL);
  run(process.execPath, [`${root}/scripts/migrate.mjs`], { ...process.env, DATABASE_URL: env.DATABASE_URL });
  const created = createOnce(ENV_LOCAL, text);
  say(`Postgres is running in ${dir}: ${env.DATABASE_URL}`);
  if (!created && envLocal() !== text) {
    say(`.env.local was left as it was: it is not this database's block (${dir}/offboard.env).`);
    return say(`For the opt-in suites: ALLOW_DB_TESTS=1 DATABASE_URL=${env.DATABASE_URL} pnpm test`);
  }
  say(created ? `.env.local was created from ${dir}/offboard.env.` : ".env.local is this block already.");
  const telegram = env.TELEGRAM_URL ? ` and pnpm fake-telegram (${env.TELEGRAM_URL})` : "";
  say(`Next, each in the foreground, as a background task of your own: pnpm dev:local (${env.BETTER_AUTH_URL}), pnpm fake-lichess (${env.LICHESS_URL})${telegram}.`);
  say("Then pnpm seed, and pnpm seed:cookies to sign in as a seeded person. pnpm local:stop --dir . stops all of them.");
}

function stop(dir) {
  blockOf(dir);
  const pg = postgres();
  if (!running(pg, dir)) return say(`No Postgres is running in ${dir}.`);
  run(`${pg.dir}/pg_ctl`, ["-D", dir, "-m", "fast", "-w", "stop"]);
}

// `next dev` in the foreground, bound to this machine alone, on this Node.js, with the signals that stop this process
// passed on to it.
async function dev(dir) {
  const text = blockOf(dir);
  if (!text || envLocal() !== text) throw new Error(`.env.local is not ${dir}/offboard.env, so the site was not started: run pnpm db:start first.`);
  const site = portOf(variables(text).BETTER_AUTH_URL);
  if (await taken(site)) throw new Error(`Port ${site}, the site's, is taken.`);
  const record = recorder();
  const next = `${root}/node_modules/next/dist/bin/next`;
  const child = spawn(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", String(site)], { cwd: root, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  record("site", site, { pid: child.pid });
  return new Promise((done) => child.on("exit", (code) => done(code ?? 1)));
}

function list() {
  const all = recorded();
  if (!all.length) return say("Nothing these tools started is running.");
  for (const each of all) say(line(each));
}

// What was started from the worktree <dir>, and not from the worktrees inside it (the main checkout holds the agents'
// in .claude/worktrees), or with --all everything. Postgres is sent SIGINT, its fast shutdown, as pg_ctl stop -m fast
// sends; the site and the fakes SIGTERM.
async function stopAll(dir) {
  const worktree = dir && existsSync(dir) ? realpathSync(dir) : dir; // the records' are real paths
  const chosen = recorded().filter((each) => dir === undefined || each.worktree === worktree);
  if (!chosen.length)
    return say(
      dir === undefined
        ? "Nothing these tools started is running."
        : `Nothing these tools started is running from the worktree ${dir}. --dir takes a worktree: in pnpm local:list, the one after "from worktree", or the folder of a site or a fake.`,
    );
  for (const { pid, kind } of chosen)
    try {
      process.kill(pid, kind === "Postgres" ? "SIGINT" : "SIGTERM");
    } catch {
      // it has stopped since
    }
  let left = chosen;
  for (let waited = 0; left.length && waited < 20_000; waited += 100) {
    await new Promise((done) => setTimeout(done, 100));
    left = left.filter(({ pid, start }) => processOf(pid)?.start === start);
  }
  for (const each of chosen) say(`${left.includes(each) ? "Still running after 20 s:" : "Stopped:"} ${line(each)}`);
  return left.length ? 1 : 0;
}

// Run, not imported: the seed and the tests import what is exported above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No PG* variable may send a child process anywhere but the address it is given.
  for (const name of Object.keys(process.env)) if (name.startsWith("PG")) delete process.env[name];
  const notice = nodeNotice();
  if (notice) console.error(notice);
  const commands = { start, stop, dev, list, "stop-all": stopAll };
  const takes = { start: ["--dir", "--port"], stop: ["--dir"], dev: ["--dir"], list: [], "stop-all": ["--dir", "--all"] };
  const [command, ...rest] = process.argv.slice(2);
  const options = {};
  let valid = Object.hasOwn(commands, command ?? "");
  for (let i = 0; i < rest.length && valid; i++)
    if (!takes[command].includes(rest[i])) valid = false;
    else if (rest[i] === "--all") options["--all"] = true;
    else if (rest[i + 1] === undefined) valid = false;
    else options[rest[i]] = rest[++i];
  // pnpm local:stop alone stops nothing: it takes the worktree, or --all.
  if (command === "stop-all" && Object.hasOwn(options, "--all") === Object.hasOwn(options, "--dir")) valid = false;
  if (!valid) {
    console.error(USAGE);
    process.exit(1);
  }
  const dir = options["--dir"] === undefined ? (command === "stop-all" ? undefined : `${root}/.local-db`) : resolve(options["--dir"]);
  Promise.resolve()
    .then(() => commands[command](dir, options["--port"]))
    .then(
      (code) => process.exit(code ?? 0),
      (error) => {
        console.error(error.message);
        process.exit(1);
      },
    );
}
