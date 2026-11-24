// The welcome step: before anything else, a person agrees that their name and Company appear publicly
// and accepts the house rules. Each is recorded as the time it was given.

export type Consent = { publicDisplayConsentAt?: Date | null; houseRulesAcceptedAt?: Date | null };

// A signed-in person who has not given both is sent to the welcome page.
export const mustWelcome = (person: Consent) => !person.publicDisplayConsentAt || !person.houseRulesAcceptedAt;

// Why a submitted welcome form cannot be accepted, or null when both boxes were ticked.
export function consentProblem(form: { get(name: string): unknown }): string | null {
  if (form.get("publicDisplay") !== "yes")
    return "Please agree that your name and Company will appear publicly on Leaderboards.";
  if (form.get("houseRules") !== "yes") return "Please accept the house rules.";
  return null;
}
