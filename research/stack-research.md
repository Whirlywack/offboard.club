# Stack and hosting research for Offboard

Researched 2026-11-24. Every factual claim links to the vendor or project page it was read from on that date. Limits and prices change often; re-check before committing. Items I could not confirm on a primary page are in [Could not verify](#could-not-verify).

## Recommendation

**Next.js on Vercel Hobby + Neon Postgres (Frankfurt), with Vercel Workflows (not Cron Jobs) driving the post-Matchday job, and Better Auth for sign-in.** This is the candidate, with three changes the evidence forces:

1. **Vercel Cron Jobs alone cannot do the post-Matchday job on Hobby.** Hobby cron is limited to once per day and fires anywhere in a 59-minute window ([cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)). The job has to be driven by a Vercel Workflow that sleeps until the tournament should be over and then polls, or by the new Vercel Schedules product. Both are on Hobby (details below).
2. **Auth.js and Arctic are no longer good choices.** Auth.js is in security-patch maintenance under the Better Auth team, and Arctic was deprecated in July 2026. Better Auth covers both flows.
3. **Hobby is only for "personal or non-commercial use".** A free club fits today. A sponsor makes that doubtful, and the first paid step is $20/month.

The two facts that decide it:

- **Durable sleep and sub-daily scheduling are now free on Vercel.** Workflows is on Hobby with 50,000 events/month and no limit on `sleep` duration ([workflow pricing](https://vercel.com/docs/workflows/pricing)). Schedules (public beta since 2026-11-05) gives Hobby 15-minute cron, IANA timezones and one-time runs ([schedules limits](https://vercel.com/docs/schedules/limits), [changelog](https://vercel.com/changelog/vercel-schedules-is-now-in-public-beta)). Hobby functions run up to 300 s ([function limits](https://vercel.com/docs/functions/limitations)), enough for a dozen serial Lichess requests including one 60 s back-off.
- **It is the only option that is both $0 and plain Next.js.** Cloudflare's free plan caps CPU at 10 ms per invocation ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), which Cloudflare itself says server-side rendering and payload parsing typically exceed, so Cloudflare realistically costs $5/month. The VPS and container options all cost money, and Supabase free adds pausing and has no backups.

### Runner-up: Cloudflare Workers + D1 on the $5/month Workers Paid plan

It is close. Cloudflare is better on scheduling (cron every minute, 15-minute wall time, Workflows, Queues, Durable Object alarms), on backups (D1 point-in-time restore, 7 days free / 30 days paid), on EU data location (D1 `eu` jurisdiction), and its terms have no non-commercial clause. It loses on two points: it is not free in practice for this workload, and Next.js runs there through an adapter rather than natively, which is extra moving parts for a solo maintainer who knows Next.js on Vercel.

### What would flip the choice

- **A sponsor, or any doubt about "non-commercial".** Vercel Pro is $20/month; Cloudflare Workers Paid is $5/month. If the club takes a sponsor, Cloudflare becomes the cheaper compliant option. Ask Vercel support in writing before adding a sponsor logo if staying.
- **Vercel changing Hobby limits on Workflows or Schedules.** Schedules is 19 days into public beta and its limits page says they "may change before general availability". If free sub-daily scheduling goes away, Cloudflare wins.
- **Wanting to leave Next.js anyway.** With a lighter framework (Hono, Astro, React Router) the Cloudflare adapter cost disappears.

Keep the move cheap: use standard Postgres through an ORM, and write the job logic as plain functions with a thin trigger layer, so only the trigger and the database driver change if the host does.

## Comparison table

| Criterion | 1. Vercel Hobby + Neon Free | 2. Cloudflare Workers + D1 | 3. Hetzner VPS | 4. Supabase Free + frontend host | 5. Fly.io / Railway |
|---|---|---|---|---|---|
| Monthly cost at this scale | $0 | $0 on paper; $5 realistically (10 ms CPU cap on free) | From EUR 5.49 excl. VAT, plus about 20% for backups | $0 for Supabase; frontend host as per column 1 or 2 | Fly: about $2-6 usage, no free tier. Railway: $1 free credit, or $5 Hobby |
| First paid step | Vercel Pro $20/month; Neon Launch usage-based, no minimum | Workers Paid $5/month | n/a | Supabase Pro from $25/month | Railway Hobby $5/month |
| Non-commercial restriction on free tier | Yes: "personal or non-commercial use" (Vercel ToS s.4). Neon: none found | None found. Free services may not process credit cards | None | None found in terms; see unverified list | None found |
| Scheduled jobs, free tier | Cron Jobs: once/day, +/-59 min, UTC. Schedules (beta): every 15 min, 15-min jitter, any IANA timezone, one-time runs. Workflows: `sleep` with no limit | 5 Cron Triggers per account, down to every minute, UTC only | system cron or systemd timers, any timezone, exact | pg_cron down to every second; UTC timezone unverified | Railway cron: at least 5 min apart, UTC. Fly: bring your own |
| One-off delayed job | Workflow `sleep`; dynamic one-time Schedule; Queues delay up to 7 days (beta) | Workflows `step.sleep` up to 365 days; Queues delay up to 24 h; DO alarms; all on free | `at`, systemd timers, or an in-process scheduler | pg_cron job that unschedules itself | In-process scheduler |
| Max duration for the job | 300 s per function or workflow step | 15 min wall per cron/queue/alarm; unlimited wall per Workflow step; CPU 10 ms free / up to 5 min paid | Unlimited | Edge Functions: 150 s wall, 2 s CPU on free | Unlimited |
| EU compute | Yes: one region on Hobby, selectable (e.g. `fra1`) | Runs at the edge; not pinned to EU (see unverified) | Yes: Falkenstein, Nuremberg, Helsinki | Yes: Frankfurt, Stockholm, Paris, Ireland | Fly: ams, arn, cdg, fra. Railway: Amsterdam |
| EU database | Neon Frankfurt (`aws-eu-central-1`) | D1 `eu` jurisdiction | Same box | Same EU region as the project | Same host or external |
| DB free limits | 1 GB/project, 100 CU-hours/month | 500 MB per database, 5 GB account; 5M rows read and 100k written per day | Disk size | 500 MB per project, 2 active projects | n/a |
| Idle behaviour | Compute suspends after 5 min idle; resumes in "a few hundred milliseconds"; never paused for inactivity | No cold database | Always on | **Project paused after 7 days of low activity**; manual resume | Depends on config |
| Backups on free | 6 h restore window, 1 manual snapshot. Needs own `pg_dump` | Time Travel point-in-time restore, 7 days | Hetzner backups about 20% extra, or own dumps | None; own `db dump` recommended by Supabase | Own |
| Auth library fit | Better Auth: LinkedIn built in; Lichess via Generic OAuth with `tokenEndpointAuth: none` + PKCE | Same libraries; run on Workers | Same | Supabase Auth: LinkedIn OIDC built in; Lichess as custom OAuth2 provider is doubtful, and provider tokens are not stored | Same as 1 |
| Ops burden | Lowest: git push deploys, managed TLS, nothing to patch | Low: same, plus adapter and bundle-size limits to watch | Highest: OS patching, TLS, backups, monitoring, deploys | Low for DB; two vendors to run | Medium: Dockerfile, volumes, own backups |

## Per-option notes

### 1. Next.js on Vercel + Neon Postgres

**Commercial use.** The current Terms of Service (last updated 2026-10-19), section 4: "You shall only use the Services under a Hobby plan for your personal or non-commercial use." It also says Vercel "may shut down and terminate projects or deployments using the Hobby plan without notice". Source: https://vercel.com/legal/terms

- The terms do not define "commercial". The Fair Use Guidelines page (last updated 2026-11-12) no longer has a "Commercial usage" section; it now lists only fair-use examples and usage ranges. Source: https://vercel.com/docs/limits/fair-use-guidelines
- The Hobby plan docs page (last updated 2026-11-12) no longer mentions the restriction either. Source: https://vercel.com/docs/plans/hobby
- The earlier definition, quoted by Vercel staff on Vercel's own forum on 2025-09-25, was: "Commercial usage is defined as any Deployment that is used for the purpose of financial gain of anyone involved in any part of the production of the project, including a paid employee or consultant writing the code." The same thread shows Vercel's then-current text "Asking for donations does not fall under commercial usage". Source: https://community.vercel.com/t/question-about-commercial-usage/23321
- Reading for Offboard: a free club with no payments, ads or paid builder is non-commercial under either wording. Sponsorship was never listed either way. The old examples included "Advertising the sale of a product or service", which a sponsor logo could be read as. Treat a sponsor as the trigger to get a written answer or move to Pro.

**Hobby included usage.** 1,000,000 function invocations, 4 CPU-hours active CPU, 360 GB-hours provisioned memory, 100 GB fast data transfer, 1,000,000 CDN requests, 50,000 Workflow events and 1 GB Workflow data written per month. Exceeding a limit usually pauses the feature for 30 days; extra usage cannot be bought on Hobby. Sources: https://vercel.com/docs/plans/hobby and https://vercel.com/pricing

**Cron Jobs (legacy).** 100 per project on every plan. Hobby: minimum interval once per day; an expression that runs more often fails the deployment. Precision on Hobby is per-hour: "a cron job configured as `0 1 * * *` ... will trigger anywhere between 1:00 am and 1:59 am". Timezone is always UTC. Named days (`SUN`) are not supported. Sources: https://vercel.com/docs/cron-jobs/usage-and-pricing , https://vercel.com/docs/cron-jobs/manage-cron-jobs , https://vercel.com/docs/cron-jobs

**Schedules (public beta, announced 2026-11-05).** "Schedules replace Cron Jobs. They add timezones, private targets, one-time runs, execution history". Available in beta on all plans. Sources: https://vercel.com/docs/schedules , https://vercel.com/changelog/vercel-schedules-is-now-in-public-beta

- Hobby limits: most frequent cron is every 15 minutes; jitter window is always 15 minutes (a run starts at some point within 15 minutes after its scheduled time); up to 100 static schedules per deployment; 500 dynamic schedule creations and 5,000 runs per billing period; over the limit, scheduled runs are skipped until the next period. "Schedules are in beta, and these limits may change before general availability." Source: https://vercel.com/docs/schedules/limits
- Timezone: each schedule takes an IANA timezone and follows daylight saving time. So `0 20 * * 0` with `"timezone": "Europe/Vilnius"` stays at 20:00 local all year. Sources: https://vercel.com/docs/schedules/concepts , https://vercel.com/docs/schedules/configuration
- One-time runs: dynamic schedules only (SDK or CLI), given as a local date-time in the schedule's timezone; they target a Vercel Queues topic only, and Queues is itself in beta. One-time runs never expire if delivery is late. Sources: https://vercel.com/docs/schedules/concepts , https://vercel.com/docs/queues
- Failure handling: function and path targets are not retried; queue targets are. Duplicate deliveries are possible, so handlers must be idempotent. Source: https://vercel.com/docs/schedules/concepts

**Workflows.** Durable functions with steps, retries and `sleep`. Hobby includes 50,000 events/month and 1 GB data written. Maximum run duration and maximum `sleep` duration: "No limit". A sleeping run uses no compute. Each step runs inside a function invocation and must finish within the function duration limit. `sleep` can wait until a specific date. The pricing page lists Workflows without a beta label (Queues is labelled Beta). Sources: https://vercel.com/docs/workflows/pricing , https://vercel.com/docs/workflows/concepts , https://vercel.com/pricing

**Queues (beta, all plans).** Hobby includes 1,000,000 API operations. Delay before a message becomes visible: up to 7 days, capped at the message TTL. Source: https://vercel.com/docs/queues/pricing

**Function limits.** Hobby with Fluid compute (default for new projects): 300 s default and maximum duration, 2 GB / 1 vCPU. Source: https://vercel.com/docs/functions/limitations

**Regions.** Functions default to `iad1` (Washington, D.C.). The default can be changed in project settings or `vercel.json`. Hobby runs functions in a single region. EU regions include `fra1` (Frankfurt), `arn1` (Stockholm), `cdg1` (Paris), `dub1` (Dublin). Sources: https://vercel.com/docs/functions/configuring-functions/region , https://vercel.com/docs/regions

**Neon Free plan** (pricing page last updated 2026-11-04). Source: https://neon.com/pricing

- 100 projects; 1 GB Postgres storage per project (20 GB account total); 100 CU-hours of compute per project per month; 5 GB egress per project. Running out of CU-hours or egress suspends compute until the next billing period; exceeding storage blocks writes; no data is deleted.
- Scale to zero: always on for Free, after 5 minutes idle, cannot be disabled. Restart on the next query takes "a few hundred milliseconds". Source: https://neon.com/docs/introduction/scale-to-zero
- "Neon doesn't pause Free projects for inactivity, and there's no restore step."
- Backups: restore history is 6 hours (up to 1 GB of changes); 1 manual snapshot; scheduled snapshots are paid. A weekly `pg_dump` to somewhere else is needed. Source: https://neon.com/docs/introduction/plans
- Regions include Frankfurt (`aws-eu-central-1`) and London; the region is fixed at project creation. Source: https://neon.com/docs/introduction/regions
- Neon positions Free for "Prototypes, side projects, and small teams" and advises a paid plan "for production workloads where uninterrupted availability matters". That is advice about limits, not a use restriction. Source: https://neon.com/docs/get-started/production-checklist
- First paid step: Launch, pay per use with no monthly minimum, $0.106/CU-hour and $0.35/GB-month; invoices under $0.50 are not collected. Neon's own example of a small scale-to-zero database is $15/month.

**How the jobs would run on Hobby.**

- Create the Swiss tournament: a daily Cron Job (or a Schedule) calls a route that checks whether the coming Sunday's Matchday has a tournament yet and creates it if not. The +/-59 minute window does not matter here. Compute "Sunday 20:00 Europe/Vilnius" in code rather than in the cron expression, so DST is handled by the timezone database.
- Post-Matchday: start a Workflow when the tournament is created. It sleeps until the scheduled end, then loops: check tournament status as a step, sleep a few minutes if not finished, otherwise run fetch-results, fetch-games, compute-awards, save, publish and Telegram as separate retried steps. One request at a time is natural in a step sequence, and a 429 becomes a 60 s sleep.
- Fallback if Workflows is unsuitable: a static Schedule `*/15 20-23 * * 0` in `Europe/Vilnius`. With the 15-minute interval plus 15-minute jitter, worst-case detection is about 30 minutes after the tournament ends, typical about 15.

### 2. Cloudflare Workers + D1

**Free plan limits** (Workers Free). Source: https://developers.cloudflare.com/workers/platform/limits/

- 100,000 requests/day; **10 ms CPU time per HTTP request and per Cron Trigger**; 128 MB memory; 50 subrequests per invocation; Worker size 3 MiB compressed (10 MiB on paid); 5 Cron Triggers per account.
- Cloudflare's own note: "Heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms." That describes this app (SSR pages, OAuth, parsing about 125 games of ndjson), so the free plan is not a safe assumption.
- Wall-clock limits: 15 minutes for Cron Triggers, Queue consumers and Durable Object alarms; unlimited per Workflow step.

**Workers Paid.** Minimum $5/month per account; includes 10 million requests and 30 million CPU-ms per month; CPU up to 5 minutes per invocation (15 minutes for cron intervals of an hour or more); 1,000 Cron Triggers. Source: https://developers.cloudflare.com/workers/platform/pricing/

**Scheduling products, all available on the free plan:**

- Cron Triggers: run on UTC only; expressions down to every minute; day names such as `sun` are supported. Source: https://developers.cloudflare.com/workers/configuration/cron-triggers/ . DST needs either two UTC expressions or a check in code.
- Workflows: on Free and Paid. Free: 10 ms CPU per step, 3,000 steps/day, 1 GB storage, completed-instance state kept 3 days; `step.sleep` up to 365 days. Sources: https://developers.cloudflare.com/workflows/reference/pricing/ , https://developers.cloudflare.com/workflows/reference/limits/
- Queues: Free includes 10,000 operations/day, 24-hour retention; messages can be delayed up to 24 hours. Sources: https://developers.cloudflare.com/queues/platform/pricing/ , https://developers.cloudflare.com/queues/configuration/batching-retries/
- Durable Objects (SQLite-backed) and their alarms: on Free, 100,000 requests/day. Sources: https://developers.cloudflare.com/durable-objects/platform/pricing/ , https://developers.cloudflare.com/durable-objects/api/alarms/

**D1.** Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total, 10 databases, 500 MB per database, 50 queries per Worker invocation. Over the daily limit, queries fail until 00:00 UTC. Sources: https://developers.cloudflare.com/d1/platform/pricing/ , https://developers.cloudflare.com/d1/platform/limits/

- Backups: Time Travel is always on; restore to any minute in the last 7 days (Free) or 30 days (Paid). Source: https://developers.cloudflare.com/d1/reference/time-travel/
- EU residency: a database can be created with `--jurisdiction=eu` so it "only run[s] and store[s] data within" the EU; this can only be set at creation. Workers may still access it from anywhere. Source: https://developers.cloudflare.com/d1/configuration/data-location/
- D1 is SQLite, not Postgres, so the schema and driver differ from option 1.

**Next.js on Workers.** The OpenNext adapter supports Next.js 15 (latest minor) and 16 on the Node.js runtime; the 3 MiB free Worker size limit applies to the compressed bundle. Cloudflare's own Next.js guide now leads with "vinext" and describes OpenNext as the path for existing OpenNext apps. Sources: https://opennext.js.org/cloudflare , https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/ . `@opennextjs/cloudflare` latest is 1.20.18, published 2026-11-20 (npm registry).

**Terms.** The Self-Serve Subscription Agreement has no personal-use or non-commercial clause. Relevant restrictions: free services may not be used to "process or collect personal or business credit card information", and free services can be terminated "in our sole discretion". Source: https://www.cloudflare.com/terms/

### 3. One small VPS (Hetzner)

- Prices excl. VAT, including IPv4: CPX02 (1 vCPU, 1 GB, 20 GB) EUR 5.49/month; CX23 (2 vCPU, 4 GB, 40 GB) EUR 5.99/month; CAX11 (2 Arm vCPU, 4 GB) EUR 6.49/month. On the day checked, the cost-optimised types (CX23, CAX11) were marked "not available". Sources: https://www.hetzner.com/cloud/regular-performance/ , https://www.hetzner.com/cloud/cost-optimized/
- EU locations: Falkenstein, Nuremberg, Helsinki. 20 TB traffic included. Source: https://www.hetzner.com/cloud/
- Backups add-on starts at EUR 1.098/month for the smallest server (about 20% of its price). Source: https://www.hetzner.com/cloud/cost-optimized/
- Scheduling is the best of any option: system cron or systemd timers in `Europe/Vilnius`, exact to the second, no duration limit, and a long-running process can simply wait for the tournament to end.
- Burden falls entirely on the organiser: OS and runtime security updates, TLS renewal (automatic with Caddy or similar, but still yours), firewall, database backups and restore tests, deploy pipeline, uptime monitoring. A single box is a single point of failure, and it holds encrypted Lichess tokens and personal data, so patching is not optional.
- Not zero cost: about EUR 80/year with backups and VAT.

### 4. Supabase

- Free plan: 500 MB database per project, 2 active projects, 50,000 monthly active users, 5 GB egress, 500,000 Edge Function invocations. Source: https://supabase.com/pricing
- **Pausing (current policy):** "Supabase pauses Free Plan projects that show low activity over a 7-day period". "Typically a few user requests to the database each day over the previous week is enough to keep the project from being paused." A paused project is restored manually from the dashboard, within 1 year. A club with one busy evening a week is exposed to this. Source: https://supabase.com/docs/guides/platform/project-pausing
- Backups: none on Free ("Automatic backups: Not included"); Supabase recommends free projects export with `supabase db dump`. Sources: https://supabase.com/pricing , https://supabase.com/docs/guides/platform/backups
- EU regions: Frankfurt, Ireland, Paris, Stockholm (plus London and Zurich, which are not EU). Source: https://supabase.com/docs/guides/platform/regions
- Scheduling: Supabase Cron is pg_cron; jobs "can run anywhere from every second to once a year", can run SQL or make an HTTP request to an Edge Function; advice is no more than 8 concurrent jobs and under 10 minutes each. Source: https://supabase.com/docs/guides/cron
- Edge Functions: 150 s wall clock on Free (400 s paid), **2 s CPU**, 256 MB. Source: https://supabase.com/docs/guides/functions/limits
- Auth: LinkedIn (OIDC) is a built-in provider. Custom OAuth2/OIDC providers exist (3 on Free) with PKCE on by default, but the documented configuration takes a client ID **and client secret**; a secretless public client such as Lichess is not documented. Also: "Provider tokens are intentionally not stored in your project's database", so the Lichess token would have to be captured in the callback and stored by the app anyway. Sources: https://supabase.com/docs/guides/auth/social-login/auth-linkedin , https://supabase.com/docs/guides/auth/custom-oauth-providers , https://supabase.com/docs/guides/auth/social-login
- First paid step: Pro from $25/month (no pausing, daily backups kept 7 days).
- Net: it still needs a frontend host, so it inherits option 1's or 2's constraints, and adds pausing, no backups, and an auth layer that does not fit the Lichess flow. Its real advantage (pg_cron at any frequency) is no longer unique now that Vercel has Workflows and Schedules on Hobby.

### 5. Fly.io / Railway

- Fly.io: usage-based, no free tier; the free trial is 2 VM-hours or 7 days, then a card is required. A shared-cpu-1x 256 MB machine is about $2/month and 1 GB about $6/month (varies by region). EU regions include Amsterdam, Frankfurt, Paris, Stockholm. Sources: https://fly.io/docs/about/pricing/ , https://fly.io/docs/about/free-trial/ , https://fly.io/docs/reference/regions/
- Railway: a Free plan with $1 of credit per month (0.5 GB RAM, 1 vCPU, 0.5 GB volume); Hobby is $5/month including $5 of usage. Cron jobs must be at least 5 minutes apart and run in UTC. EU region: Amsterdam. Sources: https://docs.railway.com/reference/pricing/plans , https://docs.railway.com/reference/cron-jobs , https://docs.railway.com/reference/deployment-regions
- Both give a long-running process with no duration limit, so scheduling can be done in-process. Neither is free at this scale, and both leave database backups to the organiser. They sit between the VPS (more control, more work) and Vercel (less of both) without beating either on the criteria here.

### Auth libraries

- **Better Auth** (v1.7.28 published 2026-11-24; releases at https://github.com/better-auth/better-auth/releases). Actively maintained.
  - LinkedIn is a built-in social provider using Sign In with LinkedIn (OpenID Connect). Source: https://www.better-auth.com/docs/authentication/linkedin
  - Generic OAuth plugin: `clientSecret` is optional; PKCE defaults to on; `tokenEndpointAuth: { method: "none" }` is documented "for public clients", and "If omitted, Better Auth sends ... public-client token requests when [clientSecret] is not [configured]". That matches Lichess. Source: https://www.better-auth.com/docs/plugins/generic-oauth (text checked in the docs source at https://github.com/better-auth/better-auth/blob/canary/docs/content/docs/plugins/generic-oauth.mdx)
  - Linking a second provider to a signed-in user is supported (`linkSocial`); for a provider that returns no email, `account.accountLinking.allowDifferentEmails` must be enabled. Lichess returns no email without the `email:read` scope, so this setting is needed. Source: https://www.better-auth.com/docs/concepts/users-accounts
  - Tokens are stored in the account table **unencrypted by default**; encryption is done in `databaseHooks`. Refresh is not relevant (Lichess issues none). Source: https://www.better-auth.com/docs/concepts/users-accounts
  - Account deletion: `user.deleteUser` exists, disabled by default. Source: same page.
  - Neon also offers "Managed Better Auth" on the Free plan (up to 60k MAU per project). Source: https://neon.com/pricing . Not evaluated for the Lichess flow.
- **Auth.js / NextAuth.** Has a LinkedIn provider ([docs](https://authjs.dev/getting-started/providers/linkedin)) and custom OAuth/OIDC providers ([docs](https://authjs.dev/guides/configuring-oauth-providers)). Status: "Auth.js is now part of Better Auth. We recommend new projects to start with Better Auth"; existing users get "security patches and urgent issues". Latest stable on npm is still next-auth 4.24.15 (2026-07-20), with v5 at 5.0.0-beta.32. Sources: https://github.com/nextauthjs/next-auth , https://better-auth.com/blog/authjs-joins-better-auth . Not recommended for a new project.
- **Arctic.** Had ready-made LinkedIn and Lichess clients, but "Arctic was deprecated in July 2026"; the npm package is marked "Package no longer supported". Sources: https://arcticjs.dev/ , https://github.com/pilcrowonpaper/arctic . Do not adopt.
- **Supabase Auth.** See option 4: fine for LinkedIn, poor fit for Lichess.
- **Hand-rolled Lichess flow** is a reasonable alternative to the Generic OAuth plugin: the flow is one redirect and one token POST with PKCE `S256` and no client authentication, and it is a link-an-account action rather than a sign-in.

### Lichess constraints (apply to every option)

- "Only make one request at a time. If you receive an HTTP response with a 429 status ... In most cases, waiting one minute before retrying will be sufficient, but some limits may require longer."
- "Lichess supports unregistered and public clients (no client authentication, choose any unique client id). The only accepted code challenge method is S256. Access tokens are long-lived (expect one year), unless they are revoked. Refresh tokens are not supported."
- Requests must send a `User-Agent` identifying the app.
- Scopes exist for `team:write` (join teams) and `tournament:write` (create tournaments).
- Source for all four: https://lichess.org/api
- Consequence: the app must handle a member's token expiring or being revoked after about a year by asking them to reconnect.

## Could not verify

- **Whether a sponsor makes a Vercel Hobby project "commercial".** The only current primary text is the ToS sentence; Vercel's definition and the donations carve-out were removed from the Fair Use Guidelines in the 2026-11-12 revision, and sponsorship was never named. Only Vercel support can answer.
- **Timing accuracy of Vercel Workflow `sleep`** (how late a wake-up can be). Not stated in the pages read.
- **Whether Vercel Schedules will keep its Hobby limits at general availability.** The limits page says they may change.
- **Whether Workers Free enforces the 10 ms CPU limit strictly enough to break this app.** Cloudflare's docs give the limit and the typical 10-20 ms SSR figure; real behaviour for this app is untested.
- **Whether Cloudflare Workers compute can be pinned to the EU on a self-serve plan.** The D1 page points to Regional Services; I did not open its plan requirements.
- **Whether Supabase custom OAuth2 providers accept a public client with no secret**, and whether Lichess's account endpoint satisfies its userinfo requirements.
- **Whether pg_cron activity counts as "user database activity" for Supabase's pausing rule**, and pg_cron's timezone on Supabase.
- **Commercial-use terms for Neon, Supabase, Fly.io and Railway free tiers.** I found no restriction in the pricing and docs pages read, but did not read each full terms of service.
- **Fly.io waiving small invoices.** Not found in current docs; not relied on.
- **Hetzner availability.** Cost-optimised server types showed "not available" on the pricing page on the day checked; whether that is temporary is unknown.
- **Vercel docs dates.** The Schedules reference pages carry a placeholder `last_updated: 2018-10-20`; I dated them by the 2026-11-05 changelog instead.
