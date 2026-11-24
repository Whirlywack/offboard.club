// Who the Organiser is: the one Member whose person id ("user".id) is ORGANISER_USER_ID. There is no role system
// (spec #1). Everything only the Organiser may see or do checks it on the server (requireOrganiser, in lib/auth.ts);
// to anyone else it does not exist.

import { mustWelcome } from "./consent";
import { mustConnectLichess } from "./members";

export const organiserId = () => process.env.ORGANISER_USER_ID || null;

type Person = { id: string; publicDisplayConsentAt?: Date | null; houseRulesAcceptedAt?: Date | null; lichessId?: string | null };

// The configured person, once they are a Member. Nobody is while ORGANISER_USER_ID is unset.
export const isOrganiser = (person: Person | null | undefined): boolean =>
  !!person && person.id === organiserId() && !mustWelcome(person) && !mustConnectLichess(person);
