import net from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// A database that cannot be reached at all, to the site's one pool (lib/db.ts) and to a scheduled job that uses it
// (#55): here one that takes connections and never answers, the slowest way to fail, since one that refuses them fails at
// once. Every job's route allows 300 s (maxDuration) and holds the job for 15 minutes; each must answer well before.

const SECRET = "a-pretend-cron-secret-0123456789";
const silent = net.createServer(() => {});

beforeAll(async () => {
  await new Promise<void>((listening) => silent.listen(0, "127.0.0.1", listening));
  vi.stubEnv("DATABASE_URL", `postgres://offboard@127.0.0.1:${(silent.address() as net.AddressInfo).port}/offboard`);
  vi.stubEnv("CRON_SECRET", SECRET);
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  silent.close();
});

it("is given up on after two attempts of 10 s, and a scheduled job answers that its run failed and logs why", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const { db } = await import("./db");
  const { GET } = await import("@/app/api/jobs/create-matchdays/route");
  const started = Date.now();
  const [query, run] = await Promise.all([
    db.query("select 1").catch((error: Error) => error),
    GET(new Request("https://offboard.test/api/jobs/create-matchdays", { headers: { authorization: `Bearer ${SECRET}` } })),
  ]);
  expect(Date.now() - started).toBeLessThan(21_000);
  expect(query).toEqual(new Error("Connection terminated due to connection timeout", { cause: new Error("Connection terminated unexpectedly") }));
  expect(run.status).toBe(500);
  expect(await run.json()).toEqual({ outcome: "failed", detail: "The run could not be recorded." });
  expect(logged).toHaveBeenCalledWith("Creating Matchdays failed:", "Connection terminated due to connection timeout");
  // The query and the job each tried once more after their first 10 s, and no more.
  const retries = logged.mock.calls.filter(([said]) => String(said).startsWith("Connecting to the database failed"));
  expect(retries).toHaveLength(2);
  await db.end();
}, 30_000);
