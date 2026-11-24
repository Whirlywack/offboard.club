import { db } from "./db";
import { MEMBER_SQL } from "./members";

// A sign-up is a Member: someone part-way through signing up is not counted.
export async function countSignUps(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from "user" where ${MEMBER_SQL}`);
  return rows[0].n;
}
