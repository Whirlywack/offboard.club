import pg from "pg";
import { afterAll, expect, it, vi } from "vitest";

// The address the site's one pool (lib/db.ts) gives pg, from DATABASE_URL as Neon writes it, with sslmode=require
// (#60). pg 8 warns of that mode on stderr, once a process, which Vercel logs at error level. Nothing connects.
const NEON = "postgres://neondb_owner:a-pretend-password@ep-pretend-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("is connected to as with sslmode=require, verified in full, and pg no longer warns of the mode", async () => {
  vi.stubEnv("DATABASE_URL", NEON);
  const warned = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
  const { db } = await import("./db");
  const { options } = db as unknown as { options: pg.ClientConfig };
  // What pg makes of an address for each connection (pg/lib/connection-parameters.js).
  const parameters = (config: pg.ClientConfig) => (new pg.Client(config) as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters;
  // The pool's, before anything in this process has read the mode.
  const connecting = parameters(options);
  expect(warned).not.toHaveBeenCalled();
  // The same as it makes of DATABASE_URL itself: the same host, user, database and TLS, with tls.connect's defaults,
  // which check the server's certificate and its name.
  expect(connecting).toEqual(parameters({ ...options, connectionString: NEON }));
  expect(connecting.ssl).toEqual({});
  // DATABASE_URL itself is warned of.
  expect(warned).toHaveBeenCalledOnce();
  expect(String(warned.mock.calls[0][0])).toMatch(/^SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'/);
  await db.end();
});
