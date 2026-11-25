// A throwaway Postgres on this machine, migrated, and an env block for `pnpm dev` in which every value is pretend, so
// that a fresh checkout can be looked at in a browser without anything real:
//
//   pnpm db:start [--dir <dir>] [--port <port>] [--site-port <port>] > .env.local
//     Starts Postgres in <dir> (default .local-db/, git-ignored) on 127.0.0.1:<port> (default the first free port from
//     55432), creating database "offboard" the first time, applies the migrations, and prints the env block to stdout
//     for `pnpm dev --port <site port>` (default the first free port from 3100). Everything else goes to stderr, and it
//     never writes .env.local itself. Run again while Postgres is running, it migrates and prints the same block.
//   pnpm db:stop [--dir <dir>]
//     Stops that Postgres, and whatever this checkout is running on the block's site and fake Lichess ports.
//
// Uses initdb, pg_ctl and psql from PATH, or else /opt/homebrew/bin. Then `pnpm seed`, `pnpm seed:cookies` and
// `pnpm fake-lichess`.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Why the database at `url` must not be touched, or null when it is on this machine. The seed and the fake Lichess
// ask this before anything else, and so does db:start of any DATABASE_URL already in its environment. pg takes a
// `host` in the query string over the one in the address, so that is refused too.
export function notLocal(url) {
  if (!url) return "DATABASE_URL is not set";
  const address = URL.parse(url);
  if (!address || !/^postgres(ql)?:$/.test(address.protocol)) return "DATABASE_URL is not a postgres:// address";
  if (address.searchParams.has("host")) return "DATABASE_URL names a host in its query string";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
    return `DATABASE_URL's host is ${address.hostname || "missing"}, not this machine (localhost, 127.0.0.1 or ::1)`;
  return null;
}

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const say = (line) => console.error(line);
const bin = (name) =>
  [...(process.env.PATH ?? "").split(":"), "/opt/homebrew/bin"].map((dir) => `${dir}/${name}`).find(existsSync) ?? name;
// Child processes write to stderr, so that stdout carries the env block alone.
const run = (name, args, env = process.env) => execFileSync(bin(name), args, { stdio: ["ignore", 2, 2], env });

// Free when nothing is listening on it on any local address: macOS lets a server take 127.0.0.1:3100 while another
// holds *:3100, so each is tried.
const taken = (port, host) =>
  new Promise((done) => {
    const server = createServer().once("error", (error) => done(error.code === "EADDRINUSE"));
    server.listen({ port, host, exclusive: true }, () => server.close(() => done(false)));
  });
async function freePort(from) {
  for (let port = from; port < from + 100; port++)
    if (!(await taken(port, "127.0.0.1")) && !(await taken(port, "::1")) && !(await taken(port))) return port;
  throw new Error(`no free port from ${from} to ${from + 99}`);
}

function option(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function start(dir, envFile) {
  const why = process.env.DATABASE_URL && notLocal(process.env.DATABASE_URL);
  if (why) throw new Error(`Refusing to start beside a real DATABASE_URL: ${why}. Unset it first.`);
  const fresh = !existsSync(`${dir}/PG_VERSION`);
  if (fresh) run("initdb", ["-D", dir, "-U", "offboard", "--auth=trust", "--no-locale", "-E", "UTF8", "--no-instructions"]);
  const running = spawnSync(bin("pg_ctl"), ["-D", dir, "status"], { stdio: "ignore" }).status === 0;
  if (running && !existsSync(envFile)) throw new Error(`Postgres is running in ${dir}, but it was not started by db:start.`);
  const saved = running ? readFileSync(envFile, "utf8") : null;
  const port = saved ? new URL(saved.match(/^DATABASE_URL=(.*)$/m)[1]).port : (option("--port") ?? (await freePort(55432)));
  const url = `postgres://offboard@127.0.0.1:${port}/offboard`;
  if (!running) {
    // Scratch paths are too long for a Unix socket, so TCP on 127.0.0.1 only.
    const settings = `-c listen_addresses=127.0.0.1 -p ${port} -c unix_socket_directories=''`;
    run("pg_ctl", ["-D", dir, "-l", `${dir}/postgres.log`, "-o", settings, "-w", "start"]);
    if (fresh) run("psql", [url.replace(/offboard$/, "postgres"), "-q", "-c", "create database offboard"]);
  }
  run(process.execPath, [`${root}/scripts/migrate.mjs`], { ...process.env, DATABASE_URL: url });
  const env =
    saved ??
    [
      "# From `pnpm db:start`: a throwaway database on this machine, and every other value pretend.",
      `DATABASE_URL=${url}`,
      `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
      `BETTER_AUTH_URL=http://localhost:${option("--site-port") ?? (await freePort(3100))}`,
      "# Pretend, so Sign in with LinkedIn goes nowhere useful: sign in as a seeded person with `pnpm seed:cookies`.",
      "LINKEDIN_CLIENT_ID=pretend-linkedin-client-id",
      "LINKEDIN_CLIENT_SECRET=pretend-linkedin-client-secret",
      "LICHESS_TEAM_ID=pretend-team",
      "LICHESS_TEAM_PASSWORD=pretend-team-password",
      "ORGANISER_CONTACT_EMAIL=organiser@pretend.invalid",
      "# The fake Lichess, `pnpm fake-lichess`.",
      `LICHESS_URL=http://127.0.0.1:${await freePort(8089)}`,
      "NEXT_TELEMETRY_DISABLED=1",
      "",
    ].join("\n");
  writeFileSync(envFile, env, { mode: 0o600 });
  process.stdout.write(env);
  const site = new URL(env.match(/^BETTER_AUTH_URL=(.*)$/m)[1]);
  say(`Postgres is running in ${dir} at ${url}.`);
  say(`With that block in .env.local: pnpm dev --port ${site.port}, pnpm seed, pnpm seed:cookies, pnpm fake-lichess.`);
}

function stop(dir, envFile) {
  // The dev server and the fake Lichess this checkout runs on the block's ports: only a process whose working
  // directory is this checkout is stopped, so the owner's own server, or another checkout's, is never touched.
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  for (const [, port] of env.matchAll(/^(?:BETTER_AUTH_URL|LICHESS_URL)=.*:(\d+)$/gm)) {
    const listening = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]).stdout?.toString() ?? "";
    for (const pid of listening.split("\n").filter(Boolean)) {
      const cwd = spawnSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]).stdout?.toString().match(/^n(.*)$/m)?.[1];
      if (cwd !== root) continue;
      process.kill(Number(pid));
      say(`Stopped process ${pid} on port ${port}.`);
    }
  }
  if (spawnSync(bin("pg_ctl"), ["-D", dir, "status"], { stdio: "ignore" }).status !== 0) return say(`No Postgres is running in ${dir}.`);
  run("pg_ctl", ["-D", dir, "-m", "fast", "-w", "stop"]);
}

// Run, not imported (the seed imports notLocal).
if (import.meta.main) {
  const dir = resolve(option("--dir") ?? `${root}/.local-db`);
  const envFile = `${dir}/offboard.env`;
  const command = { start, stop }[process.argv[2]];
  if (!command) say("Usage: node scripts/local-db.mjs start|stop [--dir <dir>] [--port <port>] [--site-port <port>]");
  Promise.resolve(command && command(dir, envFile)).then(
    () => process.exit(command ? 0 : 1),
    (error) => {
      say(error.message);
      process.exit(1);
    },
  );
}
