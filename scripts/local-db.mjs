// The local environment of a checkout: a throwaway Postgres on this machine, an env block in which every other value
// is pretend, the site and the fake Lichess, so that pages can be looked at in a browser with nothing real behind them.
// It belongs in a worktree: it refuses a checkout whose .env.local holds a database that is not on this machine.
//
//   pnpm db:start [--dir <dir>] [--port <port>]
//     Starts Postgres in <dir> (default .local-db/, git-ignored) on 127.0.0.1, creating and marking database "offboard"
//     the first time and applying the migrations, and writes the env block to <dir>/offboard.env. The ports come as a
//     set, Postgres 55432 + n, the site 3100 + n and the fake Lichess 8089 + n, for the first n whose three are all free
//     (or the n of --port), and stay with <dir>. If the checkout has no .env.local, it is created from the block; an
//     existing one is never changed. When .env.local is this block, db:start also starts the site (`next dev`) and the
//     fake Lichess (scripts/fake-lichess.ts) in the background, logging to <dir>, and records them there. Run again, it
//     starts whatever is not running and changes nothing else.
//   pnpm db:stop [--dir <dir>]
//     Stops what db:start started in <dir>, and only that: the site, the fake Lichess and Postgres.
//
// A second, empty database while the first keeps running, such as for the opt-in Postgres suites once the first is
// seeded: `pnpm db:start --dir .local-db-tests` starts Postgres alone (.env.local is the first one's) and prints its
// address for `ALLOW_DB_TESTS=1 DATABASE_URL=<address> pnpm test`; `pnpm db:stop --dir .local-db-tests` stops it.
//
// Uses initdb and pg_ctl from PATH, or else /opt/homebrew/bin. Then `pnpm seed` and `pnpm seed:cookies`.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
// or that has none, holds real settings, as the owner's checkout does.
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
const say = (line) => console.log(line);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
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

const block = ({ postgres, site, lichess }) =>
  [
    "# From `pnpm db:start`: a throwaway database on this machine, and every other value pretend.",
    `DATABASE_URL=postgres://offboard@127.0.0.1:${postgres}/offboard`,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
    `BETTER_AUTH_URL=http://localhost:${site}`,
    "# Pretend: Sign in with LinkedIn leaves for linkedin.com, which refuses it. Sign in as a seeded person (pnpm seed:cookies).",
    "LINKEDIN_CLIENT_ID=pretend-linkedin-client-id",
    "LINKEDIN_CLIENT_SECRET=pretend-linkedin-client-secret",
    "LICHESS_TEAM_ID=pretend-team",
    "LICHESS_TEAM_PASSWORD=pretend-team-password",
    "# The fake Lichess, which db:start runs.",
    `LICHESS_URL=http://127.0.0.1:${lichess}`,
    "# The Organiser is the seeded Member org (scripts/seed.ts).",
    "ORGANISER_USER_ID=org",
    `LICHESS_TOKEN_KEY=${randomBytes(32).toString("base64")}`,
    `CRON_SECRET=${randomBytes(32).toString("hex")}`,
    "ORGANISER_CONTACT_EMAIL=organiser@pretend.invalid",
    "NEXT_TELEMETRY_DISABLED=1",
    "",
  ].join("\n");

// Creates database "offboard" in initdb's own "postgres", by the address alone, and marks it.
async function createDatabase(port) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: `postgres://offboard@127.0.0.1:${port}/postgres` });
  await client.connect();
  try {
    await client.query("create database offboard");
    await client.query(`comment on database offboard is '${MARK}'`);
  } finally {
    await client.end();
  }
}

// The process db:start recorded as `name` in `dir`, if it is still that process: one started from this checkout.
function recorded(dir, name) {
  const file = `${dir}/${name}.pid`;
  const pid = existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
  const command = pid > 0 ? (spawnSync("ps", ["-o", "command=", "-p", String(pid)]).stdout?.toString() ?? "") : "";
  return command.includes(`${root}/`) ? pid : null;
}

// Starts `command` in a process group of its own, logging to <dir>/<name>.log, and records it, unless it is running.
async function background(dir, name, port, [command, ...args], env) {
  if (recorded(dir, name)) return;
  if (await taken(port)) throw new Error(`Port ${port}, for the ${name}, is taken by something db:start did not start.`);
  const log = openSync(`${dir}/${name}.log`, "a");
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ["ignore", log, log], env: { ...process.env, ...env } });
  let ended = false;
  child.on("exit", () => (ended = true)).unref();
  writeFileSync(`${dir}/${name}.pid`, String(child.pid));
  for (let i = 0; i < 120 && !ended && !(await taken(port)); i++) await sleep(500);
  if (ended) throw new Error(`The ${name} stopped as soon as it started: see ${dir}/${name}.log.`);
}

async function start(dir, port) {
  const envLocalFile = `${root}/.env.local`;
  const problem =
    checkoutProblem(existsSync(envLocalFile) ? readFileSync(envLocalFile, "utf8") : null) ??
    (process.env.DATABASE_URL && notLocal(process.env.DATABASE_URL) && `Refusing to start beside a real DATABASE_URL in the environment: ${notLocal(process.env.DATABASE_URL)}. Unset it first.`);
  if (problem) throw new Error(problem);
  const envFile = `${dir}/offboard.env`;
  const saved = existsSync(envFile) ? readFileSync(envFile, "utf8") : null;
  if (running(dir) && !saved) throw new Error(`Postgres is running in ${dir}, but db:start did not start it.`);
  const text = saved ?? block(await freeSet(port));
  const env = variables(text);
  const ports = { postgres: portOf(env.DATABASE_URL), site: portOf(env.BETTER_AUTH_URL), lichess: portOf(env.LICHESS_URL) };
  if (port !== undefined && Number(port) !== ports.postgres) throw new Error(`${dir} uses port ${ports.postgres}: leave out --port, or give another --dir.`);

  const fresh = !existsSync(`${dir}/PG_VERSION`);
  if (fresh) run("initdb", ["-D", dir, "-U", "offboard", "--auth=trust", "--no-locale", "-E", "UTF8", "--no-instructions"]);
  if (!running(dir)) {
    if (await taken(ports.postgres)) throw new Error(`Port ${ports.postgres}, which ${dir} uses, is taken.`);
    // Scratch paths are too long for a Unix socket, so TCP on 127.0.0.1 only.
    const settings = `-c listen_addresses=127.0.0.1 -p ${ports.postgres} -c unix_socket_directories=''`;
    run("pg_ctl", ["-D", dir, "-l", `${dir}/postgres.log`, "-o", settings, "-w", "start"]);
  }
  if (fresh) await createDatabase(ports.postgres);
  run(process.execPath, [`${root}/scripts/migrate.mjs`], { ...process.env, DATABASE_URL: env.DATABASE_URL });
  if (!saved) writeFileSync(envFile, text, { mode: 0o600 });
  const created = createOnce(envLocalFile, text);
  say(`Postgres is running in ${dir}: ${env.DATABASE_URL}`);
  if (!created && readFileSync(envLocalFile, "utf8") !== text) {
    say(`.env.local was left as it was. It is not this database's block (${envFile}), so only Postgres was started.`);
    say(`For the opt-in suites: ALLOW_DB_TESTS=1 DATABASE_URL=${env.DATABASE_URL} pnpm test`);
    return;
  }
  say(created ? `.env.local was created from ${envFile}.` : ".env.local is this block already.");
  await background(dir, "fake-lichess", ports.lichess, [`${root}/node_modules/.bin/tsx`, `${root}/scripts/fake-lichess.ts`], env);
  await background(dir, "site", ports.site, [`${root}/node_modules/.bin/next`, "dev", "--port", String(ports.site)], env);
  say(`The site is at ${env.BETTER_AUTH_URL} and the fake Lichess at ${env.LICHESS_URL}; their logs are in ${dir}.`);
  say("Next: pnpm seed, then pnpm seed:cookies to sign in as a seeded person. pnpm db:stop stops all three.");
}

async function stop(dir) {
  for (const name of ["site", "fake-lichess"]) {
    const pid = recorded(dir, name);
    rmSync(`${dir}/${name}.pid`, { force: true });
    if (!pid) continue;
    // The whole group: `next dev` and the server it starts, tsx and the node it runs.
    const alive = () => {
      try {
        return process.kill(-pid, 0);
      } catch {
        return false;
      }
    };
    process.kill(-pid, "SIGTERM");
    for (let i = 0; i < 50 && alive(); i++) await sleep(200);
    if (alive()) process.kill(-pid, "SIGKILL");
    say(`Stopped the ${name} (process ${pid}).`);
  }
  if (!running(dir)) return say(`No Postgres is running in ${dir}.`);
  run("pg_ctl", ["-D", dir, "-m", "fast", "-w", "stop"]);
}

// Run, not imported: the seed and the tests import what is exported above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No PG* variable may send a child process anywhere but the address it is given.
  for (const name of Object.keys(process.env)) if (name.startsWith("PG")) delete process.env[name];
  const [command, ...rest] = process.argv.slice(2);
  const options = {};
  let problem = { start, stop }[command] ? null : "Give start or stop.";
  for (let i = 0; i < rest.length && !problem; i += 2) {
    if (["--dir", ...(command === "start" ? ["--port"] : [])].includes(rest[i]) && rest[i + 1] !== undefined) options[rest[i]] = rest[i + 1];
    else problem = `Unknown argument ${rest[i]}.`;
  }
  if (process.argv.includes("--help")) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").match(/^(\/\/.*\n)+/)[0].replace(/^\/\/ ?/gm, ""));
    process.exit(0);
  }
  if (problem) {
    console.error(`${problem} Run with --help.`);
    process.exit(1);
  }
  const dir = resolve(options["--dir"] ?? `${root}/.local-db`);
  (command === "start" ? start(dir, options["--port"]) : stop(dir)).then(
    () => process.exit(0),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
