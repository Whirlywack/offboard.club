# Record of processing

The record GDPR Article 30(1) asks of a controller, kept here rather than published. The public notice is `/privacy` (`app/privacy/page.tsx`). Sources: `research/privacy-policy-requirements.md` §§1, 2.3, 2.6 and 2.7, checked against the code on 2026-11-25, and the Organiser's decisions on #34. Update it with any change to what the site keeps, why, who handles it or for how long.

## Controller

The Organiser, a natural person: the Member whose id is `ORGANISER_USER_ID`. Contact: the address in `ORGANISER_CONTACT_EMAIL`, shown in every page's footer. No DPO (Art 37(1) does not apply). No representative (Art 27: the controller is in the EU).

## Who the data is about

Members; people who signed in with LinkedIn but have not finished joining; the Organiser.

## Purposes, data and legal basis

| Purpose | Personal data | Where it is kept | Basis (Art 6(1)) |
|---|---|---|---|
| Account and sign-in | From LinkedIn at each sign-in: name, photo address, email, email-verified flag, LinkedIn subject id. LinkedIn tokens are nulled (`lib/auth.ts`) | `user.name`, `image`, `email`, `emailVerified`; `account.accountId` | (b) contract. Better Auth requires the email, and looks it up when a LinkedIn account it has not seen signs in; Offboard sends no email and no page shows it |
| Sessions and security | Session token, created and expiry times, IP address, full user-agent string (browser, operating system, device); OAuth state (10 min) | `session`; `verification` | (f) protecting accounts and the service |
| Membership terms | When public listing and the house rules were accepted | `user.publicDisplayConsentAt`, `houseRulesAcceptedAt` | (b) contract |
| Matchdays | Lichess id, username, blitz rating, connected-at; marked and closed flags, refreshed for each Matchday played; membership of the Club's Lichess team | `user.lichess*`; on Lichess | (b) contract |
| Results and Games | Rank, points, rating and Company per Matchday; Games: Lichess game id, players, result, status, plies, both ratings, winner's clock, finish time | `matchdayResult`; `game` | (b) contract |
| Profiles | Company website (registrable domain, with name and logo fetched from it), position, LinkedIn profile link, "open to" line; new Companies created per day | `user.companyDomain`, `position`, `linkedInUrl`, `openTo`, `companiesCreatedOn`, `companiesCreatedThatDay`; `company` | (b) contract |
| Public Leaderboards, Recaps, Awards and Season champion | Name, Company, place, points, Season score, Matchdays played, Awards | Read from the above | (f) the Club's visibility to people deciding whether to join (ADR 0002). A condition of membership; objecting means leaving (#34 decision) |
| The Club's Telegram group (#13) | The names of each Recap's top three and Award winners, in the bot's post; no Company, and the reminders link to the site, not to Lichess (ADR 0002) | `telegramPost.text`, written afresh until sent; then in the group, on Telegram | (f) as the public Recap, to Members who join the group |
| Fair play | Marked and closed flags, used to leave someone off Leaderboards and Awards unnamed | `user.lichessMarked`, `lichessClosed` | (f) honest rankings |
| Games of someone who has left | Their side nulled; Lichess game id and both ratings stay. An Award won against them keeps its winner and shows its Game to nobody | `game` | (f) opponents' own record |
| Removal from the Lichess team that failed | The connected Lichess id to remove by hand, when the site gave up, and why (#15) | `teamRemoval` | (f) completing the removal |
| Creating Matchdays | The Organiser's Lichess token, AES-256-GCM | `organiserLichess` | (f), the Organiser's own data |
| Logs | Error text from scheduled jobs; server request logs | `jobFailure`, `scheduledJob`; Vercel | (f) running the service |
| Backups (#17) | A nightly dump of every table but sessions and one-time sign-in values: everything above, the Organiser's token still sealed | Vercel Blob, private store `offboard-backups` | (f) recovering the service after a loss |
| Alerts to the Organiser (#17) | The sentence a failing job, a missing backup or the Lichess permission's end gives, with no Member's data; the Organiser's chat id is a setting, not in the database | `telegramPost`: a day for a failure or a missing backup; until the next warning is due for the Lichess permission, at most 23 days; then the Organiser's chat on Telegram | (f), the Organiser's own data |

No special-category data. No decisions under Art 22. No email sent, no payments, no analytics or tracking.

## Recipients

| Recipient | Role | Agreement | Where |
|---|---|---|---|
| Vercel Inc. | Processor (hosting, logs, backups) | DPA incorporated by the Terms, Pro and Enterprise plans only (DPA §1) | Functions and the backups' Blob store `fra1` (Frankfurt), builds `iad1` (Washington, D.C.); primary facilities in the USA |
| Neon, part of Databricks, Inc. | Processor (database) | Databricks DPA, incorporated by the MCSA | AWS `eu-central-1` (Frankfurt); sub-processors and support in the USA |
| LinkedIn Ireland | Separate controller; source of sign-in data | LinkedIn API Terms and BD DPA | Members' browsers load photos from LinkedIn |
| Lichess (association under French law) | Separate controller | None needed | EU |
| Telegram | Separate controller for the group, which Members join by choice; the bot only posts | Telegram's terms for bots | Not stated for groups; Telegram's privacy policy (4.1) keeps the data of users who signed up in the EEA in the Netherlands |
| Signed-in Members; the public | Recipients of what ADR 0002 shows them | — | — |

## Transfers outside the EEA

USA, through Vercel (EU-U.S. Data Privacy Framework and 2021 SCCs, Module Two) and Databricks (DPF and SCCs, Modules 2 and 3).

## Retention

| Data | Kept |
|---|---|
| Account, Profile, Lichess connection, results, acceptances | While a Member. Leaving deletes the `user` row at once, and with it the sessions, the LinkedIn `account` row and the results; the site then asks Lichess to remove the connected account from the Club's team (`lib/leaving.ts`, #15) |
| People who signed in but did not finish joining | Their LinkedIn data, sessions and any acceptances, until they delete their account from the sign-up step they stopped at, which deletes the `user` row as leaving does, and with it the sessions and the LinkedIn `account` row; nothing is asked of Lichess, as no account was connected (`app/welcome/leave`, #43). No inactive-account purge (#34 decision) |
| Games of someone who has left | Kept, side nulled, including through a redo of the Matchday |
| Sessions with IP and user agent | Cookie 7 days from sign-in. The row's expiry moves on as the site is used, and the row stays until signed out or the account is deleted (expired rows are not purged) |
| OAuth state, pending-Lichess cookie | 5 to 10 minutes |
| A post to the Telegram group (`telegramPost`) | Until it is no longer worth posting, a Recap's until the next Matchday starts; deleted by the next hourly run after that. In the group, for as long as Telegram keeps it: leaving does not reach it |
| A failed team removal (`teamRemoval`) | Until the Organiser has removed the account on Lichess and pressed Done on the Organiser page |
| The Organiser's Lichess token | Until replaced or expired (one year); deleted, and revoked on Lichess, when the Organiser's account is deleted |
| Neon restore history | 6 hours |
| Backups in Vercel Blob | Within 14 days: each night's run deletes every backup made more than 13 days before. Each is also written to expire after 12 days, which the store applies by itself, at UTC midnight and "usually" within a day after, so they go even if the job stops. Deletions in the database reach the backups in that time (`lib/backup.ts`, `docs/restore.md`) |
| Vercel runtime logs | 1 day |
| Neon `development` branch | A copy of live data made 2026-11-25, with no expiry; deletions do not reach it |

## Security measures (Art 32)

Served over HTTPS; every cookie is Secure in production, HttpOnly and SameSite=Lax. No LinkedIn or Member Lichess token is kept; the Organiser's is sealed with AES-256-GCM under a key held outside the database (`lib/token-box.ts`). Members-only data is behind `requireSignedUp` or `viewerIsMember`, and the Organiser's page behind `requireOrganiser`. Agents and tests use throwaway local databases, never live data (`docs/agents/dev-environment.md`). Breaches go to the VDAI within 72 hours unless unlikely to result in a risk (Art 33), and every breach is documented (Art 33(5)).
