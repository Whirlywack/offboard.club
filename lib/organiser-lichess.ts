// The Organiser's Lichess permission: the Organiser approves Offboard on Lichess with an account that leads the Club's
// team, and the site keeps the token, sealed (lib/token-box.ts), to create each Matchday's tournament (#11), to remove
// someone who leaves the Club from the team (#15) and to cancel a tournament whose Sunday is no longer a Matchday (#16).
//
// The same authorization code flow with PKCE as a Member's connection (lib/connect-lichess.ts), with its own callback,
// cookie and signature. The token is never logged, put in a URL or a cookie, or sent to the browser: the page sees
// only the account, when it was connected and when it expires. Lichess tokens for a public client last a year and
// cannot be refreshed, so the Organiser approves again by hand about once a year (docs/adr/0001).

import { db } from "./db";
import { CLIENT_ID, CONNECTION_DEADLINE_MS, PROBLEMS, redirectUri, returnedFrom, revoke, REVOKED_BY_MS, startConnection, type Flow } from "./connect-lichess";
import { exchangeCode, getAccount, LichessError, teamLeaders, timeLimit } from "./lichess";
import { organiserId } from "./organiser";
import { noticeLater } from "./request-failures";
import { vilniusDay } from "./schedule";
import { openToken, sealToken, tokenKey } from "./token-box";

// tournament:write creates each Matchday's tournament, and cancels one (lib/reschedule.ts); team:lead removes someone who leaves the
// Club from the team (lib/leaving.ts). Both were asked for from the start because a token cannot gain a scope later:
// that would mean approving again. Lichess warns about team:lead on its approval page.
export const ORGANISER_SCOPES = "tournament:write team:lead";

export const ORGANISER_FLOW: Flow = {
  callbackPath: "/api/lichess/organiser-callback",
  cookie: "offboard-organiser-lichess",
  purpose: "offboard organiser lichess connect",
  scope: ORGANISER_SCOPES,
};

// What lila gives a token when Lichess does not say: twelve months.
const DEFAULT_LIFETIME_SECONDS = 365 * 86_400;

// Until the team and the key are configured, the Organiser page says so instead of starting.
export const organiserLichessConfigured = () => Boolean(process.env.LICHESS_TEAM_ID && tokenKey());

export const startOrganiserConnection = (userId: string) => startConnection(userId, ORGANISER_FLOW);

// How each attempt ended, as the plain message the Organiser sees. Only these codes travel in a URL.
export const ORGANISER_MESSAGES = {
  connected: "Lichess is connected.",
  stranded:
    "Lichess is connected, but the old permission couldn't be read with the current LICHESS_TOKEN_KEY, so it wasn't revoked. To end it, sign in to Lichess as the account that gave it and revoke Offboard under Security in its settings. If that's the account you just connected, revoking ends the new permission too, so connect again afterwards.",
  denied: "You didn't approve Offboard on Lichess, so nothing has changed.",
  expired: PROBLEMS.expired,
  leader:
    "That Lichess account isn't a leader of the Club's Lichess team, so it wasn't connected. Sign in to Lichess as a leader of the team and try again.",
  unset: "Lichess can't be connected until LICHESS_TEAM_ID and LICHESS_TOKEN_KEY are set.",
  failed: PROBLEMS.failed,
} as const;
type Code = keyof typeof ORGANISER_MESSAGES;

export const organiserMessage = (code: unknown): { text: string; problem: boolean } | null =>
  typeof code === "string" && Object.hasOwn(ORGANISER_MESSAGES, code)
    ? { text: ORGANISER_MESSAGES[code as Code], problem: code !== "connected" }
    : null;

// Binds a sealed token to whose it is: one moved to another person or account cannot be opened.
const sealedFor = (userId: string, lichessId: string) => `offboard organiser lichess token\n${userId}\n${lichessId}`;

// The Organiser is back from Lichess (the caller checks it is them). Returns where to send them: the Organiser page,
// saying how it went. The token is kept only if its account leads the Club's team; otherwise it is revoked. A token
// kept before is revoked once the new one is stored, if it can still be read; if not, the Organiser is told to revoke
// it by hand. Tokens are revoked by REVOKED_BY_MS after `started` (in ms), when the callback began, before reading the
// session.
export async function finishOrganiserConnection(
  organiser: { id: string },
  query: URLSearchParams,
  pendingCookieValue: string | undefined,
  started = Date.now(),
): Promise<string> {
  const back = (code: Code) => `/organiser?lichess=${code}`;
  const returned = returnedFrom(ORGANISER_FLOW, organiser.id, query, pendingCookieValue);
  if ("problem" in returned) return back(returned.problem);
  const teamId = process.env.LICHESS_TEAM_ID;
  const key = tokenKey();
  if (!teamId || !key) return back("unset");

  const deadline = timeLimit(CONNECTION_DEADLINE_MS, `Connecting Lichess took more than ${CONNECTION_DEADLINE_MS / 1000} s`);
  const signal = deadline.signal;
  let token: string | null = null;
  let kept = false;
  try {
    const grant = await exchangeCode(
      { code: returned.code, verifier: returned.verifier, redirectUri: redirectUri(ORGANISER_FLOW), clientId: CLIENT_ID },
      signal,
    );
    token = grant.accessToken;
    const account = await getAccount(token, signal);
    const leaders = await teamLeaders(teamId, signal);
    if (!leaders) throw new Error(`Lichess has no team ${teamId}`);
    if (!leaders.includes(account.id)) return back("leader");
    const expiresAt = new Date(Date.now() + (grant.expiresInSeconds ?? DEFAULT_LIFETIME_SECONDS) * 1000);
    const before = await storedRow();
    const previous = before && open(before, key);
    await db.query(
      `insert into "organiserLichess" ("singleton", "userId", "lichessId", "scopes", "token", "expiresAt", "connectedAt")
       values (true, $1, $2, $3, $4, $5, now())
       on conflict ("singleton") do update set "userId" = excluded."userId", "lichessId" = excluded."lichessId",
         "scopes" = excluded."scopes", "token" = excluded."token", "expiresAt" = excluded."expiresAt", "connectedAt" = excluded."connectedAt"`,
      [organiser.id, account.id, ORGANISER_SCOPES, sealToken(token, sealedFor(organiser.id, account.id), key), expiresAt],
    );
    kept = true;
    if (previous && previous !== token) await revoke(previous, REVOKED_BY_MS - (Date.now() - started));
    // One that cannot be read cannot be revoked from here: it stays valid on Lichess until it expires.
    return back(before && !previous ? "stranded" : "connected");
  } catch (error) {
    // A LichessError names the request and the status only; nothing else that is logged holds the token.
    console.error("Connecting the Organiser's Lichess account failed:", error instanceof Error ? error.message : "unknown error");
    // Recorded unless it is Lichess's answer to what was brought back, as for a Member (lib/connect-lichess.ts).
    if (!(error instanceof LichessError)) noticeLater(error, ORGANISER_FLOW.callbackPath, "route");
    return back("failed");
  } finally {
    deadline.clear();
    if (token && !kept) await revoke(token, REVOKED_BY_MS - (Date.now() - started));
  }
}

type StoredRow = { userId: string; lichessId: string; scopes: string; token: string; expiresAt: Date; connectedAt: Date };

async function storedRow(): Promise<StoredRow | null> {
  const { rows } = await db.query<StoredRow>(
    `select "userId", "lichessId", "scopes", "token", "expiresAt", "connectedAt" from "organiserLichess"`,
  );
  return rows[0] ?? null;
}

const open = (row: StoredRow, key: Buffer | null) => (key ? openToken(row.token, sealedFor(row.userId, row.lichessId), key) : null);

// What the Organiser page shows, never the token: the account, when it was connected and expires, and whether the
// stored token can still be read with LICHESS_TOKEN_KEY. One that cannot is still valid on Lichess until it expires,
// and the site can no longer revoke it.
export type OrganiserPermission = { lichessId: string; scopes: string; expiresAt: Date; connectedAt: Date; readable: boolean };

// The permission as the Organiser page shows it: null unless the current Organiser connected it.
export async function organiserPermission(): Promise<OrganiserPermission | null> {
  const row = await storedRow();
  if (!row || row.userId !== organiserId()) return null;
  const { lichessId, scopes, expiresAt, connectedAt } = row;
  return { lichessId, scopes, expiresAt, connectedAt, readable: open(row, tokenKey()) !== null };
}

// Lichess's page where an account sees the sites it has approved and revokes them (lila: GET /account/security, the
// "Revoke" button beside each third-party app, which revokes every token the account gave that site).
export const LICHESS_SECURITY_URL = "https://lichess.org/account/security";

const RECONNECT = "Connect Lichess again on the Organiser page.";

// The token, for scheduled work at `now`, with the account it belongs to; or why there is none to use, as a sentence
// that is also an alert to the Organiser.
export async function organiserToken(now: Date): Promise<{ token: string; lichessId: string } | { problem: string }> {
  const key = tokenKey();
  if (!key) return { problem: "LICHESS_TOKEN_KEY isn't set, so your Lichess permission can't be read." };
  const row = await storedRow();
  if (!row || row.userId !== organiserId()) return { problem: "Lichess isn't connected. Connect it on the Organiser page." };
  if (row.expiresAt <= now) return { problem: `Your Lichess permission expired on ${vilniusDay(row.expiresAt)}. ${RECONNECT}` };
  const token = open(row, key);
  if (!token)
    return {
      problem: `Your Lichess permission can't be read: LICHESS_TOKEN_KEY has changed, or what is stored was altered. Sign in to Lichess as ${row.lichessId}, revoke Offboard at ${LICHESS_SECURITY_URL}, then connect Lichess again on the Organiser page.`,
    };
  return { token, lichessId: row.lichessId };
}

// The stored permission's token if `userId` connected it and it is still valid and readable, for revoking on Lichess
// when they leave the Club; null otherwise.
export async function tokenConnectedBy(userId: string, now: Date): Promise<string | null> {
  const row = await storedRow();
  return row && row.userId === userId && row.expiresAt > now ? open(row, tokenKey()) : null;
}

// A Lichess refusal of the Organiser's token, or of what the site does with it on the team, as a sentence; null for
// anything else. The site checks only that the account is shown as one of the team's leaders; lila also wants that
// leader to have the team's permission for tournaments to create one (Swiss.apiCreate: isGranted(teamId, _.Tour)), and
// says only "You're not a leader of that team" when they do not; and its permission to remove members to remove one
// (TeamApi.kickUser: isGranted(teamId, _.Kick)), saying "Insufficient team permissions".
export function refusedPermission(error: unknown, lichessId: string): string | null {
  if (!(error instanceof LichessError)) return null;
  // Not the token refused, but the tournament: only the account that created a Swiss tournament may cancel it.
  if (error.request === "POST /api/swiss/{id}/terminate" && error.detail === "This user cannot edit this swiss")
    return `${error.message}. Probably a Lichess account other than ${lichessId} created it, and only that account can cancel it`;
  if (error.status === 401) return `Lichess refused your permission, which may have been revoked there. ${RECONNECT}`;
  const lacking = (permission: string) =>
    `${error.message}. Probably ${lichessId} leads the Club's team without the team's permission to ${permission}. A team admin can grant it in the team's leader settings on Lichess, or you can connect a leader who has it`;
  if (error.request.startsWith("POST /api/swiss/new/") && (error.status === 403 || error.status === 404))
    return lacking("manage tournaments");
  if (error.request.startsWith("POST /api/team/{teamId}/kick/") && error.status === 400) return lacking("remove members");
  return null;
}
