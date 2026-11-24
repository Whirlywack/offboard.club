import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { shownLogoUrl } from "./companies";
import { mustWelcome } from "./consent";
import { db } from "./db";
import { MEMBER_SQL, mustConnectLichess } from "./members";
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
      // Written only by the connect step (lib/connect-lichess.ts). No Lichess token is kept anywhere.
      lichessId: { type: "string", required: false, input: false },
      lichessUsername: { type: "string", required: false, input: false },
      lichessBlitzRating: { type: "number", required: false, input: false },
      lichessConnectedAt: { type: "date", required: false, input: false },
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

// The connect step and its return from Lichess start here: signed-out visitors go home, and anyone who has not
// finished the welcome step goes there first. Whether Lichess is connected yet is for the caller to decide.
export async function requireWelcomed() {
  const session = await getSession();
  if (!session) redirect("/");
  if (mustWelcome(session.user)) redirect("/welcome");
  return session.user;
}

// Every other signed-in page and action starts here, and lets only Members through: anyone who has finished the
// welcome step but not connected Lichess goes to the connect step.
export async function requireSignedUp() {
  const person = await requireWelcomed();
  if (mustConnectLichess(person)) redirect("/welcome/lichess");
  return person;
}

// Profiles are for Members, to open and to have: requireSignedUp checks the viewer, and this the person shown.
// Null if there is no such Profile; the email is never read.
export async function getProfile(id: string): Promise<Profile | null> {
  type Row = Omit<Profile, "company"> & { companyDomain: string | null; companyName: string; companyLogoUrl: string | null };
  // MEMBER_SQL names columns of "user" alone; "company" has none of those names.
  const { rows } = await db.query<Row>(
    `select u.id, u.name, u.image, u."position", u."linkedInUrl", u."openTo", u."lichessUsername", u."lichessBlitzRating",
       c."domain" as "companyDomain", c."name" as "companyName", c."logoUrl" as "companyLogoUrl"
     from "user" u left join "company" c on c."domain" = u."companyDomain"
     where u.id = $1 and ${MEMBER_SQL}`,
    [id],
  );
  if (!rows[0]) return null;
  const { companyDomain: domain, companyName: name, companyLogoUrl, ...profile } = rows[0];
  return { ...profile, company: domain ? { domain, name, logoUrl: shownLogoUrl(domain, companyLogoUrl) } : null };
}
