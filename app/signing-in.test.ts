// Signing in when the database cannot be reached (#55): the person coming back from LinkedIn reaches Better Auth's own
// route, which then answers an empty 500. Better Auth is the real one, over the site's real pool, to a database that
// refuses every connection. Its other answers must go through as they are.
import net from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const refused = net.createServer();
let route: typeof import("./api/auth/[...all]/route");
let auth: typeof import("@/lib/auth").auth;

beforeAll(async () => {
  // A port nothing listens on once the server is closed.
  await new Promise<void>((listening) => refused.listen(0, "127.0.0.1", listening));
  const { port } = refused.address() as net.AddressInfo;
  await new Promise((closed) => refused.close(closed));
  vi.stubEnv("DATABASE_URL", `postgres://offboard@127.0.0.1:${port}/offboard`);
  vi.stubEnv("BETTER_AUTH_URL", "https://offboard.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "a-pretend-better-auth-secret-0123456789");
  vi.stubEnv("LINKEDIN_CLIENT_ID", "a-pretend-linkedin-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "a-pretend-linkedin-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  route = await import("./api/auth/[...all]/route");
  ({ auth } = await import("@/lib/auth"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const get = (path: string) => route.GET(new Request(`https://offboard.test/api/auth${path}`));

it("sends someone back from LinkedIn home, where the sign-in form says it isn't working, when Better Auth fails", async () => {
  const back = "/callback/linkedin?code=a-pretend-code&state=a-pretend-state";
  const sentHome = (response: Response) => {
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://offboard.test/?signin=failed");
  };
  // Its tables cannot be checked, so it throws, which Next.js would answer with an empty 500.
  sentHome(await get(back));
  // A query that fails later, inside one of its endpoints, it answers with a 500 of its own.
  vi.spyOn(auth, "handler").mockResolvedValueOnce(new Response(null, { status: 500 }));
  sentHome(await get(back));
});

it("passes on Better Auth's own refusals and redirects as they are", async () => {
  const refusal = await get("/update-user"); // a path the site disables (lib/auth.ts)
  expect(refusal.status).toBe(404);
  const sent = Response.redirect("https://www.linkedin.com/oauth/v2/authorization?state=a-pretend-state", 302);
  vi.spyOn(auth, "handler").mockResolvedValueOnce(sent);
  expect(await get("/sign-in/social")).toBe(sent);
});
