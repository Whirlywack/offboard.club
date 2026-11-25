# Privacy policy and terms page: what it must say

Research for #34, done 2026-11-25. This is not legal advice. I opened every source on 2026-11-25, and each claim cites the source and the article, section or paragraph it comes from. Where a source said nothing or I could not open it, the text says so (see §11). "Code" means this repository.

## Bottom line

1. **The GDPR applies and the Organiser is the controller.** The household exemption does not apply to publishing names on the internet (Lindqvist, para 47). The page has to identify the controller and give contact details (Art 13(1)(a)). **Whether "Offboard" plus an email is enough instead of the Organiser's own name is not settled by any source, and the sources lean towards the name (§0).** No postal address is required under the GDPR.
2. **Making public listing a condition of joining breaks consent.** Today a person cannot be a Member without ticking "my name … will appear publicly", and the site gives no way to withdraw that consent. Under Art 7(4), Recital 43 and EDPB 05/2020 paras 26 and 114, consent given this way is presumed not to be freely given. Either make public listing optional and withdrawable on the site, or base it on legitimate interests with a right to object. This has to be decided before the page is written, because the page must state the legal basis (Art 13(1)(c)).
3. **LinkedIn imposes its own requirements.** Next to the sign-in button there must be a statement that the site will *store* the LinkedIn profile, plus a link to the privacy policy and the "user agreement" (API Terms 5.1 and 5.2, and LinkedIn's storing-data specification). Data must be deleted "immediately" when a Member asks (4.4). The current notice says neither "store" nor links to a policy.
4. **Records of processing are required even at this size.** Weekly processing is "not occasional", so the Art 30(5) exemption does not apply (WP29/EDPB position paper). A DPO is not required.
5. **The session cookie lasts 7 days.** WP29 Opinion 04/2012 treats persistent login cookies as *not* exempt from consent. Lithuania's regulator, the VDAI, requires information even for exempt cookies, so a cookie section is needed either way.
6. **Data leaves the EEA through Vercel.** Builds run in Washington, D.C. (`iad1`) and connect to the live database, and Vercel is a US company. Vercel's DPA covers this, but only on the Pro and Enterprise plans (DPA §1), backed by the Data Privacy Framework plus SCCs. Neon's data sits in Frankfurt, and its parent company Databricks provides SCCs and is DPF-certified. Lichess hosts in the EU.
7. **Consumer-law information duties do not apply.** The CRD, the e-Commerce information rules and the DSA attach to a "trader" or to a service "normally provided for remuneration". What the terms need is short: who may join, the house rules, removal, the free status, a liability clause that respects Civil Code 6.252, and Lithuanian law.

## 0. Does the page have to print the Organiser's own name?

**Answer: (c) the sources do not settle it, but they lean towards (a).** No provision, EDPB text or court ruling says in terms that a natural-person controller must print their own name. Every EU and Lithuanian source I found reads "identity" as the controller itself, and the controller here is the Organiser personally. The only regulator that endorses a club name is the UK's ICO, and only for unincorporated associations.

**Who the controller is.**
- Art 4(7): the controller is "the natural or legal person, public authority, agency or other body which … determines the purposes and means".
- EDPB 07/2020, para 17: a controller "might be an organisation, but it might also be an individual or a group of individuals" (https://www.edpb.europa.eu/system/files/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf).
- "Offboard" has no legal existence apart from one person. GLOSSARY: "The single person who runs the Club". So the controller is the Organiser.

**What "identity" requires.**
- *Text, Art 13(1)(a) and 14(1)(a):* "the identity and the contact details of the controller". The text does not define "identity" further.
- *Recital 39:* transparency "concerns, in particular, information to the data subjects on the identity of the controller".
- *Recital 58:* the concern is people being unable "to know and understand whether, by whom and for what purpose personal data relating to him or her are being collected".
- *Recital 60* speaks only of "the existence of the processing operation and its purposes". It says nothing on identity.
- *WP260 rev.01 Annex, row for Art 13(1)(a) / 14(1)(a), p. 35* (endorsed by the EDPB; read from the CNIL-hosted copy, https://www.cnil.fr/sites/cnil/files/atoms/files/wp260_enpdf_transparency.pdf): "This information should allow for easy identification of the controller and preferably allow for different forms of communications with the data controller (e.g. phone number, email, postal address, etc.)". Paragraph 29 adds that a "change to the identity of the controller" must always be communicated.
- **Decisive for this site, because public listing relies on consent.** Recital 42: "For consent to be informed, the data subject should be aware at least of the identity of the controller". EDPB 05/2020, para 64(i), lists "the controller's identity" as minimum content for valid consent. Para 68: consent must rest on information "that allows the data subjects to easily identify who the controller is". Footnote 42 warns that if the identity is only in deeper layers, "it will be difficult … to demonstrate that the data subject has given informed consent". So an unclear identity puts the consent basis for public names at risk as well as Art 13.

**Regulators on natural-person controllers and clubs.**
- **VDAI (Lithuania).** A VDAI training presentation on informing people about video surveillance (2026-06-15) says the notice must give "duomenų valdytojo juridinio asmens pavadinimas, duomenų valdytojo fizinio asmens vardas ir pavardė, jų kontaktinė informacija (adresas, el. pašto adresas ir (arba) tel. nr.)". In English: a legal-person controller's name, *a natural-person controller's first name and surname*, and their contact details (address, email **and/or** phone). Source: https://vdai.lrv.lt/public/canonical/1781515492/1440/Karolina%20Vilimaite-Come_Informavimas_teise%20susipazinti.pdf. It is a staff slide about CCTV signs, not a formal guideline, but it is the regulator's own reading of Art 13(1)(a) for natural persons.
- The VDAI's 2025-07-24 notice to the public also tells people to check "ar yra nurodytas asmens duomenų valdytojas, jo rekvizitai ir kontaktiniai duomenys" (whether the controller, its details and contact details are given): https://vdai.lrv.lt/lt/naujienos/islikite-budrus-dalindamiesi-asmenine-informacija-95t.
- **ICO (UK).** Not an EU authority, but UK GDPR Art 13 has the same wording. For unincorporated associations such as sports clubs: "For convenience you may identify the organisation as a whole as the controller (eg you may use the club or group name in your privacy information for individuals). But for legal purposes the controller will actually be the relevant members who make the decisions" (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/controllers-and-processors/controllers-and-processors/what-are-controllers-and-processors). This is the only regulator statement I found that backs (b). It concerns associations whose governing document names the people in charge, not a project run by one person, and even there the individual stays the legal controller.
- I found no CJEU or Lithuanian court decision on a natural-person or sole-operator controller's naming duty (§11).

**Other rules that could require a named person, independently of the GDPR.**
- **Lithuanian Law on Information Society Services (Informacinės visuomenės paslaugų įstatymas, ISPĮ), Art 6(1)(1)–(3).** It requires "paslaugų teikėjo pavadinimą (jei paslaugų teikėjas yra fizinis asmuo, – šio asmens vardą ir pavardę)" (the provider's name; for a natural person, first name and surname). It also requires "korespondencijos adresą" (a correspondence address) and an email (consolidated text from 2026-06-30, https://e-seimas.lrs.lt/rs/actualedition/TAIS.277491/MebLZBOlkR/format/ISO_PDF).
  - **It applies only to information society services.** Art 2(12) takes undefined terms from the DSA. DSA Art 3(a) defines the term by reference to Directive 2015/1535, Art 1(1)(b): "any service normally provided for remuneration". The earlier text of the Lithuanian law (Art 2(4)) said the same: "paprastai už atlyginimą … teikiamos paslaugos" (services normally provided for remuneration).
  - The supervisor, VSSA, notes that information society services can include services the recipient does not pay for, but frames them as "įvairią ekonominę veiklą" (various economic activities) (https://vssa.lrv.lt/lt/administracine-informacija/ukio-subjektu-prieziura/informacines-visuomenes-paslaugos-samprata/).
  - **Assessment:** a free, ad-free, non-commercial club with no economic activity is outside the definition. If that ever changed (sponsors, fees or ads), this law would require the name and a correspondence address on the site.
  - Note that the VSSA's own summary of Art 6 still says "gyvenamosios vietos adresą" (home address) (https://vssa.lrv.lt/lt/administracine-informacija/ukio-subjektu-prieziura/paslaugos-teikejo-pareigos/). The current statute says correspondence address, and the statute controls.
- **Consumer Rights Directive Art 6(1)(c)** requires a geographical address, but only from a "trader" (§7). It does not apply.
- **Law on Provision of Information to the Public (Visuomenės informavimo įstatymas), Art 24.** The registration duty I read covers producers and disseminators of public information "kurie yra juridiniai asmenys" (that are legal persons) (e-tar, consolidated text). It does not reach a natural person. I did not check the rest of that law.
- **LinkedIn.** Nothing found requiring the operator's personal name to be shown publicly. The API Terms require a privacy policy and user agreement (5.1). App creation requires "App name, LinkedIn Page, Privacy Policy URL, and App logo", and a LinkedIn Page is "required for app ownership" (https://learn.microsoft.com/en-us/linkedin/consumer/integrations/verified-on-linkedin/development-guide/dev-self-serve/quick-start). An "Offboard" LinkedIn Page satisfies that. LinkedIn knows the developer's own account, but that is not shown to Members.
- **Lichess:** nothing.

**A postal address: not required by the GDPR.** WP260 lists a postal address only as an example of what controllers should "preferably" offer, and the VDAI slide says "adresas, el. pašto adresas ir (arba) tel. nr." (address, email **and/or** phone). A postal address would be required only if ISPĮ Art 6 applied, which it does not today, and then it could be any correspondence address, not necessarily a home address.

**The choices, and what each risks.**

| Choice | What the page says | Risk |
|---|---|---|
| **Cautious** | "Offboard is run by [first name surname], a private individual, who is the controller. Contact: privacy@offboard.club" | Meets every reading (Art 13(1)(a); WP260; EDPB 05/2020 paras 64 and 68; the VDAI slide). Cost: the name becomes searchable. The Organiser's name is already on public Leaderboards whenever they play, but not as "the person who runs the Club". |
| **Middle** | Public page: "Offboard, run by one volunteer (the Organiser)", plus the email. The Organiser's full name is shown on the welcome step, behind sign-in, before anyone consents, and is given on request | Covers the people whose data is collected at the moment that matters for consent, and allows up to one month for LinkedIn and Lichess data (Art 14(3)(a)). Less clean for data collected at the very moment of sign-in (session IP and user agent, Art 13 "at the time when personal data are obtained"), and against WP260's expectation of a public notice. No source endorses this split. |
| **Minimal** | "Offboard" plus the email only | Relies on the ICO's "convenience" reasoning, which is UK-only and written for associations. It risks a VDAI finding that Art 13(1)(a) was not met, and it weakens the consent for public names (Recital 42; EDPB 05/2020 para 64(i)). |

**If the Organiser wants the club name to be the controller,** the durable route is a legal person, such as an association (asociacija), which then becomes the controller under its own name. I did not check the registration duties in Lithuania, which include a registered seat that would be public (§11).

## 1. What the site does (from the code)

| Personal data | Source | Stored in | Who sees it | Code |
|---|---|---|---|---|
| Name, photo URL; refreshed at **every** sign-in | LinkedIn OIDC userinfo (scopes `openid profile email`) | `user.name`, `user.image` | Name: **public** on Leaderboards/Recaps. Photo: signed-in Members; the browser loads it from LinkedIn's servers | `lib/auth.ts` (`overrideUserInfoOnSignIn`); Better Auth `social-providers/linkedin.mjs` |
| Email, "email verified" flag | LinkedIn | `user.email` (unique), `user.emailVerified` | Nobody; "the email is never read" (`lib/auth.ts` `getProfile`) | migration 001 |
| LinkedIn subject id (pairwise `sub`, per LinkedIn's discovery doc) | LinkedIn | `account.accountId`; all LinkedIn tokens nulled | Nobody | `lib/auth.ts` `withoutLinkedInTokens` |
| Consent and house-rules timestamps | The person | `user.publicDisplayConsentAt`, `houseRulesAcceptedAt` | Organiser | `lib/consent.ts`, `app/actions.ts` |
| Session token, expiry, **IP address, user agent** | The request | `session` | Organiser (via the database) | migration 001; Better Auth `db/internal-adapter.mjs` (sets `ipAddress`, `userAgent`) |
| OAuth state (10 min) | Sign-in | `verification` | Nobody | Better Auth `state.mjs` (database strategy) |
| Lichess id, username, blitz rating, connected-at; "marked" and "closed" flags | Lichess API: `/api/account` with the Member's token (used once, then revoked); `/api/user/{id}` without a token; refreshed at each Matchday ingested | `user.lichess*` | Username and rating: Members only. Flags: nobody; they only leave the person out of boards | `lib/connect-lichess.ts`, migrations 004 and 006 |
| Membership of the Club's private Lichess team | The site joins with the Member's own token | On Lichess | Lichess | `lib/connect-lichess.ts` (an old account stays in the team after a swap; see the note in the file) |
| Company: website, then registrable domain; name and logo fetched from that site | The person, plus the Company's website | `user.companyDomain`, `company.*` | **Public**: "Name (domain)" | `lib/companies.ts`, `lib/company.ts`, `app/leaderboard.tsx` |
| Position, LinkedIn profile link, "open to" line (optional) | The person | `user.position`, `linkedInUrl`, `openTo` | Members only | migration 002, `lib/profile.ts` |
| Matchday result: rank, points, rating, Company at the time | Lichess tournament export | `matchdayResult` | **Public**: rank, points, Season score, Matchdays played, Award name/value/winner | migration 006, `lib/awards.ts` |
| Games: Lichess game id, players, result, status, plies, both ratings, winner's clock, finish time | Lichess | `game` (a leaver's side becomes null; the game id and ratings stay) | Members (Profiles, Award boards) | migration 006 |
| Organiser's Lichess token, AES-256-GCM | Organiser | `organiserLichess` | Organiser | migration 007, `lib/token-box.ts` |
| Error text from scheduled jobs | System | `jobFailure` | Organiser | migration 007 |
| Server logs (`console.error` text, request metadata) | Vercel | Vercel | Organiser and Vercel | Vercel runtime logs: 1 day on Pro (https://vercel.com/docs/logs/runtime, "Limits") |

**What the site does not do.** It has no analytics or tracking scripts: `/`, `/recaps` and `/all-time` reference no third-party script or asset host (fetched 2026-11-25), fonts are self-hosted (`app/layout.tsx`), and Better Auth telemetry is off by default (`@better-auth/telemetry`: `enabled` defaults to `false`). It sends no email and takes no payments. **Planned but not built:** a Telegram group, and a database backup stored outside Neon (spec #1, stories 16, 28 and 62). The Lichess replay iframe loads only after a Member clicks; it is sandboxed and sends no referrer (`app/recaps/replay.tsx`, `awards.tsx`).

**Infrastructure, checked on 2026-11-25 through the Vercel and Neon APIs:**
- **Functions** run in `fra1` (Frankfurt), per the production deployment's `regions`.
- **Builds** run in Washington, D.C. The build log says "Running build in Washington, D.C., USA (East) – iad1". `pnpm build` first runs `scripts/migrate.mjs`, which connects to the live database. The current code runs schema changes only and reads no personal data at build time, because pages read their data at request time through `connection()`.
- **Vercel plan:** `vercel.json` schedules an hourly cron (`7 * * * *`) and the deployment is READY. Hobby plans "are limited to cron jobs that run once per day … will fail during deployment" (https://vercel.com/docs/cron-jobs/usage-and-pricing), so the team is on Pro or Enterprise. Spec #1 says Pro.
- **Neon:** region `aws-eu-central-1` (Frankfurt), Free plan, restore history of 21,600 s (6 h). A `development` branch was created on 2026-11-25 from `main` with its data. `docs/agents/dev-environment.md` describes it as "a copy of live, real accounts included".

## 2. GDPR

### 2.1 Controller, not household
- Recital 18 excludes "a purely personal or household activity and thus with no connection to a professional or commercial activity" (it includes "social networking and online activity undertaken within the context of such activities"). Art 2(2)(c) says the same.
- **Lindqvist** (C‑101/01), para 47: the exception covers "only … activities which are carried out in the course of private or family life of individuals, which is clearly not the case with the processing of personal data consisting in publication on the internet so that those data are made accessible to an indefinite number of people." https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62001CJ0101
- **Ryneš** (C‑212/13), paras 29 to 31 and 33: the exception "must be narrowly construed". "Purely" means "not simply a personal or household activity". It does not cover processing "directed outwards from the private setting". https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62013CJ0212
- **Jehovan todistajat** (C‑25/17), paras 42 to 45: the exception does not cover an activity "directed outwards from the private setting" that makes data "accessible to a potentially unlimited number of persons". https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62017CJ0025
- **Conclusion:** the club is open to anyone in tech in Vilnius and publishes Leaderboards to the world, so it is not household processing. The Organiser, a natural person who decides the purposes and means, is the controller (Art 4(7)). LinkedIn (LinkedIn Ireland for EU members, per the User Agreement, "LinkedIn and other Key Terms") and Lichess (an association under French law of 1901, per https://lichess.org/privacy) are separate controllers.

### 2.2 What to tell people, when and how (Arts 12 to 14)
GDPR text: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679

- **Form (Art 12(1)).** The information must be "concise, transparent, intelligible and easily accessible … clear and plain language … by electronic means." Requests get an answer within one month, extendable by two (Art 12(3)), free of charge (12(5)). Recital 59 adds that "the controller should also provide means for requests to be made electronically."
- **Where (WP260 rev.01, endorsed by the EDPB).** "A direct link to this privacy statement/ notice should be clearly visible on each page of this website under a commonly used term (such as 'Privacy' …)." Layered notices are recommended (para 8). https://www.edpb.europa.eu/system/files/2023-09/wp260rev01_en.pdf
- **When.** Data the person gives directly (welcome step, Profile form) is covered by Art 13, at the time of collection. Data that comes from LinkedIn and Lichess is covered by Art 14: within one month at the latest (14(3)(a)), or earlier if used to communicate or disclosed. Since everything is collected at sign-up, give the whole notice there: the Art 13 items plus the Art 14 extras, which are the categories of data (14(1)(d)) and the source, including "whether it came from publicly accessible sources" (14(2)(f)). Lichess profiles and games are public on lichess.org, and its Terms say "Usernames are public and displayed all over the website".

| Required item | Article | This site's answer |
|---|---|---|
| Identity and contact of the controller | 13(1)(a), 14(1)(a) | **The Organiser chooses** a name per §0, plus an email |
| DPO | 13(1)(b) | None (§2.8) |
| Purposes and legal basis per purpose | 13(1)(c) | Table in §2.3 |
| The legitimate interests, where 6(1)(f) is used | 13(1)(d), 14(2)(b) | Must name the specific interest (WP260, Annex) |
| Recipients | 13(1)(e) | Vercel, Neon/Databricks (processors); LinkedIn (photo requests); Lichess (team join, embed); signed-in Members; the public |
| Transfers to third countries and the safeguard | 13(1)(f) | USA: Vercel (DPF + SCCs), Neon/Databricks support and sub-processors (SCCs + DPF). WP260 says the third countries should generally be named |
| Retention per category, or the criteria | 13(2)(a) | §2.6. WP260: "It is not sufficient … to generically state that personal data will be kept as long as necessary" |
| The rights | 13(2)(b) | §2.5 |
| Right to withdraw consent | 13(2)(c) | If consent stays the basis for public listing |
| Right to complain | 13(2)(d), 14(2)(e) | VDAI (§2.5) |
| Whether data is required, and what happens if not given | 13(2)(e) | LinkedIn sign-in and Lichess are required to be a Member; Profile fields are optional |
| Automated decisions under Art 22 | 13(2)(f) | None with legal or similarly significant effect. Say that a Lichess "marked" or "closed" flag leaves a person off Leaderboards, for fairness |
| Source of the data | 14(2)(f) | LinkedIn; Lichess (public data) |

### 2.3 Legal basis per purpose (Art 6)
Sources: EDPB 2/2019 says Art 6(1)(b) needs processing "objectively necessary for a purpose that is integral to the delivery of that contractual service" (para 30), and that "merely referencing or mentioning data processing in a contract is not enough" (para 27): https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf. EDPB 05/2020 para 31: where processing is necessary for the contract, "consent is not the appropriate lawful basis".

| Purpose | Basis that fits | Why |
|---|---|---|
| Account and sign-in (LinkedIn name, photo, id, email; session) | 6(1)(b) | Membership "under their real name and photo" is the service (GLOSSARY "Member"). The email is a weak fit (§9, gap 8) |
| Running Matchdays: Lichess id, username, rating, team join, results, Games | 6(1)(b) | It is the service itself (ADR 0001) |
| Members-only Profiles and Games | 6(1)(b) | It is the core of the service ("meeting people is the point"). The optional fields can be cleared at any time on the same form |
| Company name fetched from the website | 6(1)(b) | Asked for by the person (spec stories 18 and 19) |
| **Public Leaderboards and Recaps** (name, Company, scores, Awards) | **6(1)(a) consent, made optional; or 6(1)(f)** | Not necessary to play. ADR 0002 gives the purpose as "so that the Club is visible to people deciding whether to join", which is the Club's interest, so 6(1)(b) does not fit |
| Fair play: leaving marked or closed accounts off boards | 6(1)(f) | The interest is honest rankings (spec "Leaderboards"). There is a right to object (Art 21(1)) |
| Security: session IP and user agent, rate limiting, logs | 6(1)(f) | The interest is protecting accounts and the service |
| Keeping a leaver's Games in opponents' histories, side nulled | 6(1)(f) | The interest is the opponents' record (spec "Privacy") |
| Proof of consent and house-rules acceptance | 6(1)(c) or (f), with Art 7(1) | "The controller shall be able to demonstrate that the data subject has consented" |

### 2.4 Consent for publishing names: what follows
- **Not freely given if it is a condition of membership.** Art 7(4) gives "utmost account" to whether "the provision of a service, is conditional on consent to the processing of personal data that is not necessary." Recital 43 says such consent "is presumed not to be freely given". EDPB 05/2020 para 26: "bundling" consent with terms is "highly undesirable … presumed to be not freely given". https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
  - The code makes it a condition: `MEMBER_SQL` requires `"publicDisplayConsentAt" is not null` (`lib/members.ts`), and `consentProblem` refuses the form without the box ticked (`lib/consent.ts`).
- **Withdrawal (Art 7(3)).** "It shall be as easy to withdraw as to give consent." EDPB 05/2020 para 114: when consent was given through a website, "a data subject must be able to withdraw consent via the same electronic interface", and "without lowering service levels". Emailing the Organiser does not meet this.
- **After withdrawal.** The controller "must stop the processing actions concerned. If there is no other lawful basis … they should be deleted" (para 117; Art 17(1)(b)). For the public pages, that means removing the name from past and future public Recaps and Leaderboards. Where data was made public, take reasonable steps to inform others who copied it (Art 17(2)).
- **The basis cannot be switched later.** "The controller cannot swap from consent to other lawful bases … controllers must have decided in advance of collection" (para 123), and any change must be notified (para 120). So choose the basis before launch, and tell anyone who has already consented if it changes.
- **Options.**
  - (A) Recommended: keep consent but make it optional. Someone who declines or withdraws appears publicly as "a Member", with no Company, and normally to Members. Add a toggle on the Profile edit page.
  - (B) Legitimate interests, with an objection toggle that does the same thing (Arts 6(1)(f) and 21; the interest must be stated, Art 13(1)(d)).
  - (C) Keep consent as a condition of membership. Not defensible under Art 7(4).

### 2.5 Rights to list, and where to complain
- **Rights to list:** access (Art 15), rectification (16), erasure (17), restriction (18), portability for consent or contract data processed by automated means (20), objection to 6(1)(f) processing (21), withdrawal of consent (7(3)) and complaint (77).
  - *Rectification:* name and photo come from LinkedIn and are overwritten at each sign-in (`lib/auth.ts`), and `/update-user` is disabled. The page should say "change them on LinkedIn, or write to the Organiser".
  - *No Art 22 decisions:* say so in a sentence.
- **Authority: Valstybinė duomenų apsaugos inspekcija (State Data Protection Inspectorate, VDAI)**, from its own site:
  - Address: L. Sapiegos str. 17, LT‑10312 Vilnius
  - Email: ada@ada.lt; phone +370 5 271 2804 / 279 1445
  - Website: https://vdai.lrv.lt/en
  - Source pages: https://vdai.lrv.lt/en/structure-and-contacts/contacts-1 and https://vdai.lrv.lt/en/structure-and-contacts/handling-of-complaints. The complaints page says complaints go "by email ada@ada.lt, by registered post, or by visiting the Inspectorate in person", and encourages people to contact the controller first.
  - ADTAĮ Art 7(1) makes the VDAI the GDPR supervisor (e-tar, consolidated text).
- People may also complain in the Member State where they live (Recital 141).

### 2.6 Retention (Art 5(1)(e), 13(2)(a))
WP260 requires a period per category, not "as long as necessary". These are the facts the code fixes today, plus defaults the Organiser has to choose:

| Data | Today | Suggested text |
|---|---|---|
| Account, Profile, Lichess link, consents | Indefinite. `on delete cascade` exists, but there is no delete feature yet (#15) | While a Member. Deleted within 30 days of leaving or asking, or after X months inactive (Organiser chooses) |
| Matchday results | Deleted with the account (migration 006 comment) | Same as the account |
| Games of someone who has left | Their side becomes null, but the Lichess game id and both ratings stay | Kept in opponents' histories as "a former member" (state the basis, §2.3) |
| Session rows with IP and user agent | 7-day rolling expiry (Better Auth default). Expired rows are deleted only when that cookie is presented again (Better Auth `api/routes/session.mjs`), so others linger | 7 days. Add a purge (gap 7) |
| OAuth state rows, pending-Lichess cookie | 10 min | 10 min |
| Organiser's Lichess token | Until replaced or the Organiser's account is deleted. Lichess tokens last "one year" (https://lichess.org/api, PKCE) | Same |
| Neon restore history | 6 h (project setting) | "Deleted data stays in the database provider's restore history for up to 6 hours" |
| Neon `development` branch | A full copy of live data with no expiry | Remove the real data, or include it in deletions (gap 6) |
| Vercel runtime logs | 1 day on Pro (Vercel docs, "Limits") | 1 day |
| Off-site backups (#1 story 62, not built) | None | Organiser chooses, e.g. 30 days, EU storage |

### 2.7 Processors, DPAs and transfers

| Provider | Role | DPA, and how a customer gets it | Where the data is; transfer mechanism |
|---|---|---|---|
| **Vercel Inc.** | Processor for site and log data. Controller for its "Service-Generated Data" (DPA §4.2) | DPA §1: "applies to Vercel's Processing of Personal Data as a Processor … for Customers who are on **Enterprise and Pro** plans". The Terms of Service (§11.1) incorporate it "by reference", so no signature is needed. To get notices of new sub-processors, email privacy@vercel.com (DPA §7). https://vercel.com/legal/dpa, https://vercel.com/legal/terms | Functions in `fra1`, builds in `iad1`. DPA §13.1: "Vercel's primary processing facilities are in the United States". Safeguards: 2021 SCCs, Module Two (DPA Schedule 3), plus EU‑U.S. DPF "Active", next certification due 04/29/2027 (https://www.dataprivacyframework.gov/participant/6847; https://vercel.com/legal/privacy-notice, "Data Privacy Framework") |
| **Neon (Databricks, Inc.)** | Processor | Neon's Product Specific Schedule (updated 14 Oct 2026) falls under the Databricks MCSA. MCSA §4.1: "The terms of the DPA are incorporated by reference". I found no exclusion of the Free plan. A signed copy can be requested through the e-sign link at https://www.databricks.com/legal/databricks-data-processing-addendum. Sources: https://neon.com/platform-terms, https://www.databricks.com/legal/mcsa | Stored in AWS eu-central-1 (Frankfurt). DPA v3 §8.1: SCCs Modules 2 and 3 for "Restricted Transfers"; §6.2: breach notice "in no event later than seventy-two (72) hours". Databricks "complies with the EU-U.S. Data Privacy Framework" (https://www.databricks.com/legal/tia-faq). Sub-processors are in the US: AWS, Azure, Grafana, Salesforce (https://neon.com/subprocessors) |
| **LinkedIn** | Separate controller; the source of the data | The LinkedIn BD DPA is incorporated by the API Terms (§4.6). As controller, the app must inform people and get "valid consent from data subjects where required" (BD DPA §6.2). https://www.linkedin.com/legal/l/bd-dpa | The site keeps no LinkedIn data outside the EU. Members' browsers fetch photos from LinkedIn, and LinkedIn says "LinkedIn's data centers … are currently located in the U.S." It relies on SCCs and the DPF (https://www.linkedin.com/help/linkedin/answer/62533) |
| **Lichess.org** | Separate controller | None needed. The site acts on the Member's own token and on public data | Lichess data is "hosted … on servers located in the European Union" (https://lichess.org/privacy). No transfer |

Art 28(3) requires a binding contract with each processor, and both DPAs satisfy it by incorporation. Two caveats: **if Vercel drops to Hobby, no processor DPA applies**, and the Hobby plan is for "personal or non-commercial use" only (ToS §4). The page should name the USA as a third country and say "Data Privacy Framework and Standard Contractual Clauses (Vercel, Databricks)".

### 2.8 Records, DPO, breaches
- **Records of processing (Art 30): required.** Art 30(5) exempts organisations under 250 people "unless … the processing is not occasional". The WP29 position paper, endorsed by the EDPB, says the three triggers "are alternative ('or') and the occurrence of any one of them alone triggers the obligation". A weekly Matchday is not occasional. https://www.edpb.europa.eu/documents/other-guidance/position-paper-on-the-derogations-from-the-obligation-to-maintain-records_en (text read from the copy at https://cpdp.bg/userfiles/file/WP29/20180419_Art29WP_PositionpaperArt30_publish_En.pdf). The record is not published, but §1 of this note is most of it. Omnibus IV would limit records to high-risk processing, but it is not law: as of 6 Nov 2026 it was "Awaiting Parliament's position in 1st reading" (https://oeil.europarl.europa.eu/oeil/en/procedure-file/pdf?reference=2025%2F0130%28COD%29).
- **DPO (Art 37(1)): not required.** The Organiser is not a public authority. A few dozen people's games is not "large scale" regular and systematic monitoring (37(1)(b), my assessment), and no special-category data is processed (37(1)(c)).
- **Breaches.**
  - Notify the VDAI "without undue delay and, where feasible, not later than 72 hours … unless the personal data breach is unlikely to result in a risk" (Art 33(1)), with the contents in 33(3).
  - Document *every* breach (33(5)).
  - Tell the affected people when the risk is "high" (34(1)).
  - The VDAI publishes a breach form and an e-service (https://vdai.lrv.lt/en/services).
  - Separately, LinkedIn requires the app to "promptly notify us of any breaches of your User agreement or privacy policy that impact or may impact Members" (API Terms 5.1).
  - Neon must notify the Organiser within 72 h (Databricks DPA §6.2). Vercel commits to "notify our customers without undue delay" (https://vercel.com/docs/security/compliance).

## 3. Cookies

- **The law.**
  - ePrivacy Directive Art 5(3): consent is needed, except "as strictly necessary in order for the provider of an information society service explicitly requested by the subscriber or user to provide the service" (https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02002L0058-20091219).
  - Lithuania: **Elektroninių ryšių įstatymas (Law on Electronic Communications, ERĮ) Art 73(4)**, in its new edition XIV‑635 of 2021‑12‑01, consolidated version from 2026‑07‑01. It reads: "Saugoti informaciją … galiniame įrenginyje leidžiama tik su sąlyga, jeigu … buvo suteikta aiški ir išsami informacija … davė tam sutikimą. Šios nuostatos nedraudžia techninio saugojimo ar naudojimosi duomenimis, kurio vienintelis tikslas yra perduoti informaciją …" (https://www.e-tar.lt/rs/actualedition/TAR.82D8168D3049/silYHqpXQG/format/ISO_PDF). ERĮ Art 5(2) gives the VDAI supervision of the privacy chapter (IX). Before 2021 the same rule was Art 61(4), as the VDAI's 2021 FAQ cites.
- **The regulator.** The VDAI's 2025 summary of cookie practice (https://vdai.lrv.lt/public/canonical/1744022801/821/2025-04-02_Slapuku%CC%A8%20naudojimo%20praktikos%20apibendrinimas_new_galutinis.pdf) says consent is needed for everything "išskyrus būtinuosius" (except strictly necessary cookies). It adds that for strictly necessary cookies "sutikimas nėra reikalingas" (consent is not needed), but information about the cookies must still be given. **So: no banner needed if every cookie is strictly necessary, but a cookie section is required.**
- **The session cookie.** WP29 Opinion 04/2012 (WP194), §3.2: authentication cookies are exempt, but "Persistent login cookies which store an authentication token across browser sessions are not exempted". It suggests "a checkbox … 'remember me (uses cookies)'" as the way to get consent. The summary in §5 lists "Authentication cookies … for the duration of a session" (https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf). Better Auth's session cookie is persistent, with a Max-Age of 7 days. The VDAI summary does not address persistence.

Cookies the site sets. Sources: code; Better Auth `cookies/index.mjs` and `state.mjs`; https://www.better-auth.com/docs/concepts/cookies and https://www.better-auth.com/docs/concepts/session-management ("The session expires after 7 days by default", refreshed per `updateAge`, 1 day).

| Cookie | Set when | Attributes | Contents | Exempt? |
|---|---|---|---|---|
| `__Secure-better-auth.session_token` | LinkedIn sign-in | HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 604800 (7 d), extended on use | Signed random session token | **Persistent, so not exempt per WP194 §3.2.** Make it a browser-session cookie, or add a "keep me signed in" choice |
| `__Secure-better-auth.state` | Sign-in starts | HttpOnly, Secure, Lax, Max-Age 300 | Signed random OAuth state, which protects against cross-site request forgery | Yes: security, short-lived |
| `offboard-lichess` | Connecting Lichess | HttpOnly, Secure in production, Lax, Path=/api/lichess/callback, Max-Age 600 | Signed (not encrypted): state, PKCE verifier, **person id**, expiry | Yes: it holds the user's input for the duration of one flow |
| `offboard-organiser-lichess` | The Organiser connecting Lichess | As above | As above | Yes |

**Not set:** `session_data` (the cookie cache is off), `dont_remember`, `account_data` and `oauth_state` (state is stored in the database). Anonymous visits to `/`, `/recaps`, `/all-time` and `/welcome` returned no `Set-Cookie` header (checked 2026-11-25). The site uses no localStorage or sessionStorage (grep of `app/` and `lib/`). Vercel can set its own cookies if features such as Skew Protection (`__vdpl`) or a firewall challenge are switched on; none was observed. **Not cookies, but worth disclosing:** Members' browsers request LinkedIn photos from LinkedIn and, on a click, Lichess boards from Lichess, so both see the viewer's IP address.

## 4. Children
- GDPR Art 8(1) applies only "in relation to the offer of information society services directly to a child" where the basis is consent. Member States may set an age between 13 and 16.
- **Lithuania: 14.** ADTAĮ Art 6: "vaiko asmens duomenų tvarkymas yra teisėtas, jei sutikimą … duoda ne jaunesnis negu 14 metų vaikas" (lawful if the consent is given by a child not younger than 14). Source: e-tar consolidated text, https://www.e-tar.lt/portal/lt/legalActPrint?actualEditionId=kqEdQJIjKX&documentId=TAR.5368B592234C. The VDAI's unofficial English translation says "older than 14"; the Lithuanian text controls.
- **LinkedIn:** "The Services are not for use by anyone under the age of 16", with "Minimum Age" set at 16 (User Agreement §2.1, https://www.linkedin.com/legal/user-agreement).
- **Lichess:** "you must be at least 15 and be the legal age in your jurisdiction to enter into a digital contract … or if younger, you must be authorised by your parent or legal guardian" (https://lichess.org/terms-of-service).
- **The page should say:** "Offboard is for adults who work in tech. You must be 18 or over to join." That keeps clear of Art 8 and parental-consent questions, and LinkedIn's 16 is a floor anyway. Lithuanian rules on minors' capacity to contract were not checked (§11).

## 5. LinkedIn: what its terms require (quoted)

API Terms of Use (https://www.linkedin.com/legal/l/api-terms-of-use):
- **5.1:** "Your Application must include your own User agreement and privacy policy. Your User agreement and privacy policy must be prominently identified or located where members download or access your Application. Your privacy practices must meet applicable legal standards and accurately disclose the collection, use, distribution, transfer, storage, sharing, and deletion (including information on User-directed requests for deletion) of data." Also: "Your privacy policy must be at least as stringent and user-friendly as LinkedIn's."
- **5.2:** "Before a User authenticates … you must obtain that User's legally valid consent … which, at a minimum, shall include: (a) how their data will be used and disclosed, (b) when it will be collected (e.g., will the Application pull a Member's Profile Data more than once); (c) the type of data to be collected; (d) how a User can withdraw their consent; (e) how a User may request deletion of their data; and (f) the relevant requirements outlined in the specifications". Also: "The consent must be freely given … and given by a statement or a clear affirmative action."
  - Note the tension: under the GDPR the sign-in basis is the contract (§2.3), while LinkedIn contractually wants a consent-style notice. Do both: show the notice before the button, and tell people in the policy that the GDPR basis is the contract. Clicking the button and LinkedIn's own approval screen are the affirmative action LinkedIn asks for.
- **Specification for storing data** (https://developer.linkedin.com/legal/storing-member-data):
  - "your intent to store (vs. cache) Profile Data must be obvious … such as 'By clicking Sign in with LinkedIn, you agree to let [Your Company or Application Name] store your LinkedIn profile'".
  - The statement "must appear next to the link, button, or other object clicked".
  - "You must also give the member an opportunity to review and agree to your privacy policy."
- **4.1:** store Content "only for the duration necessary". Store it so you can "identify, segregate, and selectively delete" it. "The Content must not be stored in a data repository that would enable any third party access (other than the customer or Member to which it relates)."
- **4.3:** "If you want to refresh a Member's Profile Data … you may only do so when the Member is actually using your Application and not on an automated schedule." The site complies: it refreshes only at sign-in.
- **4.4:** "You must immediately delete all Content collected through the APIs on behalf of a User … upon request by that User, or when the User closes their account with you".
- **3.1(7):** do not "Request or obtain more Content than is minimally required". This bears on the email, which is fetched but never used.
- **3.1(8):** do not share Content with third parties "(with the exception of making the Content available to Users through the Application)". Showing LinkedIn names on public pages is display to visitors of the Application. The terms say nothing specific about public display (§11).
- **3.1(11):** do not imply LinkedIn "'verified' or 'confirmed' the veracity of any Profile Data". The footer's "isn't affiliated with … LinkedIn" fits.
- **Branding:** 6.1 licenses LinkedIn's marks "solely within the Application to identify the LinkedIn integration", without implying endorsement. The brand guidelines allow only "approved Brand assets" (https://developer.linkedin.com/legal/branding-guidelines). LinkedIn offers official button images for download (https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2, "Image Resources"). I found nothing that makes the official button mandatory. A plain text button with no logo is not addressed (§11).

## 6. Lichess

- **Use of the API and data.** "You can use our services for your own personal or commercial use, such as in your own applications". The services include "API access, content, game databases" (Terms, "Using our website"). The licences vary by part. Database exports "are released under the Creative Commons CC0 license" (https://database.lichess.org/).
- **Attribution or privacy requirements:** none found. The Terms and the API reference are silent on attribution and on a privacy policy for third-party sites.
- **API rules** (https://lichess.org/api): requests "MUST include a `User-Agent` header"; "Only make one request at a time". The code does both (`lib/lichess.ts`).
- **Marks.** Lichess "will never share the reason for a mark with anyone other than the account holder" (Terms). The site reads only the public flag and does not name anyone as marked (ADR 0002). Say on the page that marked or closed accounts are left off boards, without naming anyone.

## 7. Terms section: what it needs, and what it does not

**Required:** LinkedIn demands "your own User agreement" (5.1). The house rules are already a contract the Member accepts (`houseRulesAcceptedAt`).

**Include:**
- Who may join: 18 or over, working in tech in or around Vilnius, self-declared; one person, one Lichess account (GLOSSARY "Member"; `lib/connect-lichess.ts` "taken").
- The two house rules, verbatim from `app/welcome/consent-form.tsx`, and that Lichess's own rules apply to the Games.
- What gets someone removed: breaking a house rule, a Lichess mark, or not belonging (GLOSSARY "Organiser"). Say what removal does: the person leaves the boards and the Lichess team, and their data goes as in §2.6.
- That the service is free, comes with no prizes ("Season champion … carries no prize"), and has no guarantee that it will run.
- Liability: Civil Code 6.252(1) voids any exclusion of liability "dėl skolininko tyčios ar didelio neatsargumo" (for intent or gross negligence) and any exclusion for health, life or non-pecuniary damage (text at https://www.infolex.lt/ta/12755:str6.252, a reproduction of the Register text). So write "no warranty; liability limited to the extent the law allows; nothing limits liability for intent, gross negligence or harm to health".
- Changes to the terms, with notice; leaving at any time.
- **Governing law: Lithuanian.** Rome I Art 4(1)(b) applies the service provider's habitual residence anyway. Art 6(1), the consumer rule, applies only against "another person acting in the exercise of his trade or profession" (https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32008R0593).

**Not required, with the reasons:**
- *Consumer Rights Directive information duties:* "trader" means a person acting "for purposes relating to his trade, business, craft or profession" (Art 2(2)). The Art 3(1a) extension to services paid for with personal data still needs a trader. https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02011L0083-20220528
- *e-Commerce and DSA duties:* these apply to an "information society service", meaning "any service normally provided for remuneration" (Directive 2015/1535 Art 1(1)(b); DSA Art 3(a)). A free, ad-free, non-commercial club is outside that definition on its face, which is my assessment. If it ever counted, DSA Art 14(1) would only require stating the restrictions on Member-provided content, which the house rules already do.

## 8. Page outline: one page, `/privacy`, linked from every footer and from the welcome step

| # | Section | Facts from the code | Legal hook | Organiser supplies |
|---|---|---|---|---|
| 1 | Who runs Offboard and how to reach them | One person, unpaid, no company | Art 13(1)(a); LinkedIn 5.1; §0 | Name per the §0 choice; an email (no postal address needed) |
| 2 | In short (layered summary) | Public: name, Company, results. Members-only: everything else | Art 12(1); WP260 para 8 | — |
| 3 | What we keep and where it comes from | §1 table, in plain words: from LinkedIn (name, photo, email, LinkedIn id; refreshed at each sign-in); from Lichess (id, username, blitz rating, marks, results, Games; refreshed each Matchday); from you (Company website, position, LinkedIn link, "open to", consents); automatically (session with IP and browser) | Arts 13(1)(c), 14(1)(d), 14(2)(f); LinkedIn 5.2(b,c) | — |
| 4 | Why, and on what basis | §2.3 table | Art 13(1)(c)–(d) | Choice of A/B in §2.4 |
| 5 | What is public and what only Members see | ADR 0002 verbatim: public is name, Company, rank, points, Season score, Matchdays played, Awards. Members-only is photo, Profile, Lichess username and rating, Games, links | Arts 5(1)(a), 13(1)(e) | — |
| 6 | Who else handles it | Vercel (hosting, Frankfurt functions, US builds); Neon/Databricks (database, Frankfurt); LinkedIn; Lichess; signed-in Members; the public | Art 13(1)(e) | — |
| 7 | Outside the EU | USA through Vercel and Databricks: DPF and SCCs; copies available from those providers | Art 13(1)(f); WP260 | — |
| 8 | How long | §2.6 table | Art 13(2)(a); WP260 | Inactive-account period; backup period |
| 9 | Your choices and rights | Clear the Profile fields any time; public listing on/off (if option A); leave the Club (#15); name and photo change on LinkedIn; Arts 15–21; answer within 1 month, free | Arts 12, 15–21, 7(3); LinkedIn 5.2(d,e), 4.4 | — |
| 10 | Complaints | VDAI details (§2.5) | Arts 13(2)(d), 77 | — |
| 11 | Cookies | §3 table; no tracking; LinkedIn and Lichess requests | ERĮ 73(4); VDAI 2025 | Session-cookie choice |
| 12 | Age | 18+ | Art 8; LinkedIn §2.1 | Confirm 18 |
| 13 | Fair play and automated steps | Marked or closed Lichess accounts are left off boards, unnamed | Arts 13(2)(f), 21 | — |
| 14 | Changes to this page | Date, and a notice to Members of big changes | WP260; DSA Art 14(2) as good practice | — |
| 15 | Terms of membership | §7 | LinkedIn 5.1; CC 6.252; Rome I | Removal process |

**Next to the sign-in button** (replacing the notice in `app/sign-in.tsx`): "By signing in with LinkedIn you let Offboard store your LinkedIn name, photo and email, updated each time you sign in. [Privacy and terms]".

## 9. Gaps between the site and these sources, ranked

1. **No privacy policy or terms anywhere.** The live home page has no "Privacy" link, and the sign-in notice does not say "store" or link a policy. Breaks Arts 12–14, WP260, LinkedIn 5.1 and 5.2 and the storing specification. A LinkedIn breach risks losing API access, which would stop sign-in.
2. **Public listing is a condition of membership and cannot be withdrawn on the site** (`lib/members.ts`, `lib/consent.ts`). Breaks Art 7(3) and 7(4) and EDPB 05/2020 paras 26 and 114.
3. **No self-service deletion (#15).** Deletion happens only by email. It would not reach the `development` branch copy, the 6-hour Neon history, future backups, or Lichess team membership, which stays because removal from the team is not built (`lib/connect-lichess.ts` note). Breaks Art 17 and LinkedIn 4.4 ("immediately").
4. **The site does not identify the controller (§0).** The contact link depends on an environment variable; it is set live, but the code would show none without it (`lib/contact.ts`). Breaks Art 13(1)(a), and weakens the consent for public names (EDPB 05/2020 para 64(i)).
5. **No record of processing.** Breaks Art 30 (not occasional).
6. **A copy of live personal data sits in the Neon `development` branch, used from a laptop.** Breaks Arts 5(1)(c), 5(1)(e) and 32. Deletions also have to reach it.
7. **The session cookie persists for 7 days without a choice.** WP194 §3.2.
8. **The email is collected but never used.** Breaks LinkedIn 3.1(7) and Art 5(1)(c). Keep it only if Better Auth needs it, and say so.
9. **Session rows hold IP and user agent; expired rows are not purged.** Breaks Art 5(1)(e). Disclose, and add a purge.
10. **The consent wording is narrower than what is published.** The checkbox says "on Leaderboards", but Recaps, points, Awards and the Season champion on the home page are public too (`consent-form.tsx`).
11. **Leavers' Games keep the Lichess game id and both ratings,** which identify them through lichess.org. An Award won against a leaver still shows Members the board and link (ADR 0002). Disclose, and state the basis.
12. **Members' browsers fetch LinkedIn photos from LinkedIn on every Profile view** (`app/avatar.tsx`). Disclose under Art 13(1)(e).
13. **Builds run in the US with live database credentials and a live connection.** Covered by Vercel's DPA (Pro or Enterprise only), DPF and SCCs. Disclose, and keep the plan.
14. **Profile URLs expose internal person ids publicly** (`/profiles/<id>`). Pseudonymous, low risk.
15. **No minimum age stated.**

## 10. Questions for the Organiser, with recommended defaults

1. **Who is the controller, as printed?** Default: the cautious choice in §0, your name "as a private individual". If you won't print it, take the middle choice and show your name on the welcome step, never the minimal choice. The sources lean to a name, and public listing relies on consent, which needs "the controller's identity" (EDPB 05/2020 para 64(i)). Forming an association can come later.
2. **Which contact address?** Default: a dedicated address on the domain (e.g. `privacy@offboard.club`) forwarding to you, used as both the footer and privacy address. Art 13(1)(a) needs contact details, and requests should be possible electronically (Recital 59). A home postal address is not required, because the consumer-law address duty does not apply (§7).
3. **How should public listing work?** Default: option A, optional consent toggled on the Profile edit page, with people who opt out shown as "a Member". This is the only route that satisfies Art 7(3) and 7(4) cleanly. Decide before launch (EDPB 05/2020 para 123).
4. **How long are inactive accounts kept?** Default: deleted 24 months after the last sign-in or Matchday. WP260 requires a stated period, and two years covers a long break.
5. **What happens to Games when someone leaves?** Default: keep them in opponents' histories with the side removed, as built, and disclose it. It preserves others' records and the data is pseudonymous.
6. **Session cookie: 7 days or until the browser closes?** Default: until the browser closes, or add a "keep me signed in" box. Either avoids a cookie banner (WP194 §3.2).
7. **Minimum age?** Default: 18. The audience is working adults, LinkedIn's floor is 16 anyway, and it avoids parental-consent questions.
8. **The real data in the `development` branch?** Default: reset it from seed data, and stop copying live accounts. Minimisation, and erasure is then complete.
9. **Off-site backups (#1 story 62): where, and for how long?** Default: EU storage, 30-day rolling. It keeps the transfer list short and gives a clear period.
10. **Keep the email?** Default: keep it only as Better Auth's required identifier, never used, and say so. Revisit if Better Auth allows dropping it (LinkedIn 3.1(7)).
11. **Stay on the Vercel Pro plan?** Default: yes, because the processor DPA exists only on Pro and Enterprise.
12. **Will a lawyer read the page before it goes live (#34)?** Default: yes, for the controller wording and the consent model at least.
13. **Should the page be in English only?** Default: English, matching the site. Lithuanian-language requirements were not checked (§11).
14. **Telegram, when it is built?** Default: update the page first. The group's operator becomes a new recipient.

## 11. Not verified, silent, or pending

- **LinkedIn** says nothing on public display of a Member's name to non-users (3.1(8)) or on text-only sign-in buttons.
- **Lichess** says nothing on attribution and on a privacy-policy requirement for third-party sites.
- **The Vercel DPA excerpt** gave no breach-notice deadline for §8. I used Vercel's compliance page instead.
- **Neon/Databricks:** the MCSA points to DPA v3 (2023-07-21), which I read. The transfer FAQ links a 2026-01 DPA PDF, which I did not open. Neon's older DPA (neon.tech/dpa, 14 Nov 2024) still exists, and its sub-processor page references it. Ask Neon which one governs. Both use SCCs.
- **Vercel** does not document the build region; the evidence is this project's own build log. Whether Skew Protection is on was not checked in the dashboard.
- **Not opened:** Lithuanian law on minors' capacity to contract, any Lithuanian-language requirement for website notices, and the EDPB Guidelines 1/2024 on legitimate interests.
- **Controller naming (§0):** no CJEU or Lithuanian court ruling found. The VDAI statement is a training slide, not a guideline. The ICO view is UK law. The Law on Provision of Information to the Public was read only for Art 24. Registration duties for an asociacija were not checked.
- **Pending law, not in force on 2026-11-25:** Omnibus IV (Art 30(5)), awaiting Parliament's first reading. The Digital Omnibus has a Council mandate of 21–22 Oct 2026 (https://data.consilium.europa.eu/doc/document/ST-14756-2026-INIT/en/html) with no Parliament position. It would change cookie exemptions and breach deadlines. Recheck before launch.
