import type { Metadata } from "next";
import { Suspense } from "react";
import { RuledLinks } from "../../ruled-links";
import ui from "../../ui.module.css";
import { removeFromClub } from "../actions";
import { RemoveActions } from "../forms";
import styles from "../organiser.module.css";
import { getProfile, getSession, requireOrganiser } from "@/lib/auth";
import { MEMBER_ID_MAX, NOT_YOURSELF } from "@/lib/leaving";
import { isOrganiser } from "@/lib/organiser";
import { noticeLater } from "@/lib/request-failures";

// To anyone but the Organiser the page does not exist, as the Organiser page does not.
export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession().catch((error: unknown) => void noticeLater(error, "/organiser/remove"));
  return { title: isOrganiser(session?.user) ? "Remove a Member" : "Page not found" };
}

// Server Actions run within their page's limit: removing a Member waits on Lichess for up to 25 s to take them off the
// team, and as long again to revoke a permission they gave (lib/leaving.ts).
export const maxDuration = 60;

// The step that confirms removing a Member, reached from the Organiser page with the Member chosen (?member=<their id>),
// on a page of its own so that it opens at the top. Nothing is removed until its button is pressed. Anyone but the
// Organiser gets the not-found page, as on the Organiser page, and nothing of it is in the static shell.
export default function RemovePage({ searchParams }: PageProps<"/organiser/remove">) {
  return (
    <Suspense>
      <Confirm searchParams={searchParams} />
    </Suspense>
  );
}

async function Confirm({ searchParams }: Pick<PageProps<"/organiser/remove">, "searchParams">) {
  const { id } = await requireOrganiser();
  const { member } = await searchParams;
  const chosen = typeof member === "string" && member.length <= MEMBER_ID_MAX ? member : null;
  const person = chosen && chosen !== id ? await getProfile(chosen) : null;
  return (
    <main id="main" className={styles.page}>
      <div className={styles.top}>
        <div>
          <h1 className={ui.display}>
            <em>Remove</em> a Member
          </h1>
          {person && <p className={styles.lede}>This can&apos;t be undone.</p>}
        </div>
        {person ? (
          // What goes and what stays, as when a Member deletes their own account (app/profile/leave), then the choice.
          <form action={removeFromClub} className={styles.confirm}>
            <input type="hidden" name="memberId" value={person.id} />
            <p className={styles.question}>
              Remove <strong>{person.name}</strong>
              {person.company && <>, {person.company.name}</>}, {person.lichessUsername} on Lichess?
            </p>
            <ul className={styles.list}>
              <li>They disappear from every Leaderboard and Recap, including past ones.</li>
              <li>Their name, photo and Profile are deleted.</li>
              <li>The site asks Lichess to remove their account from the Club&apos;s team.</li>
              <li>Other Members keep their Games against them, shown as &ldquo;a&nbsp;former member&rdquo;.</li>
            </ul>
            <p>Nothing stops them signing up again.</p>
            <RemoveActions name={person.name} />
          </form>
        ) : (
          <>
            <p role="alert" className={styles.needs}>
              {chosen === id ? NOT_YOURSELF : "That Member isn't in the Club."}
            </p>
            <nav aria-label="More" className={styles.more}>
              <RuledLinks links={[["/organiser", "Back to the Organiser page"]]} />
            </nav>
          </>
        )}
      </div>
    </main>
  );
}
