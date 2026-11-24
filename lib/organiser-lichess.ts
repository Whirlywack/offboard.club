// The Organiser's Lichess permission: the Organiser approves Offboard on Lichess with an account that leads the Club's
// team, and the site keeps the token, sealed (lib/token-box.ts), to create each Matchday's tournament (#11) and, later,
// to cancel one (#16) and remove a Member from the team (#15, #16).
//
// The same authorization code flow with PKCE as a Member's connection (lib/connect-lichess.ts), with its own callback,
// cookie and signature. The token is never logged, put in a URL or a cookie, or sent to the browser: the page sees
// only the account, when it was connected and when it expires. Lichess tokens for a public client last a year and
// cannot be refreshed, so the Organiser approves again by hand about once a year (docs/adr/0001).

import { db } from "./db";
import { CLIENT_ID, CONNECTION_DEADLINE_MS, redirectUri, returnedFrom, revoke, REVOKED_BY_MS, startConnection, type Flow } from "./connect-lichess";
import { exchangeCode, getAccount, LichessError, teamLeaders, timeLimit } from "./lichess";
import { organiserId } from "./organiser";
import { vilniusDate } from "./schedule";
import { openToken, sealToken, tokenKey } from "./token-box";

// tournament:write creates each Matchday's tournament, and lets #16 cancel one; team:lead lets #15 and #16 remove a
// Member from the team. Both are asked for now because a token cannot gain a scope later: that would mean approving
// again. Lichess warns about team:lead on its approval page.
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
  connected: "Lichess is connected. Each Matchday's tournament will be created with this account.",
  denied: "You did not approve Offboard on Lichess, so nothing has changed.",
  expired: "That attempt to connect Lichess ran out or was started in another browser. Please start again.",
  leader:
    "That Lichess account is not shown as a leader of the Club's Lichess team, so it cannot create Matchdays and has not been connected. Sign in to Lichess as a leader of the team and try again.",
  unset: "Connecting Lichess is not set up yet: LICHESS_TEAM_ID and LICHESS_TOKEN_KEY must be set.",
  failed: "Something went wrong while talking to Lichess, so nothing has changed. Please try again in a few minutes.",
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
// kept before is revoked once the new one is stored.
export async function finishOrganiserConnection(
  organiser: { id: string },
  query: URLSearchParams,
  pendingCookieValue: string | undefined,
): Promise<string> {
  const back = (code: Code) => `/organiser?lichess=${code}`;
  const returned = returnedFrom(ORGANISER_FLOW, organiser.id, query, pendingCookieValue);
  if ("problem" in returned) return back(returned.problem);
  const teamId = process.env.LICHESS_TEAM_ID;
  const key = tokenKey();
  if (!teamId || !key) return back("unset");

  const started = Date.now();
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
    const previous = await storedToken(key);
    await db.query(
      `insert into "organiserLichess" ("singleton", "userId", "lichessId", "scopes", "token", "expiresAt", "connectedAt")
       values (true, $1, $2, $3, $4, $5, now())
       on conflict ("singleton") do update set "userId" = excluded."userId", "lichessId" = excluded."lichessId",
         "scopes" = excluded."scopes", "token" = excluded."token", "expiresAt" = excluded."expiresAt", "connectedAt" = excluded."connectedAt"`,
      [organiser.id, account.id, ORGANISER_SCOPES, sealToken(token, sealedFor(organiser.id, account.id), key), expiresAt],
    );
    kept = true;
    if (previous && previous !== token) await revoke(previous, REVOKED_BY_MS - (Date.now() - started));
    return back("connected");
  } catch (error) {
    // A LichessError names the request and the status only; nothing else that is logged holds the token.
    console.error("Connecting the Organiser's Lichess account failed:", error instanceof Error ? error.message : "unknown error");
    return back("failed");
  } finally {
    deadline.clear();
    if (token && !kept) await revoke(token, REVOKED_BY_MS - (Date.now() - started));
  }
}

type StoredRow = { userId: string; lichessId: string; token: string; expiresAt: Date };

async function storedRow(): Promise<StoredRow | null> {
  const { rows } = await db.query<StoredRow>(`select "userId", "lichessId", "token", "expiresAt" from "organiserLichess"`);
  return rows[0] ?? null;
}

// The token kept now, whoever's it is, if it can be opened.
async function storedToken(key: Buffer): Promise<string | null> {
  const row = await storedRow();
  return row && openToken(row.token, sealedFor(row.userId, row.lichessId), key);
}

export type OrganiserPermission = { lichessId: string; scopes: string; expiresAt: Date; connectedAt: Date };

// The permission as the Organiser page shows it, without the token: null unless the current Organiser connected it.
export async function organiserPermission(): Promise<OrganiserPermission | null> {
  const { rows } = await db.query<OrganiserPermission & { userId: string }>(
    `select "userId", "lichessId", "scopes", "expiresAt", "connectedAt" from "organiserLichess"`,
  );
  const row = rows[0];
  if (!row || row.userId !== organiserId()) return null;
  return { lichessId: row.lichessId, scopes: row.scopes, expiresAt: row.expiresAt, connectedAt: row.connectedAt };
}

const RECONNECT = "the Organiser must connect Lichess again on the Organiser page";

// The token, for scheduled work at `now`, with the account it belongs to; or why there is none to use, as a sentence.
export async function organiserToken(now: Date): Promise<{ token: string; lichessId: string } | { problem: string }> {
  const key = tokenKey();
  if (!key) return { problem: "LICHESS_TOKEN_KEY is not set, so the Organiser's Lichess permission cannot be read." };
  const row = await storedRow();
  if (!row || row.userId !== organiserId())
    return { problem: "The Organiser has not connected their Lichess account on the Organiser page." };
  if (row.expiresAt <= now) return { problem: `The Organiser's Lichess permission expired on ${vilniusDate(row.expiresAt)}; ${RECONNECT}.` };
  const token = openToken(row.token, sealedFor(row.userId, row.lichessId), key);
  if (!token)
    return {
      problem: `The Organiser's stored Lichess permission cannot be read (LICHESS_TOKEN_KEY has changed, or what is stored was altered); ${RECONNECT}.`,
    };
  return { token, lichessId: row.lichessId };
}

// A Lichess refusal of the Organiser's token, as a sentence; null for anything else.
export const refusedPermission = (error: unknown): string | null =>
  error instanceof LichessError && error.status === 401
    ? `Lichess refused the Organiser's permission, which may have been revoked on Lichess; ${RECONNECT}.`
    : null;
