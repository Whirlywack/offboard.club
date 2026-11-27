// Signing in when the database cannot be reached (#55): the person coming back from LinkedIn reaches Better Auth's own
// route, which then answers an empty 500, and the sign-in button's server action cannot start. Better Auth is the real
// one, over the site's real pool, to a database that refuses every connection. Its other answers must go through as
// they are. Each failure is handed on to be recorded (lib/request-failures.ts, #60 review), which the same database
// refuses, so it is logged instead. The sign-in form is drawn with the state each press of its button leaves, as
// useActionState hands it over (#93).
import net from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { keepWaitUntil } from "@/lib/fixtures/wait-until";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {} }) }));
const form = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: (_action: unknown, initial: unknown) => [form.state ?? initial, () => {}, false],
}));

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
  expect(await signIn({ problem: "", tries: 0 })).toEqual({ problem: SIGN_IN_FAILED, tries: 1 });
  await settled();
  expect(unrecorded()).toEqual(["A server action failed at /: the database couldn't be reached. It couldn't be recorded: the database couldn't be reached."]);
});

// A second press that fails the same way says the same words: each is a new alert all the same, which a screen reader
// announces, and it brings itself into view, as the header's button is a screen or more above it.
it("says signing in isn't working again at each press that fails, and brings it into view", async () => {
  const settled = keepWaitUntil();
  const { signIn } = await import("./actions");
  const { SignIn } = await import("./sign-in");
  const { SIGN_IN_FAILED } = await import("@/lib/auth");
  type Said = { key: string | null; props: { role?: string; children?: unknown; ref?: (p: { scrollIntoView: () => void } | null) => void } };
  // The form's alert after the presses that left `state`: its key, its words, and whether it scrolls into view.
  const alert = (state?: unknown) => {
    form.state = state;
    const said = [SignIn({ problem: SIGN_IN_FAILED }).props.children].flat().find((child: Said | null) => child?.props?.role === "alert") as Said;
    const scrollIntoView = vi.fn();
    said.props.ref?.({ scrollIntoView });
    return { key: said.key, says: said.props.children, intoView: scrollIntoView.mock.calls.length };
  };
  // Sent home from LinkedIn to /?signin=failed#season: said, where the address has already scrolled to.
  expect(alert()).toEqual({ key: "0", says: SIGN_IN_FAILED, intoView: 0 });
  const first = await signIn({ problem: SIGN_IN_FAILED, tries: 0 });
  const second = await signIn(first);
  expect([first, second]).toEqual([
    { problem: SIGN_IN_FAILED, tries: 1 },
    { problem: SIGN_IN_FAILED, tries: 2 },
  ]);
  expect([alert(first), alert(second)]).toEqual([
    { key: "1", says: SIGN_IN_FAILED, intoView: 1 },
    { key: "2", says: SIGN_IN_FAILED, intoView: 1 },
  ]);
  form.state = undefined;
  await settled();
});

// The count comes back from the browser, which may send anything in its place.
it("counts from one again when the browser sends back anything but a small whole number", async () => {
  const settled = keepWaitUntil();
  const { signIn } = await import("./actions");
  const { SIGN_IN_FAILED } = await import("@/lib/auth");
  const sent = [null, "abc", -5, 1.5, 1000, Number.MAX_SAFE_INTEGER, "x".repeat(900_000), {}, BigInt(10)];
  for (const tries of sent) {
    const state = tries === null ? null : { problem: SIGN_IN_FAILED, tries };
    expect(await signIn(state as never)).toEqual({ problem: SIGN_IN_FAILED, tries: 1 });
  }
  await settled();
});

it("says signing in isn't set up, counting the press, where LinkedIn's keys are not", async () => {
  vi.resetModules();
  vi.stubEnv("LINKEDIN_CLIENT_ID", "");
  const { signIn } = await import("./actions");
  expect(await signIn({ problem: "", tries: 1 })).toEqual({
    problem: "Signing in with LinkedIn isn't set up yet. Please try again later.",
    tries: 2,
  });
});
