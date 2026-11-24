// Who is a Member: a person who has finished the welcome step and connected a Lichess account (see GLOSSARY.md).
// Anyone else is part-way through signing up, and is not counted, listed or shown anywhere as a Member.

// The condition on "user" for every query that counts, lists or shows Members.
export const MEMBER_SQL = `"publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null and "lichessId" is not null`;

// The column on "user" holding when each Member became one, which is their sign-up time: the first time they
// connected Lichess. Swapping to another Lichess account keeps it.
export const MEMBER_SINCE = `"lichessConnectedAt"`;

// A signed-in person who has finished the welcome step but not connected Lichess is sent to the connect step.
export const mustConnectLichess = (person: { lichessId?: string | null }) => !person.lichessId;
