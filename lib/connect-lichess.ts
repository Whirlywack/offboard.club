// The connect step: a person who has finished the welcome step approves Offboard on Lichess, is added to the Club's
// private Lichess team with their own permission and the team password, and is then a Member. A Member can do the
// same again from their Profile edit page to swap to a different Lichess account.
//
// Lichess's authorization code flow with PKCE, as a public client (no client secret), asking only for team:write.
// The token Lichess hands back is used for the account and the team join, revoked straight after, and never kept:
// it is not stored, not put in a URL or a cookie, and not logged.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import {
  authorizationUrl,
  exchangeCode,
  getAccount,
  isMarked,
  joinTeam,
  LichessError,
  revokeToken,
  timeLimit,
  type LichessAccount,
} from "./lichess";
import { mustConnectLichess } from "./members";

// Lichess takes any unique id from a public client.
export const CLIENT_ID = "offboard.club";
export const SCOPE = "team:write";
export const CALLBACK_PATH = "/api/lichess/callback";
const PENDING_SECONDS = 600;

// The callback may run for 300 s (its maxDuration). Rate limits can stretch each Lichess call to two minutes, so the
// connection gives up after 240 s, and revoking the token may use what is left up to 295 s.
export const CONNECTION_DEADLINE_MS = 240_000;
const REVOKED_BY_MS = 295_000;

// Until the Organiser supplies the team's id and password, the connect step says so instead of failing.
export const lichessConfigured = () => Boolean(process.env.LICHESS_TEAM_ID && process.env.LICHESS_TEAM_PASSWORD);

// Built from the site's own configured address, never from the request.
export const redirectUri = () => new URL(CALLBACK_PATH, process.env.BETTER_AUTH_URL).toString();

// PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)).
export const codeChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

// 32 random bytes: 43 base64url characters, the shortest verifier RFC 7636 allows.
const random = () => randomBytes(32).toString("base64url");

// --- The pending connection, kept in the browser between leaving for Lichess and coming back. ---
// It holds the state, the verifier and whose connection it is, signed so that nobody else can make one up. It is
// sent only to the callback, cleared there whatever happens, and lapses after ten minutes.

export const PENDING_COOKIE = "offboard-lichess";

const cookieAttributes = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const, // sent on the top-level return from lichess.org
  path: CALLBACK_PATH,
});
export const pendingCookie = (value: string) => ({ name: PENDING_COOKIE, value, maxAge: PENDING_SECONDS, ...cookieAttributes() });
export const clearedPendingCookie = () => ({ name: PENDING_COOKIE, ...cookieAttributes() });

type Pending = { state: string; verifier: string; userId: string; expires: number };

const sign = (body: string) =>
  createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(`offboard lichess connect\n${body}`).digest("base64url");

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function seal(pending: Pending): string {
  const body = Buffer.from(JSON.stringify(pending)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function unseal(value: string | undefined): Pending | null {
  const [body, signature, ...rest] = value?.split(".") ?? [];
  if (!body || !signature || rest.length > 0 || !sameText(signature, sign(body))) return null;
  try {
    const pending = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const valid = ["state", "verifier", "userId"].every((key) => typeof pending[key] === "string");
    return valid && typeof pending.expires === "number" && pending.expires > Date.now() ? pending : null;
  } catch {
    return null;
  }
}

// Where to send the person on Lichess, and the cookie that must come back with them.
export function startConnection(userId: string): { url: string; cookie: string } {
  const state = random();
  const verifier = random();
  return {
    url: authorizationUrl({ clientId: CLIENT_ID, redirectUri: redirectUri(), scope: SCOPE, challenge: codeChallenge(verifier), state }),
    cookie: seal({ state, verifier, userId, expires: Date.now() + PENDING_SECONDS * 1000 }),
  };
}

// --- Coming back from Lichess ---

// Each way a connection can fail, as the plain message the person sees. Only these codes travel in a URL.
export const PROBLEMS = {
  denied: "You didn't approve Offboard on Lichess, so nothing has changed. Try again whenever you're ready.",
  expired: "That attempt timed out, or was started in another browser. Please start again from this page.",
  // No message for a closed account: Lichess refuses a closed account's token, so that ends as "failed".
  marked: "Lichess has marked that account for breaking its terms of service, so it can't be connected.",
  taken:
    "That Lichess account is already connected to another Member, and each account can belong to only one. If you have another Lichess account, sign in to Lichess with it and try again.",
  team: "Lichess wouldn't add that account to the Club's Lichess team, so it isn't connected. Please try again later.",
  failed: "Something went wrong while talking to Lichess, so nothing has changed. Please try again in a few minutes.",
} as const;
export type Problem = keyof typeof PROBLEMS;

export const lichessProblem = (code: unknown): string | null =>
  typeof code === "string" && Object.hasOwn(PROBLEMS, code) ? PROBLEMS[code as Problem] : null;

// The person must already be signed in and past the welcome step (the caller checks). Returns where to send them:
// on to the next step, or back to where they started with a problem code.
export async function finishConnection(
  person: { id: string; lichessId?: string | null },
  query: URLSearchParams,
  pendingCookieValue: string | undefined,
): Promise<string> {
  const swap = !mustConnectLichess(person);
  const problem = (code: Problem) => `${swap ? "/profile" : "/welcome/lichess"}?lichess=${code}`;

  const pending = unseal(pendingCookieValue);
  const state = query.get("state");
  if (!pending || pending.userId !== person.id || !state || !sameText(state, pending.state)) return problem("expired");
  const code = query.get("code");
  if (!code) return problem(query.get("error") === "access_denied" ? "denied" : "failed");
  if (!lichessConfigured()) return problem("failed");

  const started = Date.now();
  const deadline = timeLimit(CONNECTION_DEADLINE_MS, `Connecting Lichess took more than ${CONNECTION_DEADLINE_MS / 1000} s`);
  const signal = deadline.signal;
  let token: string | null = null;
  try {
    token = await exchangeCode({ code, verifier: pending.verifier, redirectUri: redirectUri(), clientId: CLIENT_ID }, signal);
    const account = await getAccount(token, signal);
    if (await isMarked(account.id, signal)) return problem("marked");
    if (await connectedToSomeoneElse(account.id, person.id)) return problem("taken");
    try {
      await joinTeam(token, process.env.LICHESS_TEAM_ID!, process.env.LICHESS_TEAM_PASSWORD!, signal);
    } catch (error) {
      if (!(error instanceof LichessError && (error.status === 400 || error.status === 403))) throw error;
      console.error("Lichess refused to add an account to the Club's team:", error.message);
      return problem("team");
    }
    if (!(await saveConnection(person.id, account))) return problem("taken");
    // ponytail: on a swap the old account (person.lichessId) stays in the Club's Lichess team, because removing it
    // needs the Organiser's Lichess permission; once #11 keeps that, remove the old account from the team here.
    return swap ? `/profiles/${person.id}` : "/welcome/profile";
  } catch (error) {
    console.error("Connecting Lichess failed:", error instanceof LichessError ? error.message : error);
    return problem("failed");
  } finally {
    deadline.clear();
    if (token) await revoke(token, REVOKED_BY_MS - (Date.now() - started));
  }
}

async function revoke(token: string, ms: number) {
  const limit = timeLimit(ms, "Revoking a Lichess token took too long");
  const revoked = await revokeToken(token, limit.signal).catch(() => false);
  limit.clear();
  if (!revoked) console.error("A Lichess token could not be revoked. It lapses by itself in about a year.");
}

async function connectedToSomeoneElse(lichessId: string, personId: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from "user" where "lichessId" = $1 and id <> $2`, [lichessId, personId]);
  return rows.length > 0;
}

// Only the Lichess columns of the person's own row change, so a swap leaves the Member and everything attached to
// them as it was, including when they first connected (MEMBER_SINCE). The account was just found to be neither marked
// nor closed, so marks a previous account carried go with it. False if someone else connected the same account in
// the meantime.
async function saveConnection(personId: string, account: LichessAccount): Promise<boolean> {
  try {
    await db.query(
      `update "user" set "lichessId" = $2, "lichessUsername" = $3, "lichessBlitzRating" = $4,
         "lichessMarked" = false, "lichessClosed" = false,
         "lichessConnectedAt" = coalesce("lichessConnectedAt", now()), "updatedAt" = now()
       where id = $1`,
      [personId, account.id, account.username, account.blitzRating],
    );
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return false; // unique_violation on "lichessId"
    throw error;
  }
}
