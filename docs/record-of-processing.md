# Record of processing

The record GDPR Article 30(1) asks of a controller, kept here rather than published. The public notice is `/privacy` (`app/privacy/page.tsx`). Sources: `research/privacy-policy-requirements.md` §§1, 2.3, 2.6 and 2.7, checked against the code on 2026-11-25, and the Organiser's decisions on #34. Update it with any change to what the site keeps, why, who handles it or for how long.

## Controller

The Organiser, a natural person: the Member whose id is `ORGANISER_USER_ID`. Contact: the address in `ORGANISER_CONTACT_EMAIL`, shown in every page's footer. No DPO (Art 37(1) does not apply). No representative (Art 27: the controller is in the EU).

## Who the data is about

Members; people who signed in with LinkedIn but have not finished joining; the Organiser.

## Purposes, data and legal basis

| Purpose | Personal data | Where it is kept | Basis (Art 6(1)) |
|---|---|---|---|
| Account and sign-in | From LinkedIn at each sign-in: name, photo address, email, email-verified flag, LinkedIn subject id. LinkedIn tokens are nulled (`lib/auth.ts`) | `user.name`, `image`, `email`, `emailVerified`; `account.accountId` | (b) contract. The email is kept only because Better Auth requires one; nothing reads it |
| Sessions and security | Session token, expiry, IP address, user agent; OAuth state (10 min) | `session`; `verification` | (f) protecting accounts and the service |
| Membership terms | When public listing and the house rules were accepted | `user.publicDisplayConsentAt`, `houseRulesAcceptedAt` | (b) contract |
| Matchdays | Lichess id, username, blitz rating, connected-at; marked and closed flags, refreshed for each Matchday played; membership of the Club's Lichess team | `user.lichess*`; on Lichess | (b) contract |
| Results and Games | Rank, points, rating and Company per Matchday; Games: Lichess game id, players, result, status, plies, both ratings, winner's clock, finish time | `matchdayResult`; `game` | (b) contract |
| Profiles | Company website (registrable domain, with name and logo fetched from it), position, LinkedIn profile link, "open to" line; new Companies created per day | `user.companyDomain`, `position`, `linkedInUrl`, `openTo`, `companiesCreatedOn`, `companiesCreatedThatDay`; `company` | (b) contract |
| Public Leaderboards, Recaps, Awards and Season champion | Name, Company, place, points, Season score, Matchdays played, Awards | Read from the above | (f) the Club's visibility to people deciding whether to join (ADR 0002). A condition of membership; objecting means leaving (#34 decision) |
| Fair play | Marked and closed flags, used to leave someone off Leaderboards and Awards unnamed | `user.lichessMarked`, `lichessClosed` | (f) honest rankings |
| Games of someone who has left | Their side nulled; Lichess game id and both ratings stay | `game` | (f) opponents' own record |
| Removal from the Lichess team that failed | The Lichess id to remove by hand (#15) | `jobFailure` | (f) completing the removal |
| Creating Matchdays | The Organiser's Lichess token, AES-256-GCM | `organiserLichess` | (f), the Organiser's own data |
| Logs | Error text from scheduled jobs; server request logs | `jobFailure`, `scheduledJob`; Vercel | (f) running the service |

No special-category data. No decisions under Art 22. No email sent, no payments, no analytics or tracking.

## Recipients

| Recipient | Role | Agreement | Where |
|---|---|---|---|
| Vercel Inc. | Processor (hosting, logs) | DPA incorporated by the Terms, Pro and Enterprise plans only (DPA §1) | Functions `fra1` (Frankfurt), builds `iad1` (Washington, D.C.); primary facilities in the USA |
| Neon, part of Databricks, Inc. | Processor (database) | Databricks DPA, incorporated by the MCSA | AWS `eu-central-1` (Frankfurt); sub-processors and support in the USA |
| LinkedIn Ireland | Separate controller; source of sign-in data | LinkedIn API Terms and BD DPA | Members' browsers load photos from LinkedIn |
| Lichess (association under French law) | Separate controller | None needed | EU |
| Signed-in Members; the public | Recipients of what ADR 0002 shows them | — | — |

## Transfers outside the EEA

USA, through Vercel (EU-U.S. Data Privacy Framework and 2021 SCCs, Module Two) and Databricks (DPF and SCCs, Modules 2 and 3).

## Retention

| Data | Kept |
|---|---|
| Account, Profile, Lichess connection, results, acceptances | While a Member; deleted at once on leaving (`delete from "user"`, #15) |
| People who signed in but did not finish joining | Until they ask the Organiser to delete it. No inactive-account purge (#34 decision) |
| Games of someone who has left | Kept, side nulled |
| Sessions with IP and user agent | Cookie 7 days, extended on use; the row until signed out or the account is deleted (expired rows are not purged) |
| OAuth state, pending-Lichess cookie | 5 to 10 minutes |
| A failed removal's note naming the Lichess id | Not deleted automatically |
| The Organiser's Lichess token | Until replaced, expired (one year) or the Organiser's account is deleted |
| Neon restore history | 6 hours |
| Vercel runtime logs | 1 day |
| Neon `development` branch | A copy of live data made 2026-11-25, with no expiry; deletions do not reach it |

## Security measures (Art 32)

Served over HTTPS; every cookie is Secure in production, HttpOnly and SameSite=Lax. No LinkedIn or Member Lichess token is kept; the Organiser's is sealed with AES-256-GCM under a key held outside the database (`lib/token-box.ts`). Members-only data is behind `requireSignedUp` or `viewerIsMember`, and the Organiser's page behind `requireOrganiser`. Agents and tests use throwaway local databases, never live data (`docs/agents/dev-environment.md`). Breaches go to the VDAI within 72 hours unless unlikely to result in a risk (Art 33), and every breach is documented (Art 33(5)).
