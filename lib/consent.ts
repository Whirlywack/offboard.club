// The welcome step: before anything else, a person accepts that their name and Company appear publicly, which is a
// condition of membership, and accepts the house rules. Each is recorded as the time it was given.

export type Consent = { publicDisplayConsentAt?: Date | null; houseRulesAcceptedAt?: Date | null };

// The house rules as a Member accepts them, on the welcome step and in the terms on /privacy.
export const HOUSE_RULES = [
  "No outside help during Games, such as an engine, an analysis board or a friend's advice.",
  "No sales or recruiting pitches, unless the other person's “open to” line invites it.",
];

// A signed-in person who has not given both is sent to the welcome page.
export const mustWelcome = (person: Consent) => !person.publicDisplayConsentAt || !person.houseRulesAcceptedAt;

// Why a submitted welcome form cannot be accepted, or null when both boxes were ticked.
export function consentProblem(form: { get(name: string): unknown }): string | null {
  if (form.get("publicDisplay") !== "yes")
    return "To join, please tick the box accepting that your name and Company appear publicly.";
  if (form.get("houseRules") !== "yes") return "To join, please tick the box accepting the house rules.";
  return null;
}
