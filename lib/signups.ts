import { db } from "./db";

// Everyone who has finished the welcome step counts as a sign-up for now.
// Once Lichess can be connected, this should count only Members.
export async function countSignUps(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from "user" where "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null`,
  );
  return rows[0].n;
}
