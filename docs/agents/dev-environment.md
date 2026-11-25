# Development environment

What `package.json` and the config files do not tell you. Script names and their flags are in `package.json`; this page is the rest.

## Three databases

- **Live** (Neon, the default branch). Its address exists only in Vercel. It is migrated by the production deploy of `main`: `pnpm build` runs `scripts/migrate.mjs --on-deploy`, which applies pending migrations when Vercel builds production from `main`, stops a production build of any other branch, and does nothing in a preview build or on a laptop. Nothing else writes its schema. Preview deploys have no database.
- **Development** (Neon, the `development` branch): a copy of live, real accounts included. It is what `.env.local` in the main checkout points at, for the owner's own browser. Agents leave it alone.
- **Local**: a throwaway Postgres on localhost, migrated and seeded with one invented Club. Every agent and every test uses one of these.

## A local environment with nothing real in it

In a fresh worktree, in this order:

1. `pnpm db:start`: a throwaway Postgres on 127.0.0.1, migrated, and a `.env.local` in which every value is pretend, created only when the worktree has none. Ports come as a set (Postgres 55432, site 3100, fake Lichess 8089, fake Telegram 8189, each plus the same n), so two worktrees never share one; when a folder's set has been taken since, or is taken by another `db:start` between its choice and its start, it moves to a free one and rewrites its block, and `.env.local` if that is the block. It runs a Postgres of CI's major version (the image in `ci.yml`) when one is on PATH, in Homebrew's folders (`/opt/homebrew/opt/postgresql@18/bin`) or in `/usr/lib/postgresql`, and says which; otherwise the newest it finds, 15 or later, and says that it is not CI's. Its database keeps time in UTC, as CI's does, and sorts text by ICU's `en-US` with punctuation and spaces weighed last, the nearest this machine has to CI's glibc `en_US.utf8`: `scripts/local-db.postgres.test.ts` holds what sorts the same on both, and other text may not. A folder made by another major version, or made to sort or keep time otherwise, is made again, empty. It refuses to start in a checkout whose `.env.local` holds real settings.
2. The real-Postgres suites, if you need them, now: `ALLOW_DB_TESTS=1 DATABASE_URL=<the address it printed> pnpm test`. They expect empty tables, so they come before the seed. Once the first database is seeded, `pnpm db:start --dir .local-db-tests` starts a second, empty one.
3. `pnpm dev:local`, `pnpm fake-lichess` and `pnpm fake-telegram`, each as a background task of your own: the site and the two fakes, all on 127.0.0.1 only, on the ports `db:start` named. The fake Telegram prints each message the bot posts. You stop them when you are done.
4. `pnpm seed`: one invented Club. `club` is the default and the fullest; `season-over` and `empty` hold the states it cannot. It lists who is in it and checks each state it promises through the site's own code.
5. `pnpm seed:cookies` writes `.local-db/cookies.json`, a Playwright cookie for each seeded person, to sign in without LinkedIn: `context.addCookies([cookies.ana])`. The Organiser is `org`.
6. `pnpm collect-results` runs the job that collects a Matchday's results once, against the fake Lichess, as Vercel's scheduled request would in production; the site's own endpoint refuses while it follows a fake Lichess. `pnpm seed season-over` leaves a finished Matchday on the fake Lichess for it to collect, and collecting it posts its Recap to the fake Telegram. `pnpm post-to-telegram <time>` runs the job that posts to the Telegram group as of that time; `pnpm seed` prints the two that post the next Matchday's reminders.
7. `pnpm db:stop` stops that Postgres and nothing else. `pnpm local:stop --dir .` stops everything you started in this worktree: each Postgres, the site and the fakes.

Each script's header has the options. Each refuses a database that is not on this machine, and the seed, `pnpm collect-results` and `pnpm post-to-telegram` refuse one `db:start` did not make.

`pnpm local:list` lists each Postgres, site and fake these tools started, from any worktree of this repository, that is still running: what it is, its port, its age and its folder, marked when the folder is gone. `pnpm local:stop --dir <worktree>` stops those started from that worktree alone, not from the worktrees inside it, so run from the main checkout it stops nothing of the agents'. `pnpm local:stop --all` stops every one of them: the orchestrating session runs it, or the owner, and only when no agent is working. `pnpm local:stop` alone stops nothing. Both know only what `db:start`, `dev:local` and the fakes recorded in the repository's git folder (`.git/offboard-local/`; so these start nothing outside a git checkout, and a copy given a `git init` is one), each checked against its process's start time and command line, so neither can touch a Postgres `db:start` did not start, the owner's site, or another project's process. The fake Blob has no process of its own: it runs inside the tests that use it.

The local site can still reach the real internet when something is clicked. "Sign in with LinkedIn" sends the browser to linkedin.com: use a seeded cookie. A seeded Profile's LinkedIn and Lichess links, and an Award's Replay, lead to the real sites, where the pretend names do not exist. Saving a new Company website makes the server fetch that website: use the seeded Companies.

## Checking pages in a browser

- **The Playwright browser is shared** with every other agent on the machine. Open your own browser context, and close it when you finish.
- **After a link click Next.js keeps the previous page in the DOM, hidden.** Select `main:visible`, not `main`.
- **Leaderboard tables arrive after the page.** Wait for the table before reading it.
- **Sign in with a seeded cookie**, read from `.local-db/cookies.json` in your shell and passed into the page: Playwright's code runner cannot read files.
- **The scratchpad is shared too.** Start every scratch file's name with the ticket, `t<n>-`.
- **A worktree's shell refuses long multi-line commands.** Put the lines in a helper script in the scratchpad and run that.

## The owner's running site

`localhost:3000` is served from the main checkout, on `main`, with the owner's real settings in its `.env.local`. Builds, typechecks, merges and branch switches happen in a worktree, on another port: a merge, a build and a typecheck run in the folder the dev server was serving once left the owner's browser reloading in a loop.

A worktree starts with no `.env.local`, and the local environment above makes one. A copy of the main checkout's file would hand an agent real keys.

## Tests

- `pnpm test` runs everything except the `*.postgres.test.ts` suites. Those run when `ALLOW_DB_TESTS=1` and `DATABASE_URL` are both set, each inside a transaction that is rolled back. A plain `pnpm test` still starts Postgres servers of its own: `scripts/local-db.test.ts` runs `db:start` in temporary git repositories, stops what it started and removes the folders it made, failed or not. So the machine needs git, a Postgres 15 or later where `db:start` looks, and free ports from 55432 and 3100.
- **Node.js is CI's without setting anything up.** pnpm runs every script and test on the Node.js of `package.json`'s `devEngines.runtime` (26), which `pnpm install` puts in `node_modules`; CI's setup-node reads the same field, and the Vercel project runs 26.x. npm and npx refuse to run here on another major version (EBADDEVENGINES). Only `node` itself, or a tool's own bin such as `node_modules/.bin/vitest`, runs on the shell's Node.js (nvm's default here is 24), and the tests and the local tools then say in one line that it is not CI's.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, every migration on an empty Postgres 18 and all the tests on each pull request, and on each push to a `ticket-*` branch that has no pull request open yet (`ticket-push.yml`, reported as `ci / checks`). A pull request merges when its own `checks` job is green.
- **`lib/fake-db.ts`** stands in for the database in the other tests. It knows each statement the app sends by its full text and throws on any other, so a query you add or change is written out there too, with the keys and constraints the migration gives it.
- **`lib/fixtures/fake-lichess.ts`** stands in for Lichess, behaving as lichess.org does where that differs from its published spec. `LICHESS_URL` points the site at it; it is ignored in production, and `pnpm ingest` and the endpoint that collects results refuse to run while it is set (`pnpm collect-results` is the local way in).
- **`lib/fixtures/fake-blob.ts`** stands in for the Vercel Blob store the nightly backup writes to and deletes old dumps from, served on a local port that `VERCEL_BLOB_API_URL` points `@vercel/blob` at. No local block has `BLOB_READ_WRITE_TOKEN`, so nothing local backs up, and the seed refuses to run while it is set. `lib/backup.postgres.test.ts` makes databases of its own on the server in `DATABASE_URL`, and drops them.
- **`lib/fixtures/fake-telegram.ts`** stands in for Telegram's Bot API. `TELEGRAM_URL` points the site at it; it is ignored in production. Without the Telegram settings the bot posts nothing, so a `.env.local` made before them has Telegram off.
- A test value is plainly pretend (`"a-pretend-lichess-token"`). ESLint refuses a string shaped like a real Lichess or Telegram token, because GitHub refuses the push that carries one.

## Migrations

One file per change, `migrations/NNN_name.sql`, applied in name order and recorded by file name, so an edit to one that has run is never applied: CI refuses a pull request that edits a merged migration. When tickets run in parallel the orchestrating session gives each its number. What a migration may contain is in `CODING_STANDARDS.md`.

## Next.js 16 traps met so far

- **A page cannot answer 404 once it has started.** With Cache Components and Partial Prerender a dynamic route has sent its shell, and a 200, before the page reads its params or any data; `notFound()` then shows the not-found page, marked noindex, under that 200. An address that cannot exist by its shape alone is refused in `proxy.ts` with a real 404, by a check of its own in `proxy()` plus a `matcher` entry; a route that needs data to know stays out of the matcher.
- **`pnpm typecheck` generates route types first** (`next typegen`), which is what makes `PageProps<"/recaps/[date]">` exist. A bare `tsc` fails on a fresh checkout.
- **Proxy is the old Middleware**, renamed, and is for checks that need no data.

## Who is a Member

`lib/members.ts` holds the one condition (`MEMBER_SQL`) and the one sign-up time (`MEMBER_SINCE`). Every query that counts, lists or shows Members uses them. Anyone who has signed in but not finished is part-way through signing up and appears nowhere.
