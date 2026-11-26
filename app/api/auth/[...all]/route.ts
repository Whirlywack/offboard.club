import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { noticeLater } from "@/lib/request-failures";

const { GET: handle, POST } = toNextJsHandler(auth);
export { POST };

const ROUTE = "/api/auth/[...all]";

// A person's browser comes here back from LinkedIn. When Better Auth fails, as it does when the database cannot be
// reached, it throws or answers an empty 500: the person is sent home instead, where the sign-in form says signing in
// isn't working (app/page.tsx), and the failure is recorded. Its other answers, its redirects and refusals included, go
// through as they are.
export async function GET(request: Request) {
  const response = await handle(request).catch((error: unknown) => {
    console.error("Better Auth failed:", error instanceof Error ? error.message : error);
    noticeLater(error, ROUTE, "route");
    return null;
  });
  if (response && response.status < 500) return response;
  if (response) noticeLater(new Error(`Better Auth answered ${response.status}`), ROUTE, "route");
  return Response.redirect(new URL("/?signin=failed", request.url), 303);
}
