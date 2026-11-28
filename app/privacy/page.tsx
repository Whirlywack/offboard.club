import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink } from "../external-link";
import { RuledLinks } from "../ruled-links";
import styles from "./privacy.module.css";
import { organiserEmail } from "@/lib/contact";
import { HOUSE_RULES } from "@/lib/consent";

export const metadata: Metadata = {
  title: "Privacy and terms",
  description: "What Offboard keeps about you, who sees it, and the terms of membership.",
};

// The sections in order, by their heading's id: their headings, and the list of them at the top that leads to each.
const SECTIONS = {
  who: "Who runs Offboard",
  public: "Who sees what",
  leaving: "Leaving",
  kept: "What Offboard keeps",
  why: "Why it's kept",
  others: "Who else handles it",
  "how-long": "How long it's kept",
  rights: "Your rights",
  complaints: "Complaints",
  cookies: "Cookies",
  "fair-play": "Fair play",
  terms: "Terms of membership",
};

function Section({ id, children }: { id: keyof typeof SECTIONS; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id}>{SECTIONS[id]}</h2>
      {children}
    </section>
  );
}

// What the site keeps, who sees it and the terms of membership, for anyone, signed in or not. Every statement rests on
// research/privacy-policy-requirements.md and the code as it is; docs/record-of-processing.md is the same, in full, for
// the Organiser. It names no person: the welcome step shows the Organiser's name to someone about to join. The first
// three sections are the short version: who to write to, who sees what, and how to leave. A reader goes straight to a
// section from the list of headings at the top, which on a desktop stays beside the text.
export default function PrivacyPage() {
  const contact = organiserEmail();
  return (
    <main id="main" className={styles.page}>
      <div className={styles.head}>
        <h1>Privacy and terms</h1>
        <p className={styles.changed}>
          Last changed <time dateTime="2026-11-28">28 November 2026</time>.
        </p>
      </div>

      <nav
        aria-label="Privacy and terms"
        className={styles.contents}
        style={{ gridRowEnd: `span ${Object.keys(SECTIONS).length}` }}
      >
        <ul>
          {Object.entries(SECTIONS).map(([id, heading]) => (
            <li key={id}>
              <a href={`#${id}`}>
                <span>{heading}</span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M8 2.5v11M3.5 9 8 13.5 12.5 9" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="who">
        <p>
          Offboard is run by one volunteer, the Organiser, who is responsible for what the site keeps (its
          &ldquo;controller&rdquo;, in GDPR terms). The welcome step shows their name before you agree to anything.
        </p>
        {contact ? (
          <p>
            Write to the Organiser at <a href={`mailto:${contact}`}>{contact}</a> about anything on this page.
          </p>
        ) : (
          <p>The Organiser&apos;s contact address isn&apos;t set up yet.</p>
        )}
      </Section>

      <Section id="public">
        <ul>
          <li>
            <strong>Anyone:</strong> your name and Company, with your place, points, Season score, Matchdays played and
            Awards, on Leaderboards, in Recaps and as Season champion.
          </li>
          <li>
            <strong>Signed-in Members:</strong> also your photo, Profile, Lichess username, blitz rating and Games, with
            links to them on Lichess.
          </li>
          <li>
            <strong>The Club&apos;s Telegram group,</strong> whose invite link only Members see: the names and points of
            each Recap&apos;s top three, and each Award&apos;s winner by name, with what they won it for.
          </li>
          <li>
            <strong>Only the Organiser,</strong> who can read everything the site keeps: your email address, IP address
            and browser, and whether Lichess has marked or closed your account.
          </li>
        </ul>
        <p>Being listed in public is a condition of membership, so objecting to it means leaving the Club.</p>
        <p>Lichess shows your username and Games publicly on its own site.</p>
      </Section>

      <Section id="leaving">
        <p>
          To leave, choose &ldquo;Delete your account&rdquo; on <Link href="/profile">Edit your Profile</Link>. That
          deletes your account, Profile, Lichess connection, results and acceptances at once, signs you out and takes you
          off every Leaderboard, Recap and Award. The site asks Lichess to remove your Lichess account from the
          Club&apos;s team.
        </p>
        <p>
          Your Games stay in your opponents&apos; histories, against &ldquo;a former member&rdquo;, with the Game&apos;s
          Lichess id, its moves and both ratings. An Award someone won against you stays theirs, but its Game is no
          longer shown. Your Lichess account, its Games and Recaps already posted to the Telegram group stay as they are.
        </p>
      </Section>

      <Section id="kept">
        <ul>
          <li>
            <strong>From LinkedIn, at each sign-in:</strong> your name, a link to your photo, your email address, whether
            LinkedIn has verified it, and LinkedIn&apos;s id for you, but not its sign-in tokens.
          </li>
          <li>
            <strong>From Lichess, when you connect it:</strong> your account&apos;s id, username and blitz rating, and when
            you first connected it. After each Matchday you play, the site checks the rating again, and whether Lichess has marked or closed the account.
            The permission you give on Lichess is used to read your account and join the Club&apos;s team, then revoked.
          </li>
          <li>
            <strong>From each Matchday you play, as Lichess records it:</strong> your place, points and rating that night,
            your Company at the time, and your Games against other Members, with their moves.
          </li>
          <li>
            <strong>From your Profile, all optional:</strong> your Company&apos;s website, from which the site fetches its
            name and logo; your position; your LinkedIn profile link; your &ldquo;open to&rdquo; line. The site also keeps
            the date you last added a new Company and how many you added that day, as it allows five a day.
          </li>
          <li>
            <strong>From the welcome step:</strong> when you accepted the terms of membership and the house rules.
          </li>
          <li>
            <strong>From each sign-in:</strong> when it began and expires, your IP address, and your
            browser&apos;s user agent, which names your browser, operating system and device.
          </li>
        </ul>
        <p>Offboard sends no email, and no page shows your email address.</p>
      </Section>

      <Section id="why">
        <ul>
          <li>
            <strong>Running your membership:</strong> your account, sign-in, Profile, Matchdays and Games are what you
            join for (contract, GDPR Art. 6(1)(b)).
          </li>
          <li>
            <strong>Legitimate interests</strong> (GDPR Art. 6(1)(f)):
            <ul>
              <li>Your name and Company in public, so people deciding whether to join can see the Club.</li>
              <li>Fair play: keeping Leaderboards honest.</li>
              <li>
                Security: keeping accounts and the site safe, with each sign-in&apos;s IP address and browser and
                Vercel&apos;s logs.
              </li>
              <li>Your Games after you leave: your opponents keep their own record.</li>
            </ul>
          </li>
        </ul>
      </Section>

      <Section id="others">
        <ul>
          <li>
            <strong>Vercel</strong> hosts the site in Frankfurt and builds it in Washington, D.C., USA. The build connects
            to the database only to update its structure, and reads nobody&apos;s data.
          </li>
          <li>
            <strong>Neon</strong>, part of Databricks, hosts the database in Frankfurt, with some support staff and
            subcontractors in the USA.
          </li>
          <li>
            <strong>LinkedIn</strong> (LinkedIn Ireland) signs you in. Members&apos; browsers load your photo from
            LinkedIn, which sees their IP address.
          </li>
          <li>
            <strong>Lichess</strong>, a French non-profit with servers in the EU, hosts the Matchdays, their Games and the
            Club&apos;s private team. Opening an Award&apos;s Game loads Lichess&apos;s board from lichess.org.
          </li>
          <li>
            <strong>Telegram</strong> runs the Club&apos;s group, which Members join if they want to, and keeps what the
            site&apos;s bot posts there. Telegram says it keeps the data of people who signed up in the EEA in the
            Netherlands, but names no place for groups.
          </li>
        </ul>
        <p>
          Vercel and Databricks are US companies, so some data may be handled in the USA. Both are certified under the
          EU-U.S. Data Privacy Framework, and their data processing agreements (
          <ExternalLink href="https://vercel.com/legal/dpa">Vercel&apos;s</ExternalLink>,{" "}
          <ExternalLink href="https://www.databricks.com/legal/databricks-data-processing-addendum">
            Databricks&apos;
          </ExternalLink>
          ) use the EU&apos;s Standard Contractual Clauses.
        </p>
      </Section>

      <Section id="how-long">
        <ul>
          <li>Your account, Profile, Lichess connection, results and acceptances: while you&apos;re a Member.</li>
          <li>Each sign-in&apos;s record, with its IP address and browser: until you sign out of it or leave.</li>
          <li>
            If the site can&apos;t remove your Lichess account from the Club&apos;s team when you leave: its id, until the
            Organiser removes it by hand.
          </li>
          <li>
            If you signed in but didn&apos;t finish joining: what came from LinkedIn, your sign-in records and any
            acceptances, until you choose &ldquo;Delete your account&rdquo; on the sign-up step you stopped at.
          </li>
          <li>The site&apos;s copy of a Recap&apos;s post to the Telegram group: until the next Matchday starts.</li>
          <li>
            Deleted data: up to 6 hours in Neon&apos;s restore history, and up to 14 days in the nightly database backups,
            which Vercel keeps in Frankfurt.
          </li>
          <li>Vercel&apos;s logs of requests and errors: 1 day.</li>
        </ul>
      </Section>

      <Section id="rights">
        <ul>
          <li>
            Change or clear what you added to your Profile at any time, on <Link href="/profile">Edit your Profile</Link>.
          </li>
          <li>Your name and photo come from LinkedIn: change them there, and they change here at your next sign-in.</li>
          <li>
            Under the GDPR you can also <a href="#who">ask the Organiser</a> for a copy of your data, including one a
            computer can read, ask them to correct it, delete it or limit its use, and object to its use.
          </li>
        </ul>
      </Section>

      <Section id="complaints">
        <p>
          Please write to the Organiser first. You can also complain to the data protection authority of the EU country you
          live in, or to Lithuania&apos;s State Data Protection Inspectorate (Valstybinė duomenų apsaugos inspekcija,{" "}
          <ExternalLink href="https://vdai.lrv.lt/en">vdai.lrv.lt</ExternalLink>).
        </p>
      </Section>

      <Section id="cookies">
        <p>
          The site has no ads, analytics or tracking. Reading it sets no cookies. Only signing in and connecting Lichess
          do, and nothing else is stored in your browser.
        </p>
        <ul>
          <li>
            <strong>Your sign-in</strong> (<code>__Secure-better-auth.session_token</code>): keeps you signed in for 7
            days. Signing out removes it.
          </li>
          <li>
            <strong>While you sign in</strong> (<code>__Secure-better-auth.state</code>): protects that step from forgery,
            for up to 5 minutes.
          </li>
          <li>
            <strong>While you connect Lichess</strong> (<code>offboard-lichess</code>, or{" "}
            <code>offboard-organiser-lichess</code> for the Organiser): remembers that step until you come back from
            Lichess, for up to 10 minutes.
          </li>
        </ul>
      </Section>

      <Section id="fair-play">
        <p>
          While Lichess has your account marked for breaking its terms, or closed, you&apos;re left off Leaderboards and
          Awards. This is the only thing the site decides about you automatically, and it has no legal or similar effect.
        </p>
      </Section>

      <Section id="terms">
        <ul>
          <li>
            <strong>Who may join:</strong> anyone 18 or over who works in tech in or around Vilnius. Each Member connects
            one Lichess account, which no other Member may use.
          </li>
          <li>
            <strong>Public listing:</strong> your name, and your Company if you add one, appear publicly on Leaderboards, in
            Recaps and Awards, and as Season champion, for as long as you&apos;re a Member. You can leave at any time.
          </li>
          <li>
            <strong>House rules:</strong>
            <ol>
              {HOUSE_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
            Lichess&apos;s own terms apply to the Games you play there.
          </li>
          <li>
            <strong>Removal:</strong> the Organiser can remove a Member who breaks a house rule or doesn&apos;t belong. That
            deletes their account, as leaving does.
          </li>
          <li>
            <strong>Free, with no prizes.</strong>
          </li>
          <li>
            <strong>Liability:</strong> Offboard comes as it is, without warranty, and the Organiser&apos;s liability is
            limited as far as the law allows. Nothing here limits liability for intent, gross negligence, or harm to life or
            health.
          </li>
          <li>
            <strong>Changes:</strong> the Club may change or stop at any time, and no Matchday is guaranteed. When this page
            changes, so does the date at the top.
          </li>
          <li>
            <strong>Law:</strong> Lithuanian.
          </li>
        </ul>
      </Section>

      <nav aria-label="More" className={styles.home}>
        <RuledLinks links={[["/", "Home"]]} />
      </nav>
    </main>
  );
}
