// A throwaway Postgres for a checkout, and an env block in which every other value is pretend, so that pages can be
// looked at in a browser with nothing real behind them. It belongs in a worktree: it refuses a checkout whose
// .env.local holds a database that is not on this machine, and a directory holding a Postgres it did not make.
//
//   pnpm db:start [--dir <dir>] [--port <port>]  Postgres in <dir> (default .local-db/, git-ignored) on 127.0.0.1, with a
//     database named for <dir> alone, marked and migrated, and the env block in <dir>/offboard.env, from which a missing
//     .env.local is created; an existing one is never changed. The ports come as a set, Postgres 55432 + n, the site
//     3100 + n and the fake Lichess 8089 + n, for the first n whose three are free (or the n of --port).
//   pnpm db:stop [--dir <dir>]  Stops that Postgres, and nothing else.
//   pnpm dev:local [--dir <dir>]  `next dev` on 127.0.0.1 at the block's site port, in the foreground, once .env.local is
//     <dir>'s block; beside it `pnpm fake-lichess`, also in the foreground; then `pnpm seed` and `pnpm seed:cookies`.
// A second, empty database while the first runs, such as for the opt-in Postgres suites once the first is seeded:
// `pnpm db:start --dir .local-db-tests`, which prints its address. Uses initdb and pg_ctl from PATH or /opt/homebrew/bin.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// What db:start writes on the database it creates. The seed works only on a database that has it, so that a real one
// with nobody in it yet, behind a port forwarded to this machine, is refused too.
export const MARK = "offboard: a throwaway local database made by pnpm db:start";

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
const USAGE = "Usage: pnpm db:start [--dir <dir>] [--port <port>], pnpm db:stop [--dir <dir>] or pnpm dev:local [--dir <dir>].";
const say = (line) => console.log(line);
const bin = (name) =>
  [...(process.env.PATH ?? "").split(":"), "/opt/homebrew/bin"].map((dir) => `${dir}/${name}`).find(existsSync) ?? name;
const run = (name, args, env = process.env) => execFileSync(bin(name), args, { stdio: ["ignore", 2, 2], env });
const running = (dir) => spawnSync(bin("pg_ctl"), ["-D", dir, "status"], { stdio: "ignore" }).status === 0;
const variables = (block) => Object.fromEntries([...block.matchAll(/^([A-Z_]+)=(.*)$/gm)].map(([, name, value]) => [name, value]));
const portOf = (url) => Number(new URL(url).port);

// Taken when anything listens on it at any local address: macOS lets a server take 127.0.0.1:3100 while another holds
// *:3100, so each is tried.
const takenAt = (port, host) =>
  new Promise((done) => {
    const server = createServer().once("error", (error) => done(error.code === "EADDRINUSE"));
    server.listen({ port, host, exclusive: true }, () => server.close(() => done(false)));
  });
const taken = async (port) => (await takenAt(port, "127.0.0.1")) || (await takenAt(port, "::1")) || (await takenAt(port));

const BASE = { postgres: 55432, site: 3100, lichess: 8089 };
const SETS = 100;

// The first set of ports from `port` (Postgres's) or from the first, whose three are all free.
async function freeSet(port) {
  const first = port === undefined ? 0 : Number(port) - BASE.postgres;
  if (!Number.isInteger(first) || first < 0 || first >= SETS)
    throw new Error(`--port must be from ${BASE.postgres} to ${BASE.postgres + SETS - 1}: the site and the fake Lichess take the ports that go with it.`);
  for (let n = first; n < (port === undefined ? SETS : first + 1); n++) {
    const set = { postgres: BASE.postgres + n, site: BASE.site + n, lichess: BASE.lichess + n };
    if (!(await taken(set.postgres)) && !(await taken(set.site)) && !(await taken(set.lichess))) return set;
  }
  throw new Error(port === undefined ? "No set of free ports was found." : `Port ${port}, ${BASE.site + first} or ${BASE.lichess + first} is taken.`);
}

// A database name of the directory's own, so that another checkout's stale .env.local on the same ports finds nothing.
const block = ({ postgres, site, lichess }) =>
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
    "NEXT_TELEMETRY_DISABLED=1",
    "",
  ].join("\n");

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
  const text = saved ?? block(await freeSet(port));
  const env = variables(text);
  const postgres = portOf(env.DATABASE_URL);
  if (port !== undefined && Number(port) !== postgres) throw new Error(`${dir} uses port ${postgres}: leave out --port, or give another --dir.`);
  if (!saved) {
    run("initdb", ["-D", dir, "-U", "offboard", "--auth=trust", "--no-locale", "-E", "UTF8", "--no-instructions"]);
    writeFileSync(`${dir}/offboard.env`, text, { mode: 0o600 }); // at once, so that a start that fails after this resumes
  }
  if (!running(dir)) {
    if (await taken(postgres)) throw new Error(`Port ${postgres}, which ${dir} uses, is taken.`);
    // Scratch paths are too long for a Unix socket, so TCP on 127.0.0.1 only.
    run("pg_ctl", ["-D", dir, "-l", `${dir}/postgres.log`, "-o", `-c listen_addresses=127.0.0.1 -p ${postgres} -c unix_socket_directories=''`, "-w", "start"]);
  }
  await ensureDatabase(env.DATABASE_URL);
  run(process.execPath, [`${root}/scripts/migrate.mjs`], { ...process.env, DATABASE_URL: env.DATABASE_URL });
  const created = createOnce(ENV_LOCAL, text);
  say(`Postgres is running in ${dir}: ${env.DATABASE_URL}`);
  if (!created && envLocal() !== text) {
    say(`.env.local was left as it was: it is not this database's block (${dir}/offboard.env).`);
    return say(`For the opt-in suites: ALLOW_DB_TESTS=1 DATABASE_URL=${env.DATABASE_URL} pnpm test`);
  }
  say(created ? `.env.local was created from ${dir}/offboard.env.` : ".env.local is this block already.");
  say(`Next, each in the foreground, as a background task of your own: pnpm dev:local (${env.BETTER_AUTH_URL}) and pnpm fake-lichess (${env.LICHESS_URL}).`);
  say("Then pnpm seed, and pnpm seed:cookies to sign in as a seeded person. pnpm db:stop stops Postgres; stop the other two yourself.");
}

function stop(dir) {
  blockOf(dir);
  if (!running(dir)) return say(`No Postgres is running in ${dir}.`);
  run("pg_ctl", ["-D", dir, "-m", "fast", "-w", "stop"]);
}

// `next dev` in the foreground, bound to this machine alone, with the signals that stop this process passed on to it.
async function dev(dir) {
  const text = blockOf(dir);
  if (!text || envLocal() !== text) throw new Error(`.env.local is not ${dir}/offboard.env, so the site was not started: run pnpm db:start first.`);
  const site = portOf(variables(text).BETTER_AUTH_URL);
  if (await taken(site)) throw new Error(`Port ${site}, the site's, is taken.`);
  const child = spawn(`${root}/node_modules/.bin/next`, ["dev", "--hostname", "127.0.0.1", "--port", String(site)], { cwd: root, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  return new Promise((done) => child.on("exit", (code) => done(code ?? 1)));
}

// Run, not imported: the seed and the tests import what is exported above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No PG* variable may send a child process anywhere but the address it is given.
  for (const name of Object.keys(process.env)) if (name.startsWith("PG")) delete process.env[name];
  const [command, ...rest] = process.argv.slice(2);
  const options = {};
  let valid = Object.hasOwn({ start, stop, dev }, command ?? "");
  for (let i = 0; i < rest.length && valid; i += 2)
    if (["--dir", ...(command === "start" ? ["--port"] : [])].includes(rest[i]) && rest[i + 1] !== undefined) options[rest[i]] = rest[i + 1];
    else valid = false;
  if (!valid) {
    console.error(USAGE);
    process.exit(1);
  }
  const dir = resolve(options["--dir"] ?? `${root}/.local-db`);
  Promise.resolve()
    .then(() => ({ start, stop, dev })[command](dir, options["--port"]))
    .then(
      (code) => process.exit(code ?? 0),
      (error) => {
        console.error(error.message);
        process.exit(1);
      },
    );
}
