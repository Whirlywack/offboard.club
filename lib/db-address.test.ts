import pg from "pg";
import { afterAll, expect, it, vi } from "vitest";

// The address the site's one pool (lib/db.ts) gives pg, from DATABASE_URL as Neon writes it, with sslmode=require, and
// others (#60). pg 8 warns of the modes prefer, require and verify-ca on stderr, once a process, which Vercel logs at
// error level. Nothing connects.
const NEON = "postgres://neondb_owner:a-pretend-password@ep-pretend-123456-pooler.eu-central-1.aws.neon.tech/neondb";
const REWRITTEN = ["?sslmode=require&channel_binding=require", "?sslmode=prefer", "?channel_binding=require&sslmode=verify-ca"];
// Left as they are: libpq's meanings, under which require checks no certificate, a mode inside another value, and one
// with no query, which pg reads as part of the database's name.
const KEPT = ["?uselibpqcompat=true&sslmode=require", "?sslmode=require&uselibpqcompat=true", "?application_name=a?sslmode=require", "&sslmode=require"];

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// What pg makes of an address for each connection (pg/lib/connection-parameters.js).
const parameters = (config: pg.ClientConfig) =>
  (new pg.Client(config) as unknown as { connectionParameters: { ssl: unknown; application_name?: string } }).connectionParameters;

// The pool lib/db.ts makes of `address`, as DATABASE_URL, and its options.
async function pool(address: string) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", address);
  const { db } = await import("./db");
  await db.end();
  return (db as unknown as { options: pg.ClientConfig }).options;
}

it("is connected to as with the address given, verified as pg verifies it now, and pg no longer warns of the mode", async () => {
  const warned = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
  const pools: pg.ClientConfig[] = [];
  for (const query of [...REWRITTEN, ...KEPT]) pools.push(await pool(`${NEON}${query}`));
  // What pg makes of each pool's address, before anything in this process has read a mode it warns of.
  const connecting = pools.map(parameters);
  expect(warned).not.toHaveBeenCalled();
  for (const [i, query] of [...REWRITTEN, ...KEPT].entries()) {
    // The same as it makes of DATABASE_URL itself: the same host, user, database, name and TLS.
    expect([query, connecting[i]]).toEqual([query, parameters({ ...pools[i], connectionString: `${NEON}${query}` })]);
    expect(pools[i].connectionString).toBe(KEPT.includes(query) ? `${NEON}${query}` : `${NEON}${query.replace(/sslmode=[a-z-]+/, "sslmode=verify-full")}`);
  }
  // tls.connect's defaults, which check the server's certificate and its name, where pg treats the modes alike...
  for (const i of REWRITTEN.keys()) expect(connecting[i].ssl).toEqual({});
  // ...but not under libpq's meanings, which the pool keeps.
  expect(connecting[REWRITTEN.length].ssl).toEqual({ rejectUnauthorized: false });
  expect(connecting.at(-2)!.application_name).toBe("a?sslmode=require");
  expect((connecting.at(-1) as unknown as { database: string }).database).toBe("neondb&sslmode=require");
  // DATABASE_URL itself is warned of.
  expect(warned).toHaveBeenCalledOnce();
  expect(String(warned.mock.calls[0][0])).toMatch(/^SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'/);
});

it("is none without DATABASE_URL, as on a preview, and the address as it is without a query", async () => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", undefined);
  const { db } = await import("./db");
  expect((db as unknown as { options: pg.ClientConfig }).options.connectionString).toBeUndefined();
  await db.end();
  expect((await pool(NEON)).connectionString).toBe(NEON);
});
