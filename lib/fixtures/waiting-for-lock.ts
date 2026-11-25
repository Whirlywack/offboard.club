// For the *.postgres.test.ts cases that run two requests at once, each on its own connection.
import type pg from "pg";

// Settles once the connection whose backend is `pid` is waiting for a lock another holds, as `watcher` sees it from
// outside any transaction (inside one, Postgres shows what it saw first), or once `done` has settled.
export async function waitingForLock(watcher: pg.Client, pid: number, done?: Promise<unknown>) {
  let settled = false;
  done?.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let tries = 0; tries < 500 && !settled; tries++) {
    const { rows } = await watcher.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!settled) throw new Error("It never waited for a lock.");
}
