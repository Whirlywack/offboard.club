import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const { GET: handle, POST } = toNextJsHandler(auth);
export { POST };

// A person's browser comes here back from LinkedIn. When Better Auth fails, as it does when the database cannot be
// reached, it throws or answers an empty 500: the person is sent home instead, where the sign-in form says signing in
// isn't working (app/page.tsx). Its other answers, its redirects and refusals included, go through as they are.
export async function GET(request: Request) {
  const response = await handle(request).catch((error: unknown) => {
    console.error("Better Auth failed:", error instanceof Error ? error.message : error);
    return null;
  });
  return response && response.status < 500 ? response : Response.redirect(new URL("/?signin=failed", request.url), 303);
}
