import { db, type Queryable } from "./db";

// Everyone who has finished the welcome step counts as a sign-up for now, from the moment they finished it.
// Once Lichess can be connected, this should count only Members.
const signedUp = `"publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null`;

export async function countSignUps(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from "user" where ${signedUp}`);
  return rows[0].n;
}

// When each sign-up happened, for working out Season 1's start.
export async function signUpTimes(q: Queryable = db): Promise<Date[]> {
  const { rows } = await q.query<{ at: Date }>(
    `select greatest("publicDisplayConsentAt", "houseRulesAcceptedAt") as at from "user" where ${signedUp}`,
  );
  return rows.map((row) => row.at);
}
