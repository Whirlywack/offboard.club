import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { mustWelcome } from "./consent";
import { db } from "./db";
import type { Profile } from "./profile";

// Until the Organiser supplies LinkedIn credentials, sign-in says so instead of failing.
export const linkedInConfigured = Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);

// Nothing uses a LinkedIn token after sign-in, so none is kept: Better Auth would otherwise store the
// ID token (email, name and photo) in plain text.
const withoutLinkedInTokens = async (account: { providerId?: string }) =>
  account.providerId === "linkedin"
    ? {
        data: { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null },
      }
    : undefined;

// Secret and base URL come from BETTER_AUTH_SECRET and BETTER_AUTH_URL.
export const auth = betterAuth({
  database: db,
  socialProviders: {
    linkedin: {
      enabled: linkedInConfigured,
      clientId: process.env.LINKEDIN_CLIENT_ID ?? "",
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
      // LinkedIn photo links expire, so name and photo are taken afresh at every sign-in.
      overrideUserInfoOnSignIn: true,
    },
  },
  user: {
    additionalFields: {
      // Written only by the welcome step, never by the client or LinkedIn.
      publicDisplayConsentAt: { type: "date", required: false, input: false },
      houseRulesAcceptedAt: { type: "date", required: false, input: false },
    },
  },
  databaseHooks: {
    // Sign-in creates the account row the first time and updates it every time after.
    account: { create: { before: withoutLinkedInTokens }, update: { before: withoutLinkedInTokens } },
  },
  // Name and photo come from LinkedIn only; nobody edits them through the API.
  disabledPaths: ["/update-user"],
  plugins: [nextCookies()], // must stay last
});

export const getSession = async () => auth.api.getSession({ headers: await headers() });

// Every signed-in page and action other than the welcome step starts here: signed-out visitors go home,
// and anyone who has not finished the welcome step goes there first.
export async function requireSignedUp() {
  const session = await getSession();
  if (!session) redirect("/");
  if (mustWelcome(session.user)) redirect("/welcome");
  return session.user;
}

// Profiles are for Members, to open and to have. Until Lichess can be connected (#4), everyone who has finished
// the welcome step stands in for a Member: requireSignedUp checks the viewer, and this the person shown.
// #4 narrows both here. Null if there is no such Profile; the email is never read.
export async function getProfile(id: string): Promise<Profile | null> {
  const { rows } = await db.query<Profile>(
    `select id, name, image, "position", "linkedInUrl", "openTo" from "user"
     where id = $1 and "publicDisplayConsentAt" is not null and "houseRulesAcceptedAt" is not null`,
    [id],
  );
  return rows[0] ?? null;
}
