import { ExternalLink } from "../external-link";
import ui from "../ui.module.css";
import { teamRemovalDone } from "./actions";
import styles from "./organiser.module.css";
import type { TeamRemoval } from "@/lib/leaving";
import { lichessTeamKickUrl } from "@/lib/lichess";

// The Lichess accounts of people who left the Club that the site could not remove from the Club's Lichess team, oldest
// first, each with why and a button for once the Organiser has removed it on Lichess, which forgets it. Nothing at all
// when there are none.
export function TeamRemovals({ removals }: { removals: TeamRemoval[] }) {
  if (removals.length === 0) return null;
  const teamId = process.env.LICHESS_TEAM_ID;
  return (
    <section aria-labelledby="removals" className={styles.section}>
      <h2 id="removals">Remove from the Lichess team</h2>
      <p>
        These people left the Club, but the site couldn&apos;t remove them from the Club&apos;s Lichess team. Remove each
        one on Lichess, then press Done.
      </p>
      {teamId && (
        <p>
          <ExternalLink href={lichessTeamKickUrl(teamId)}>Remove members on Lichess</ExternalLink>
        </p>
      )}
      <ul role="list">
        {removals.map(({ lichessId, problem }) => (
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
  );
}
