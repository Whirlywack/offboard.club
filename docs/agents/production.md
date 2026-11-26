# Production

What the live site runs on, and how to read what it did. Checked on 26 November 2026; plans and settings change, so read a fact again at its source before a conclusion rests on it.

## Read the record, then name a cause

Before naming the cause of a fault on the live site, read the provider's own record of it. Twice a cause named from reasoning alone was wrong once the record was read. The report says which records were read and what they showed, and calls everything else likely.

The records, none of which changes anything in production:

- `scripts/after-merge.sh <PR>`: what a merge did, the deploy and its migrations included. `scripts/pr-ci.sh <PR or branch>`: CI. Each header has the usage.
- The Vercel MCP's runtime logs and runtime errors for the project, one day back. Filter by request id to see how far into a request an error came.
- The Neon MCP's list of operations, for when the compute started and suspended. Ask for a small number: the list is long and has no time filter.
- `vercel blob list --prefix backups/`, for which dumps exist.

## Who may do what

An agent given a ticket works against local throwaway databases and the fakes (`docs/agents/dev-environment.md`). The live site, the live database, the real Telegram bot and group, the Blob store and the `vercel` CLI are for the orchestrating session, which reads the records above. A change to Vercel, GitHub settings, DNS, Neon or Telegram waits for the owner's word, each time: an earlier yes covers only the change it was given for.

## Vercel

The site is https://offboard.club, the only public address: every `*.vercel.app` address is behind Vercel's sign-in. Team `ketflows-projects`, project `offboard`, Pro plan. Functions run in `fra1` on Fluid Compute, Node 26.x.

- Production is built from `main` alone, and its build migrates the live database before `next build` (the `build` script). A changed setting takes effect only at the next production deploy.
- Runtime logs keep a day of what the code wrote to the console. A job that succeeded writes nothing, so a missing line is no sign that it ran. A scheduled job's own record is its `scheduledJob` row, which the Organiser page shows.
- Fluid Compute suspends an idle instance and resumes it later with its timers still counting, so a timeout set before the pause can fire as the instance wakes. Ticket #55 met it connecting to the database: read the comment in `lib/db.ts`.

## Settings on Production

- **Secret**: nobody can read one back once it is set, and only the feature that uses it shows whether it is right. `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, `LICHESS_TEAM_PASSWORD`, `LICHESS_TOKEN_KEY`, `LINKEDIN_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_INVITE_LINK`.
- **Readable by the owner**: `BETTER_AUTH_URL`, `BLOB_READ_WRITE_TOKEN`, `LICHESS_TEAM_ID`, `LINKEDIN_CLIENT_ID`, `ORGANISER_CONTACT_EMAIL`, `ORGANISER_USER_ID`, `TELEGRAM_GROUP_ID`, `TELEGRAM_ORGANISER_CHAT_ID`.
- Preview has no `DATABASE_URL`.
- `LICHESS_TOKEN_KEY` stays the same while the Organiser's Lichess permission is stored, which is sealed under it: a new key leaves the stored permission unreadable until the Organiser connects Lichess again.

## Neon

Free plan, region `aws-eu-central-1`, Postgres 18. The compute suspends after five minutes idle and usually wakes in a few hundred milliseconds. Neon keeps six hours of history to restore from. The default branch is the live database, whose address exists only on Vercel; the `development` branch is in `docs/agents/dev-environment.md`. The live database sorts text by code point (the builtin `C.UTF-8`) and keeps time in UTC.

## Backups and Telegram

Backups go nightly to the private Vercel Blob store `offboard-backups` in `fra1`, connected to Production alone. `docs/restore.md` has the rest.

The bot is `OffboardClubBot`. The group is a basic group. Turned into a supergroup it would get a new id: `TELEGRAM_GROUP_ID` is then replaced and production redeployed.
