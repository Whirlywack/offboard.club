// Kept apart from lib/db.ts so that tests replacing the database with lib/fake-db.ts still run this code.
import { db, type Queryable } from "./db";

// Runs `work` on one connection inside a transaction: committed if it returns, rolled back if it throws.
export async function inTransaction<T>(work: (q: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let broken: Error | undefined;
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    // A connection that cannot even roll back is closed rather than handed to the next caller.
    await client.query("rollback").catch((rollbackError: Error) => (broken = rollbackError));
    throw error;
  } finally {
    client.release(broken);
  }
}
