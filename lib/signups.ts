import { db, type Queryable } from "./db";
import { MEMBER_SINCE, MEMBER_SQL } from "./members";

// A sign-up is a Member: someone part-way through signing up is not counted.
export async function countSignUps(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from "user" where ${MEMBER_SQL}`);
  return rows[0].n;
}

// When each sign-up happened, for working out Season 1's start.
export async function signUpTimes(q: Queryable = db): Promise<Date[]> {
  const { rows } = await q.query<{ at: Date }>(`select ${MEMBER_SINCE} as at from "user" where ${MEMBER_SQL}`);
  return rows.map((row) => row.at);
}
