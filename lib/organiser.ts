// Who the Organiser is: the one Member whose person id ("user".id) is ORGANISER_USER_ID. There is no role system
// (spec #1). Everything only the Organiser may see or do checks it on the server (requireOrganiser, in lib/auth.ts);
// to anyone else it does not exist.

import { mustWelcome } from "./consent";
import { db } from "./db";
import { MEMBER_SQL, mustConnectLichess } from "./members";

export const organiserId = () => process.env.ORGANISER_USER_ID || null;

type Person = { id: string; publicDisplayConsentAt?: Date | null; houseRulesAcceptedAt?: Date | null; lichessId?: string | null };

// The configured person, once they are a Member. Nobody is while ORGANISER_USER_ID is unset.
export const isOrganiser = (person: Person | null | undefined): boolean =>
  !!person && person.id === organiserId() && !mustWelcome(person) && !mustConnectLichess(person);

// The Organiser's name from their own account, which the welcome step shows so that a newcomer knows who runs the Club
// before they agree to anything. Null while there is no Organiser, as for isOrganiser: an unset id matches nobody.
export async function organiserName(): Promise<string | null> {
  const { rows } = await db.query<{ name: string }>(`select name from "user" where id = $1 and ${MEMBER_SQL}`, [organiserId()]);
  return rows[0]?.name ?? null;
}
