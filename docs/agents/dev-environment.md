# Development environment

What `package.json` and the config files do not tell you. Script names and their flags are in `package.json`; this page is the rest.

## Three databases

- **Live** (Neon, the default branch). Its address exists only in Vercel. It is migrated by the production deploy of `main`: `pnpm build` runs `scripts/migrate.mjs --on-deploy`, which applies pending migrations when Vercel builds production from `main`, stops a production build of any other branch, and does nothing in a preview build or on a laptop. Nothing else writes its schema. Preview deploys have no database.
- **Development** (Neon, the `development` branch): a copy of live, real accounts included. It is what `.env.local` in the main checkout points at, for the owner's own browser. Agents leave it alone.
- **Local**: a throwaway Postgres on localhost, migrated and seeded with one invented Club. Every agent and every test uses one of these.

## A local environment with nothing real in it

In a fresh worktree, in this order:

1. `pnpm db:start`: a throwaway Postgres on 127.0.0.1, migrated, and a `.env.local` in which every value is pretend, created only when the worktree has none. It names the ports it chose, and refuses to run in a checkout whose `.env.local` holds real settings.
2. The real-Postgres suites, if you need them, now: `ALLOW_DB_TESTS=1 pnpm test` with that file's `DATABASE_URL` in the environment. They expect empty tables, so they come before the seed; later, a second `pnpm db:start --dir <another folder>` gives another empty database.
3. `pnpm seed`: one invented Club. `club` is the default and the fullest; `season-over` and `empty` hold the states it cannot. It lists who is in it and checks each state it promises.
4. `pnpm dev --port <the site port it named>`. Next.js does not take its port from `.env.local`.
5. `pnpm fake-lichess` beside it, for the Connect Lichess step. Restart it after seeding again.
6. `pnpm seed:cookies` prints a Playwright cookie for each seeded person, to sign in without LinkedIn: `context.addCookies([cookies.ana])`.
7. `pnpm db:stop` when you are done. It stops only what this checkout started.

Each script's header has the options. Each refuses a `DATABASE_URL` that is not on this machine.

The local site still reaches the real internet in three places. "Sign in with LinkedIn" sends the browser to linkedin.com: use a seeded cookie. Saving a new Company website makes the server fetch that website: use the seeded Companies. An Award's Replay loads a board from lichess.org.

## The owner's running site

`localhost:3000` is served from the main checkout, on `main`, with the owner's real settings in its `.env.local`. Builds, typechecks, merges and branch switches happen in a worktree, on another port: a merge, a build and a typecheck run in the folder the dev server was serving once left the owner's browser reloading in a loop.

A worktree starts with no `.env.local`, and the local environment above makes one. A copy of the main checkout's file would hand an agent real keys.

## Tests

- `pnpm test` runs everything except the `*.postgres.test.ts` suites. Those run when `ALLOW_DB_TESTS=1` and `DATABASE_URL` are both set, each inside a transaction that is rolled back.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, every migration on an empty Postgres 18 and all the tests on each pull request. A pull request merges when its `checks` job is green.
- **`lib/fake-db.ts`** stands in for the database in the other tests. It knows each statement the app sends by its full text and throws on any other, so a query you add or change is written out there too, with the keys and constraints the migration gives it.
- **`lib/fixtures/fake-lichess.ts`** stands in for Lichess, behaving as lichess.org does where that differs from its published spec. `LICHESS_URL` points the site at it; it is ignored in production, and ingesting a Matchday refuses to run while it is set.
- A test value is plainly pretend (`"a-pretend-lichess-token"`). ESLint refuses a string shaped like a real Lichess or Telegram token, because GitHub refuses the push that carries one.

## Migrations

One file per change, `migrations/NNN_name.sql`, applied in name order and recorded by file name, so an edit to one that has run is never applied: CI refuses a pull request that edits a merged migration. When tickets run in parallel the orchestrating session gives each its number. What a migration may contain is in `CODING_STANDARDS.md`.

## Next.js 16 traps met so far

- **A page cannot answer 404 once it has started.** With Cache Components and Partial Prerender a dynamic route has sent its shell, and a 200, before the page reads its params or any data; `notFound()` then shows the not-found page, marked noindex, under that 200. An address that cannot exist by its shape alone is refused in `proxy.ts` with a real 404, by a check of its own in `proxy()` plus a `matcher` entry; a route that needs data to know stays out of the matcher.
- **`pnpm typecheck` generates route types first** (`next typegen`), which is what makes `PageProps<"/recaps/[date]">` exist. A bare `tsc` fails on a fresh checkout.
- **Proxy is the old Middleware**, renamed, and is for checks that need no data.

## Who is a Member

`lib/members.ts` holds the one condition (`MEMBER_SQL`) and the one sign-up time (`MEMBER_SINCE`). Every query that counts, lists or shows Members uses them. Anyone who has signed in but not finished is part-way through signing up and appears nowhere.
