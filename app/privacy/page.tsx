import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "../external-link";
import ui from "../ui.module.css";
import styles from "./privacy.module.css";
import { organiserEmail } from "@/lib/contact";
import { HOUSE_RULES } from "@/lib/consent";

export const metadata: Metadata = {
  title: "Privacy and terms",
  description: "What Offboard keeps about you, who sees it, and the terms of membership.",
};

// What the site keeps, who sees it and the terms of membership, for anyone, signed in or not. Every statement rests on
// research/privacy-policy-requirements.md and the code as it is; docs/record-of-processing.md is the same, in full, for
// the Organiser. It names no person: the welcome step shows the Organiser's name to someone about to join. The first
// three sections are the short version: who to write to, who sees what, and how to leave.
export default function PrivacyPage() {
  const contact = organiserEmail();
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>Privacy and terms</h1>
        <p className={`${ui.small} ${ui.muted}`}>
          Last changed <time dateTime="2026-11-25">25 November 2026</time>.
        </p>
      </div>

      <section aria-labelledby="who" className={styles.section}>
        <h2 id="who">Who runs Offboard</h2>
        <p>
          Offboard is run by one volunteer, the Organiser, who is responsible for what the site keeps (its
          &ldquo;controller&rdquo;, in GDPR terms). You&apos;ll see the Organiser&apos;s name on the welcome step, before
          you agree to anything.
        </p>
        {contact ? (
          <p>
            Write to the Organiser at <a href={`mailto:${contact}`}>{contact}</a> about anything on this page.
          </p>
        ) : (
          <p>The Organiser&apos;s contact address isn&apos;t set up yet.</p>
        )}
      </section>

      <section aria-labelledby="public" className={styles.section}>
        <h2 id="public">Who sees what</h2>
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
            <strong>The Club&apos;s Telegram group,</strong> whose invite link only Members see: each Recap&apos;s top three
            and Award winners, with their Companies, as the site&apos;s bot posts them.
          </li>
          <li>
            <strong>Only the Organiser,</strong> who can read everything the site keeps: your email address, IP address
            and browser, and whether Lichess has marked or closed your account.
          </li>
        </ul>
        <p>Being listed in public is a condition of membership, so objecting to it means leaving the Club.</p>
        <p>Lichess shows your username and Games publicly on its own site.</p>
      </section>

      <section aria-labelledby="leaving" className={styles.section}>
        <h2 id="leaving">Leaving</h2>
        <p>
          To leave, choose &ldquo;Delete your account&rdquo; on <Link href="/profile">Edit your Profile</Link>. Your
          account, Profile, Lichess connection, results and acceptances are deleted at once, and you&apos;re signed out and
          taken off every Leaderboard, Recap and Award. The site asks Lichess to remove the Lichess account you have
          connected from the Club&apos;s Lichess team.
        </p>
        <p>
          Your Games stay in your opponents&apos; histories, against &ldquo;a former member&rdquo;, with the Game&apos;s id
          on Lichess and both ratings. An Award someone won against you stays theirs, and its Game is no longer shown. Your
          Lichess account and its Games stay as they are, and so do Recaps already posted to the Telegram group.
        </p>
      </section>

      <section aria-labelledby="kept" className={styles.section}>
        <h2 id="kept">What Offboard keeps</h2>
        <ul>
          <li>
            <strong>From LinkedIn, at each sign-in:</strong> your name, the address of your photo, your email address and
            LinkedIn&apos;s id for you. LinkedIn&apos;s sign-in tokens are not kept.
          </li>
          <li>
            <strong>From Lichess, when you connect it:</strong> your account&apos;s id, username and blitz rating. After
            each Matchday you play, the rating is checked again, along with whether Lichess has marked or closed the
            account. The permission you give on Lichess reads your account and joins the Club&apos;s team, then is
            revoked.
          </li>
          <li>
            <strong>From each Matchday you play, as Lichess records it:</strong> your place, points and rating that night,
            your Company at the time, and your Games against other Members.
          </li>
          <li>
            <strong>From your Profile, all optional:</strong> your Company&apos;s website, from which the site fetches the
            Company&apos;s name and logo; your position; your LinkedIn profile link; your &ldquo;open to&rdquo; line.
          </li>
          <li>
            <strong>From the welcome step:</strong> when you accepted the terms of membership and the house rules.
          </li>
          <li>
            <strong>From each sign-in:</strong> when it began and when it expires, your IP address, and your
            browser&apos;s user agent, which names your browser, operating system and device.
          </li>
        </ul>
        <p>Offboard sends no email, and no page shows your email address.</p>
      </section>

      <section aria-labelledby="why" className={styles.section}>
        <h2 id="why">Why it&apos;s kept</h2>
        <ul>
          <li>
            <strong>Running your membership:</strong> your account, sign-in, Profile, Matchdays and Games are what you
            join for (contract, GDPR Art. 6(1)(b)).
          </li>
          <li>
            <strong>Legitimate interests</strong> (GDPR Art. 6(1)(f)):
            <ul>
              <li>
                Your name and Company in public, so people deciding whether to join can see the Club. Since it&apos;s a
                condition of membership, objecting to it means leaving.
              </li>
              <li>Fair play: keeping Leaderboards honest.</li>
              <li>
                Security: keeping accounts and the site safe, with each sign-in&apos;s IP address and browser and the hosting
                provider&apos;s logs.
              </li>
              <li>Your Games after you leave: your opponents keep their own record.</li>
            </ul>
          </li>
        </ul>
      </section>

      <section aria-labelledby="others" className={styles.section}>
        <h2 id="others">Who else handles it</h2>
        <ul>
          <li>
            <strong>Vercel</strong> hosts the site, on servers in Frankfurt, and builds it in Washington, D.C., USA. The
            build connects to the database only to update its structure, and reads nobody&apos;s data.
          </li>
          <li>
            <strong>Neon</strong>, part of Databricks, hosts the database in Frankfurt. Some of its support staff and
            subcontractors are in the USA.
          </li>
          <li>
            <strong>LinkedIn</strong> signs you in. Members&apos; browsers load your photo from LinkedIn, so LinkedIn sees
            their IP address.
          </li>
          <li>
            <strong>Lichess</strong>, a French non-profit with servers in the EU, hosts the Matchdays, their Games and the
            Club&apos;s private team. Opening an Award&apos;s Game loads Lichess&apos;s board from lichess.org.
          </li>
          <li>
            <strong>Telegram</strong> runs the Club&apos;s group, which Members join if they want to, and keeps what the bot
            posts there.
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
      </section>

      <section aria-labelledby="how-long" className={styles.section}>
        <h2 id="how-long">How long it&apos;s kept</h2>
        <ul>
          <li>Your account, Profile, Lichess connection, results and acceptances: while you&apos;re a Member.</li>
          <li>Each sign-in&apos;s record, with its IP address and browser: until you sign out of it or leave.</li>
          <li>
            If the site can&apos;t remove your Lichess account from the Club&apos;s team when you leave: the account&apos;s
            id, until the Organiser has removed it by hand.
          </li>
          <li>
            If you signed in but didn&apos;t finish joining: what came from LinkedIn, your sign-in records and any
            acceptances, until you choose &ldquo;Delete your account&rdquo; on the sign-up step you stopped at.
          </li>
          <li>The site&apos;s copy of a Recap&apos;s post to the Telegram group: until the next Matchday starts.</li>
          <li>Deleted data stays in the database provider&apos;s restore history for up to 6 hours.</li>
          <li>The hosting provider&apos;s logs of requests and errors: 1 day.</li>
        </ul>
      </section>

      <section aria-labelledby="rights" className={styles.section}>
        <h2 id="rights">Your rights</h2>
        <ul>
          <li>
            Change or clear what you added to your Profile at any time, on <Link href="/profile">Edit your Profile</Link>.
          </li>
          <li>Your name and photo come from LinkedIn. Change them there and they change here the next time you sign in.</li>
          <li>
            Under the GDPR you can also <a href="#who">ask the Organiser</a> for a copy of your data, including one a
            computer can read, and ask them to correct it, delete it or limit how it&apos;s used. And you can object to how
            it&apos;s used.
          </li>
        </ul>
      </section>

      <section aria-labelledby="complaints" className={styles.section}>
        <h2 id="complaints">Complaints</h2>
        <p>
          Please write to the Organiser first. You can also complain to the data protection authority of the EU country you
          live in, or to Lithuania&apos;s State Data Protection Inspectorate (Valstybinė duomenų apsaugos inspekcija,{" "}
          <ExternalLink href="https://vdai.lrv.lt/en">vdai.lrv.lt</ExternalLink>).
        </p>
      </section>

      <section aria-labelledby="cookies" className={styles.section}>
        <h2 id="cookies">Cookies</h2>
        <p>
          The site has no ads, analytics or tracking, and reading it sets no cookies. Signing in and connecting Lichess set
          the cookies below, and nothing else is stored in your browser.
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
            <code>offboard-organiser-lichess</code> for the Organiser): remembers that step for up to 10 minutes, and is
            removed when you come back from Lichess.
          </li>
        </ul>
      </section>

      <section aria-labelledby="fair-play" className={styles.section}>
        <h2 id="fair-play">Fair play</h2>
        <p>
          If Lichess marks your account for breaking its terms, or closes it, you&apos;re left off Leaderboards and Awards
          while that lasts. This is the only thing the site decides about you automatically, and it has no legal or similar
          effect.
        </p>
      </section>

      <section aria-labelledby="terms" className={styles.section}>
        <h2 id="terms">Terms of membership</h2>
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
      </section>

      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
