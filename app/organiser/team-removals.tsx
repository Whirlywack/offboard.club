import { ExternalLink } from "../external-link";
import ui from "../ui.module.css";
import { teamRemovalDone } from "./actions";
import styles from "./organiser.module.css";
import type { TeamRemoval } from "@/lib/leaving";
import { lichessTeamKickUrl } from "@/lib/lichess";

// The Lichess accounts kept for the Organiser (lib/leaving.ts), oldest first, each with why and a button for once the
// Organiser has dealt with it, which forgets it. Those no Member has, of people who left the Club or switched to
// another account, are to remove from the Club's Lichess team by hand. Those a Member has are out of the team: the
// Member is named, to ask to connect it again, which forgets it too. Each section is marked as needing the Organiser;
// nothing at all when there are none.
export function TeamRemovals({ removals }: { removals: TeamRemoval[] }) {
  const toRemove = removals.filter((r) => r.heldBy === null);
  const outOfTeam = removals.filter((r) => r.heldBy !== null);
  const teamId = process.env.LICHESS_TEAM_ID;
  return (
    <>
      {outOfTeam.length > 0 && (
        <section aria-labelledby="rejoin" className={`${styles.section} ${styles.byHand}`}>
          <h2 id="rejoin">Not in the Lichess team</h2>
          <ul role="list">
            {outOfTeam.map(({ lichessId, problem, heldBy }) => (
              <li key={lichessId} className={styles.part}>
                <h3>{heldBy}</h3>
                <p className={styles.detail}>
                  {lichessId}: {problem}
                </p>
                <p>
                  Ask {heldBy} to press Switch Lichess account on Edit your Profile, and choose {lichessId} again on
                  Lichess. Then press Done.
                </p>
                <form action={teamRemovalDone} className={ui.actions}>
                  <input type="hidden" name="lichessId" value={lichessId} />
                  <button className={ui.quiet}>
                    Done<span className="visually-hidden">: {heldBy} has been asked</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      {toRemove.length > 0 && (
        <section aria-labelledby="removals" className={`${styles.section} ${styles.byHand}`}>
          <h2 id="removals">Remove from the Lichess team</h2>
          <p>
            The site couldn&apos;t remove these accounts from the Club&apos;s Lichess team. Remove each on Lichess, then
            press Done.
          </p>
          {teamId && (
            <p className={styles.link}>
              <ExternalLink href={lichessTeamKickUrl(teamId)}>Remove members on Lichess</ExternalLink>
            </p>
          )}
          <ul role="list">
            {toRemove.map(({ lichessId, problem }) => (
              <li key={lichessId} className={styles.part}>
                <h3>{lichessId}</h3>
                <p className={styles.detail}>{problem}</p>
                <form action={teamRemovalDone} className={ui.actions}>
                  <input type="hidden" name="lichessId" value={lichessId} />
                  <button className={ui.quiet}>
                    Done<span className="visually-hidden">: {lichessId} is removed</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
