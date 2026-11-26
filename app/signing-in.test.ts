// Signing in when the database cannot be reached (#55): the person coming back from LinkedIn reaches Better Auth's own
// route, which then answers an empty 500, and the sign-in button's server action cannot start. Better Auth is the real
// one, over the site's real pool, to a database that refuses every connection. Its other answers must go through as
// they are. Each failure is handed on to be recorded (lib/request-failures.ts, #60 review), which the same database
// refuses, so it is logged instead.
import net from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const refused = net.createServer();
let route: typeof import("./api/auth/[...all]/route");
let auth: typeof import("@/lib/auth").auth;
let logged: { mock: { calls: unknown[][] }; mockClear: () => void };

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
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
  route = await import("./api/auth/[...all]/route");
  ({ auth } = await import("@/lib/auth"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const get = (path: string) => route.GET(new Request(`https://offboard.test/api/auth${path}`));
// What was logged of failures that could not be recorded.
const unrecorded = () => logged.mock.calls.map(([said]) => String(said)).filter((said) => said.includes("couldn't be recorded"));

it("sends someone back from LinkedIn home, where the sign-in form says it isn't working, when Better Auth fails", async () => {
  const settled = keepWaitUntil();
  const back = "/callback/linkedin?code=a-pretend-code&state=a-pretend-state";
  const sentHome = (response: Response) => {
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://offboard.test/?signin=failed#season");
  };
  // Its tables cannot be checked, so it throws, which Next.js would answer with an empty 500.
  sentHome(await get(back));
  // A query that fails later, inside one of its endpoints, it answers with a 500 of its own.
  vi.spyOn(auth, "handler").mockResolvedValueOnce(new Response(null, { status: 500 }));
  sentHome(await get(back));
  await settled();
  expect(unrecorded()).toEqual([
    "A route failed at /api/auth/[...all]: the database couldn't be reached. It couldn't be recorded: the database couldn't be reached.",
    "A route failed at /api/auth/[...all]: the code threw Error. It couldn't be recorded: the database couldn't be reached.",
  ]);
});

it("passes on Better Auth's own refusals and redirects as they are", async () => {
  const refusal = await get("/update-user"); // a path the site disables (lib/auth.ts)
  expect(refusal.status).toBe(404);
  const sent = Response.redirect("https://www.linkedin.com/oauth/v2/authorization?state=a-pretend-state", 302);
  vi.spyOn(auth, "handler").mockResolvedValueOnce(sent);
  expect(await get("/sign-in/social")).toBe(sent);
});

it("says signing in isn't working when the sign-in button's action cannot start, and hands its failure on", async () => {
  const settled = keepWaitUntil();
  logged.mockClear();
  const { signIn } = await import("./actions");
  const { SIGN_IN_FAILED } = await import("@/lib/auth");
  expect(await signIn()).toBe(SIGN_IN_FAILED);
  await settled();
  expect(unrecorded()).toEqual(["A server action failed at /: the database couldn't be reached. It couldn't be recorded: the database couldn't be reached."]);
});
