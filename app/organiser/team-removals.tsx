import { ExternalLink } from "../external-link";
import ui from "../ui.module.css";
import { teamRemovalDone } from "./actions";
import styles from "./organiser.module.css";
import type { TeamRemoval } from "@/lib/leaving";
import { lichessTeamKickUrl } from "@/lib/lichess";

// The Lichess accounts kept for the Organiser (lib/leaving.ts), oldest first, each with why. Those no Member has, of
// people who left the Club or switched to another account, are to remove from the Club's Lichess team by hand, each
// with a button for once the Organiser has, which forgets it. Those a Member has are out of the team: the Member is
// named, to ask to connect Lichess again. Nothing at all when there are none.
export function TeamRemovals({ removals }: { removals: TeamRemoval[] }) {
  const toRemove = removals.filter((r) => r.heldBy === null);
  const outOfTeam = removals.filter((r) => r.heldBy !== null);
  const teamId = process.env.LICHESS_TEAM_ID;
  return (
    <>
      {outOfTeam.length > 0 && (
        <section aria-labelledby="rejoin" className={styles.section}>
          <h2 id="rejoin">Not in the Lichess team</h2>
          <ul role="list">
            {outOfTeam.map(({ lichessId, problem, heldBy }) => (
              <li key={lichessId} className={styles.part}>
                <h3>{heldBy}</h3>
                <p className={styles.detail}>
                  {lichessId}: {problem}
                </p>
                <p>Ask {heldBy} to connect Lichess again, from their Profile.</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {toRemove.length > 0 && (
        <section aria-labelledby="removals" className={styles.section}>
          <h2 id="removals">Remove from the Lichess team</h2>
          <p>
            No Member uses these Lichess accounts any more, but the site couldn&apos;t remove them from the Club&apos;s
            Lichess team. Remove each one on Lichess, then press Done.
          </p>
          {teamId && (
            <p>
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
