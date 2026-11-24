// The Lichess client. Every request to Lichess goes through `lichessRequest`, which follows Lichess's API rules
// (https://lichess.org/api): one request at a time, a User-Agent that names the site, and a minute's wait after a
// rate-limit response. Endpoints and fields are as in Lichess's OpenAPI spec (github.com/lichess-org/api).
//
// Tokens travel only in the Authorization header and request bodies, never in a URL, and nothing here logs a request,
// a body or a token: errors name the endpoint and the status only.

export const USER_AGENT = "offboard.club (https://offboard.club)";
export const RATE_LIMIT_WAIT_MS = 60_000;
const TIMEOUT_MS = 30_000;

// LICHESS_URL points development and tests at a fake Lichess; production always talks to lichess.org.
const base = () =>
  (process.env.NODE_ENV !== "production" && process.env.LICHESS_URL) || "https://lichess.org";

export const lichessUrl = (path: string) => new URL(path, base());

// Where people see a Lichess account. Always the real site: it is a link for people, not a request.
export const lichessProfileUrl = (username: string) => `https://lichess.org/@/${encodeURIComponent(username)}`;

export class LichessError extends Error {
  constructor(
    readonly request: string,
    readonly status: number,
    detail?: string,
  ) {
    super(`Lichess answered ${request} with ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "LichessError";
  }
}

type Options = { method?: "GET" | "POST" | "DELETE"; token?: string; form?: Record<string, string> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function send(path: string, { method = "GET", token, form }: Options) {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(lichessUrl(path), {
    method,
    headers,
    body: form && new URLSearchParams(form),
    // A redirect would carry the token somewhere unchecked; Lichess's API does not redirect.
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

// The request in progress, if any. Each request waits for the previous one, its body included, to finish.
// ponytail: one at a time within one server instance only; if Lichess rate-limits the site while several instances
// run at once, send every request through one shared queue instead.
let previous: Promise<unknown> = Promise.resolve();

// Sends one request and hands the response to `read`, which must finish with the body before the next request
// goes out. After a 429 it waits a minute and tries once more; `read` gets whatever that second answer is.
export function lichessRequest<T>(path: string, options: Options, read: (response: Response) => Promise<T> | T): Promise<T> {
  const run = async () => {
    let response = await send(path, options);
    if (response.status === 429) {
      await response.body?.cancel();
      await sleep(RATE_LIMIT_WAIT_MS);
      response = await send(path, options);
    }
    try {
      return await read(response);
    } finally {
      if (!response.bodyUsed) await response.body?.cancel();
    }
  };
  const result = previous.then(run);
  previous = result.catch(() => undefined);
  return result;
}

// Lichess's own short reason for a refusal, such as "This team requires a password." Never the whole body.
async function reason(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => null);
  const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
  return typeof error === "string" ? error.slice(0, 200) : undefined;
}

const refused = async (request: string, response: Response) =>
  new LichessError(request, response.status, await reason(response));

// --- OAuth: authorization code flow with PKCE for a public client (no client secret, S256 only, no refresh). ---

export type Authorization = { clientId: string; redirectUri: string; scope: string; challenge: string; state: string };

// GET /oauth, where the person approves. A page for the browser, so it is a URL rather than a request.
export function authorizationUrl({ clientId, redirectUri, scope, challenge, state }: Authorization): string {
  const url = lichessUrl("/oauth");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope,
    state,
  }).toString();
  return url.toString();
}

// Lichess's token format; anything else is not used, not even in a header.
const TOKEN = /^[A-Za-z0-9_]{1,4096}$/;

// POST /api/token: the code from the redirect, and the verifier its challenge came from, for an access token.
export const exchangeCode = (p: { code: string; verifier: string; redirectUri: string; clientId: string }) =>
  lichessRequest(
    "/api/token",
    {
      method: "POST",
      form: {
        grant_type: "authorization_code",
        code: p.code,
        code_verifier: p.verifier,
        redirect_uri: p.redirectUri,
        client_id: p.clientId,
      },
    },
    async (response) => {
      if (!response.ok) throw await refused("POST /api/token", response);
      const body: { access_token?: unknown } = await response.json();
      if (typeof body.access_token !== "string" || !TOKEN.test(body.access_token))
        throw new LichessError("POST /api/token", response.status, "no usable token");
      return body.access_token;
    },
  );

// DELETE /api/token: revokes the token the request is made with. True once Lichess has revoked it.
export const revokeToken = (token: string) =>
  lichessRequest("/api/token", { method: "DELETE", token }, (response) => response.ok);

// --- Account ---

export type LichessAccount = {
  id: string;
  username: string;
  blitzRating: number | null;
  closed: boolean; // Lichess's "disabled"
  marked: boolean; // Lichess's "tosViolation": marked for breaking Lichess's terms of service
};

const NAME = /^[A-Za-z0-9_-]{2,30}$/;

// GET /api/account: the account the token belongs to.
export const getAccount = (token: string) =>
  lichessRequest("/api/account", { token }, async (response): Promise<LichessAccount> => {
    if (!response.ok) throw await refused("GET /api/account", response);
    const body = await response.json();
    if (typeof body?.id !== "string" || typeof body.username !== "string" || !NAME.test(body.id) || !NAME.test(body.username))
      throw new LichessError("GET /api/account", response.status, "no usable account");
    const rating = body.perfs?.blitz?.rating;
    return {
      id: body.id,
      username: body.username,
      blitzRating: Number.isInteger(rating) ? rating : null,
      closed: body.disabled === true,
      marked: body.tosViolation === true,
    };
  });

// --- Teams ---

// POST /team/{teamId}/join, needing the team:write scope. Lichess answers 200 when the account is already a member
// too. A wrong password is refused with 403 in the spec (400 "This team requires a password." in practice).
export const joinTeam = (token: string, teamId: string, password: string) =>
  lichessRequest(`/team/${encodeURIComponent(teamId)}/join`, { method: "POST", token, form: { password } }, async (response) => {
    if (!response.ok) throw await refused("POST /team/{teamId}/join", response);
  });
