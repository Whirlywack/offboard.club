import { createHmac } from "node:crypto";

// Better Auth's session cookie, for the local tools alone: the seed's cookies (scripts/seed.ts), whose check signs in
// with them as Better Auth reads them, and the switch between people in the local site (app/sign-in-as). Plain http, so
// its name is without the __Secure- prefix.
export const SESSION_COOKIE = "better-auth.session_token";

// Its value for a session's token: `<token>.<HMAC-SHA256 of it>`, signed with the site's secret and URI-encoded
// (better-call's signCookieValue).
export const signedSession = (token: string) =>
  encodeURIComponent(`${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}`);
