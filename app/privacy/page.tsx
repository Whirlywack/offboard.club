import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "../external-link";
import ui from "../ui.module.css";
import styles from "./privacy.module.css";
import { organiserEmail } from "@/lib/contact";
import { HOUSE_RULES } from "@/lib/consent";

export const metadata: Metadata = { title: "Privacy and terms" };

// What the site keeps, who sees it and the terms of membership, for anyone, signed in or not. Every statement rests on
// research/privacy-policy-requirements.md and the code as it is; docs/record-of-processing.md is the same, in full, for
// the Organiser. It names no person: the welcome step shows the Organiser's name to someone about to join.
export default function PrivacyPage() {
  const contact = organiserEmail();
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>Privacy and terms</h1>
        <p className={ui.lede}>What Offboard keeps about you, who sees it, and what you accept when you join.</p>
        <p className={`${ui.small} ${ui.muted}`}>
          Last changed <time dateTime="2026-11-25">25 November 2026</time>.
        </p>
      </div>

      <section aria-labelledby="who" className={styles.section}>
        <h2 id="who">Who runs Offboard</h2>
        <p>
          Offboard is run by one volunteer, the Organiser. It is not a company, it is free, and it makes no money. The
          Organiser decides what the site keeps and why, so they are responsible for your data: the &ldquo;controller&rdquo;
          under the EU&apos;s data protection law, the GDPR. Anyone joining is shown the Organiser&apos;s name before they
          agree to anything.
        </p>
        {contact ? (
          <p>
            Write to the Organiser at <a href={`mailto:${contact}`}>{contact}</a> about anything on this page. It is free,
            and you will get an answer within a month.
          </p>
        ) : (
          <p>The Organiser&apos;s contact address isn&apos;t set up yet.</p>
        )}
      </section>

      <section aria-labelledby="summary" className={styles.section}>
        <h2 id="summary">In short</h2>
        <ul>
          <li>Anyone can see your name and Company on Leaderboards, in Recaps and Awards, and as Season champion.</li>
          <li>Only signed-in Members see your photo, your Profile, your Lichess account and your Games.</li>
          <li>Nobody sees your email address.</li>
          <li>There are no ads, no analytics and no tracking.</li>
          <li>You can leave the Club at any time, and your account is deleted.</li>
        </ul>
      </section>

      <section aria-labelledby="kept" className={styles.section}>
        <h2 id="kept">What Offboard keeps</h2>
        <ul>
          <li>
            <strong>From LinkedIn, when you sign in:</strong> your name, the address of your photo, your email address and
            LinkedIn&apos;s id for you. They are taken again each time you sign in. LinkedIn&apos;s sign-in tokens are not
            kept.
          </li>
          <li>
            <strong>From Lichess, when you connect it:</strong> your Lichess account&apos;s id and username, and your blitz
            rating. After each Matchday you play, the site looks again at your rating and at whether Lichess has marked or
            closed the account. The permission Lichess gives is used once, to add you to the Club&apos;s private Lichess
            team, and then revoked. It is never kept.
          </li>
          <li>
            <strong>From each Matchday you play, as Lichess records it:</strong> your place, points and rating that night,
            with your Company at the time; and your Games against other Members: who played whom, the result, how it ended,
            how many moves, both ratings, the winner&apos;s time left and when it finished, with the Game&apos;s id on
            Lichess.
          </li>
          <li>
            <strong>From you, on your Profile, all optional:</strong> your Company&apos;s website, from which the site
            fetches the Company&apos;s name and logo; your position; a link to your LinkedIn profile; and what you&apos;re
            open to.
          </li>
          <li>
            <strong>From the welcome step:</strong> when you accepted the terms of membership and the house rules.
          </li>
          <li>
            <strong>While you are signed in:</strong> a record of each sign-in, with when it expires, your IP address and
            your browser&apos;s name and version.
          </li>
        </ul>
        <p>
          Your email address is kept only because the sign-in software needs one for every account. Nothing uses it and
          nobody is shown it. Offboard sends no email and takes no payments.
        </p>
      </section>

      <section aria-labelledby="why" className={styles.section}>
        <h2 id="why">Why, and on what legal basis</h2>
        <ul>
          <li>
            <strong>Your account, sign-in, Profile, Matchdays, Games and Leaderboards:</strong> they are the membership you
            asked for (GDPR Article 6(1)(b), a contract).
          </li>
          <li>
            <strong>Your name and Company in public:</strong> the Club&apos;s legitimate interest in being visible to people
            deciding whether to join (Article 6(1)(f)). It is a condition of membership, which you accept when you join.
            You can object at any time. Since public listing is part of membership, the way to stop it is to leave the
            Club.
          </li>
          <li>
            <strong>Fair play:</strong> the legitimate interest in honest rankings, which is why an account Lichess has
            marked or closed is left off Leaderboards and Awards.
          </li>
          <li>
            <strong>Security:</strong> the legitimate interest in keeping accounts and the site safe, which is what the IP
            address and browser of each sign-in, and the hosting provider&apos;s logs, are for.
          </li>
          <li>
            <strong>Games after someone leaves:</strong> the other players&apos; legitimate interest in keeping their own
            record.
          </li>
        </ul>
      </section>

      <section aria-labelledby="public" className={styles.section}>
        <h2 id="public">What is public, and what only Members see</h2>
        <ul>
          <li>
            <strong>Anyone on the internet</strong> sees your name and Company on Leaderboards, in Recaps and Awards, and as
            Season champion, with your place, points, Season score, Matchdays played and any Award you win.
          </li>
          <li>
            <strong>Signed-in Members</strong> also see your photo and Profile, your Lichess username and blitz rating, your
            Games with links to them on Lichess, and Award Games on Lichess&apos;s board.
          </li>
          <li>
            <strong>Nobody</strong> is shown your email address, your IP address or browser, or whether your Lichess account
            is marked or closed. The Organiser can read everything the site keeps.
          </li>
        </ul>
        <p>
          Lichess shows your username and Games on its own site, as it does for every account. Offboard does not link your
          name to your Lichess account anywhere a visitor can see.
        </p>
      </section>

      <section aria-labelledby="others" className={styles.section}>
        <h2 id="others">Who else handles it</h2>
        <ul>
          <li>
            <strong>Vercel</strong> hosts the site. The servers that answer your requests are in Frankfurt. The site is
            built on Vercel&apos;s servers in Washington, D.C., USA, and the build connects to the database to update its
            structure without reading anyone&apos;s data.
          </li>
          <li>
            <strong>Neon</strong>, part of Databricks, hosts the database, in Frankfurt. Some of its support and
            subcontractors are in the USA.
          </li>
          <li>
            <strong>LinkedIn</strong> signs you in. Members&apos; browsers load your photo from LinkedIn&apos;s servers, so
            LinkedIn sees their IP address.
          </li>
          <li>
            <strong>Lichess</strong>, run by a French non-profit association on servers in the EU, hosts the Games, the
            Matchday tournaments and the Club&apos;s private team. A Member who opens an Award&apos;s Game loads
            Lichess&apos;s board from lichess.org.
          </li>
        </ul>
        <p>Vercel and Neon handle the data only for Offboard, under their data processing agreements. Nothing is sold.</p>
      </section>

      <section aria-labelledby="transfers" className={styles.section}>
        <h2 id="transfers">Outside the EU</h2>
        <p>
          Vercel and Databricks are US companies, so some data may be handled in the USA. Both are certified under the
          EU-U.S. Data Privacy Framework and use the EU&apos;s Standard Contractual Clauses. Their agreements are{" "}
          <ExternalLink href="https://vercel.com/legal/dpa">Vercel&apos;s</ExternalLink> and{" "}
          <ExternalLink href="https://www.databricks.com/legal/databricks-data-processing-addendum">
            Databricks&apos;
          </ExternalLink>
          .
        </p>
      </section>

      <section aria-labelledby="how-long" className={styles.section}>
        <h2 id="how-long">How long it is kept</h2>
        <ul>
          <li>
            Your account, Profile, Lichess connection, results and acceptances: while you are a Member. When you leave,
            they are deleted at once.
          </li>
          <li>
            Your Games: when you leave, your side of each Game is emptied. The Game stays in your opponents&apos; histories,
            shown as played against a former member, with its id on Lichess and both ratings.
          </li>
          <li>
            If the site cannot remove your Lichess account from the Club&apos;s Lichess team when you leave, it keeps a note
            of the account&apos;s id for the Organiser, who removes it by hand.
          </li>
          <li>Each sign-in&apos;s record, with its IP address and browser: until you sign out of it or leave the Club.</li>
          <li>
            If you signed in but did not finish joining, what came from LinkedIn stays until you ask the Organiser to delete
            it.
          </li>
          <li>Deleted data stays in the database provider&apos;s restore history for up to 6 hours.</li>
          <li>The hosting provider&apos;s logs of requests and errors: 1 day.</li>
        </ul>
      </section>

      <section aria-labelledby="rights" className={styles.section}>
        <h2 id="rights">Your rights and choices</h2>
        <ul>
          <li>
            Change or clear anything you added to your Profile at any time, on <Link href="/profile">Edit your
            Profile</Link>.
          </li>
          <li>Your name and photo come from LinkedIn: change them there, and they change here when you next sign in.</li>
          <li>
            Leave the Club at any time: on <Link href="/profile">Edit your Profile</Link>, choose &ldquo;Delete your
            account&rdquo;. That deletes your account, Profile and results at once, takes you off every Leaderboard, Recap
            and Award, removes your Lichess account from the Club&apos;s Lichess team, and signs you out. Games you played
            stay in other Members&apos; histories, against a former member. Your Lichess account and your Games on Lichess
            stay as they are.
          </li>
          <li>
            Under the GDPR you can also ask the Organiser for a copy of your data, to correct or delete it, to limit how it
            is used, to have it in a form a computer can read, or object to how it is used. <a href="#who">Write to the
            Organiser</a>.
          </li>
          <li>
            Nothing about you is decided automatically in a way that has legal or similar effects. The one automatic step
            is fair play, below.
          </li>
        </ul>
      </section>

      <section aria-labelledby="complaints" className={styles.section}>
        <h2 id="complaints">Complaints</h2>
        <p>
          Please write to the Organiser first. You can also complain to Lithuania&apos;s data protection authority, the State
          Data Protection Inspectorate (Valstybinė duomenų apsaugos inspekcija), or to the one in the EU country where you
          live.
        </p>
        <address>
          L. Sapiegos g. 17, LT-10312 Vilnius
          <br />
          <a href="mailto:ada@ada.lt">ada@ada.lt</a>, +370 5 271 2804
          <br />
          <ExternalLink href="https://vdai.lrv.lt/en">vdai.lrv.lt</ExternalLink>
        </address>
      </section>

      <section aria-labelledby="cookies" className={styles.section}>
        <h2 id="cookies">Cookies</h2>
        <p>Reading the site sets no cookie. All the cookies it sets are needed to sign in or to connect Lichess:</p>
        <ul>
          <li>
            <strong>Your sign-in</strong> (<code>__Secure-better-auth.session_token</code>): keeps you signed in for 7
            days, and is extended while you use the site. Signing out removes it.
          </li>
          <li>
            <strong>While you sign in</strong> (<code>__Secure-better-auth.state</code>): protects the step from forgery,
            for up to 5 minutes.
          </li>
          <li>
            <strong>While you connect Lichess</strong> (<code>offboard-lichess</code>, or{" "}
            <code>offboard-organiser-lichess</code> for the Organiser): remembers the step for up to 10 minutes, and is
            removed when you come back from Lichess.
          </li>
        </ul>
        <p>There are no tracking or advertising cookies, and the site stores nothing else in your browser.</p>
      </section>

      <section aria-labelledby="fair-play" className={styles.section}>
        <h2 id="fair-play">Fair play</h2>
        <p>
          If Lichess marks your account for breaking its terms, or closes it, you are left off Leaderboards and Awards
          while that lasts. Lichess decides; Offboard only reads what Lichess shows publicly, and never says why someone is
          not listed.
        </p>
      </section>

      <section aria-labelledby="terms" className={styles.section}>
        <h2 id="terms">Terms of membership</h2>
        <ul>
          <li>
            <strong>Who may join:</strong> anyone 18 or over who works in tech in or around Vilnius. Working in tech is
            self-declared, not checked. Each Member connects one Lichess account, which no other Member may use.
          </li>
          <li>
            <strong>Public listing:</strong> your name, and your Company if you add one, appear publicly on Leaderboards, in
            Recaps and Awards, and as Season champion, for as long as you are a Member.
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
            <strong>Removal:</strong> the Organiser can remove a Member who breaks a house rule or does not belong. That
            deletes their account, as leaving does.
          </li>
          <li>
            <strong>Free, with no prizes:</strong> the Season champion title carries none. The Club may change or stop at
            any time, and no Matchday is guaranteed.
          </li>
          <li>
            <strong>Liability:</strong> Offboard comes as it is, without any warranty, and the Organiser&apos;s liability is
            limited as far as the law allows. Nothing here limits liability for intent, for gross negligence, or for harm to
            life or health.
          </li>
          <li>
            <strong>Leaving:</strong> at any time, from <Link href="/profile">Edit your Profile</Link>.
          </li>
          <li>
            <strong>Changes:</strong> when this page changes, so does the date at the top.
          </li>
          <li>
            <strong>Law:</strong> Lithuanian law applies.
          </li>
        </ul>
      </section>

      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
