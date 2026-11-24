// The Lichess client. Every request to Lichess goes through `lichessRequest`, which follows Lichess's API rules
// (https://lichess.org/api): one request at a time, a User-Agent that names the site, and a minute's wait after a
// rate-limit response. Endpoints and fields are as in Lichess's OpenAPI spec (lichess-org/api on GitHub), checked
// against what lichess.org itself does (its source, lichess-org/lila) where the two differ.
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

// Where people see a Lichess account, or a Swiss tournament. Always the real site: these are links for people, not
// requests.
export const lichessProfileUrl = (username: string) => `https://lichess.org/@/${encodeURIComponent(username)}`;
export const lichessSwissUrl = (id: string) => `https://lichess.org/swiss/${encodeURIComponent(id)}`;

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

// `signal` lets the caller give up: on a request still waiting its turn, in flight, or waiting after a 429. A body is
// either a form or plain text. `accept` defaults to JSON; `timeoutMs` to 30 s for each attempt, its reading included.
type Options = {
  method?: "GET" | "POST" | "DELETE";
  token?: string;
  form?: Record<string, string>;
  text?: string;
  accept?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

// A signal that aborts after `ms`, or as soon as `within` does. Call `clear` once it is no longer needed.
export function timeLimit(ms: number, reason: string, within?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(reason)), ms);
  const follow = () => controller.abort(within!.reason);
  if (within?.aborted) follow();
  else within?.addEventListener("abort", follow, { once: true });
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      within?.removeEventListener("abort", follow);
    },
  };
}

// Settles with `promise`, or rejects as soon as `signal` aborts.
function unlessAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  ]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One attempt, the request and the reading of its answer, within 30 seconds unless the caller allows longer.
async function attempt<T>(
  path: string,
  { method = "GET", token, form, text, accept = "application/json", timeoutMs = TIMEOUT_MS, signal }: Options,
  read: (response: Response) => Promise<T> | T,
): Promise<T> {
  const limit = timeLimit(timeoutMs, `Lichess did not answer ${method} ${path} within ${timeoutMs / 1000} s`, signal);
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: accept };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (text !== undefined) headers["Content-Type"] = "text/plain";
  try {
    const response = await fetch(lichessUrl(path), {
      method,
      headers,
      body: form ? new URLSearchParams(form) : text,
      // A redirect would carry the token somewhere unchecked; Lichess's API does not redirect.
      redirect: "manual",
      signal: limit.signal,
    });
    try {
      return await unlessAborted(Promise.resolve(read(response)), limit.signal);
    } finally {
      if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
    }
  } finally {
    limit.clear();
  }
}

// Settles once the request in progress, if any, has finished, its body included.
// ponytail: one at a time within one server instance only; if Lichess rate-limits the site while several instances
// run at once, send every request through one shared queue instead.
let previous: Promise<unknown> = Promise.resolve();

const RATE_LIMITED = Symbol("429");

// Sends one request once the previous one has finished, and hands the response to `read`, which must be done with
// the body before the next request goes out. After a 429 it waits a minute and tries once more; `read` gets
// whatever that second answer is.
export function lichessRequest<T>(path: string, options: Options, read: (response: Response) => Promise<T> | T): Promise<T> {
  const turn = previous;
  const result = (async () => {
    await unlessAborted(turn, options.signal);
    const first = await attempt(path, options, (response) => (response.status === 429 ? RATE_LIMITED : read(response)));
    if (first !== RATE_LIMITED) return first;
    await unlessAborted(sleep(RATE_LIMIT_WAIT_MS), options.signal);
    return attempt(path, options, read);
  })();
  // A request given up while waiting its turn still holds the next one back until the one before it has finished.
  previous = Promise.allSettled([turn, result]);
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
export const exchangeCode = (
  p: { code: string; verifier: string; redirectUri: string; clientId: string },
  signal?: AbortSignal,
) =>
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
      signal,
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
export const revokeToken = (token: string, signal?: AbortSignal) =>
  lichessRequest("/api/token", { method: "DELETE", token, signal }, (response) => response.ok);

// --- Accounts ---

export type LichessAccount = { id: string; username: string; blitzRating: number | null };

const NAME = /^[A-Za-z0-9_-]{2,30}$/;

// GET /api/account: the account the token belongs to. Lichess leaves out "tosViolation" when an account looks at
// itself, so this cannot tell whether it is marked: see isMarked. A closed account's token is refused (401).
export const getAccount = (token: string, signal?: AbortSignal) =>
  lichessRequest("/api/account", { token, signal }, async (response): Promise<LichessAccount> => {
    if (!response.ok) throw await refused("GET /api/account", response);
    const body = await response.json();
    if (typeof body?.id !== "string" || typeof body.username !== "string" || !NAME.test(body.id) || !NAME.test(body.username))
      throw new LichessError("GET /api/account", response.status, "no usable account");
    const rating = body.perfs?.blitz?.rating;
    return { id: body.id, username: body.username, blitzRating: Number.isInteger(rating) ? rating : null };
  });

// GET /api/user/{id}, deliberately without a token: whether Lichess has marked the account for breaking its terms
// of service (an engine or boosting mark), which it shows to everyone except the account itself.
export const isMarked = (id: string, signal?: AbortSignal) =>
  lichessRequest(`/api/user/${encodeURIComponent(id)}`, { signal }, async (response) => {
    if (!response.ok) throw await refused("GET /api/user/{id}", response);
    const body = await response.json();
    if (typeof body?.id !== "string" || body.id !== id) throw new LichessError("GET /api/user/{id}", response.status, "another account");
    return body.tosViolation === true;
  });

// --- Teams ---

// POST /team/{teamId}/join, needing the team:write scope. Lichess answers 200 when the account is already a member
// too. A wrong password is refused with 403 in the spec (400 "This team requires a password." in practice).
export const joinTeam = (token: string, teamId: string, password: string, signal?: AbortSignal) =>
  lichessRequest(
    `/team/${encodeURIComponent(teamId)}/join`,
    { method: "POST", token, form: { password }, signal },
    async (response) => {
      if (!response.ok) throw await refused("POST /team/{teamId}/join", response);
    },
  );

// --- Accounts in bulk ---

export type PublicAccount = { id: string; blitzRating: number | null; marked: boolean; closed: boolean };

const ACCOUNTS_PER_REQUEST = 300;

// Accounts by id, each with its blitz rating and its marks as everyone else sees them, 300 to a request.
export async function getPublicAccounts(ids: string[], signal?: AbortSignal): Promise<PublicAccount[]> {
  const accounts: PublicAccount[] = [];
  for (let i = 0; i < ids.length; i += ACCOUNTS_PER_REQUEST)
    accounts.push(...(await publicAccounts(ids.slice(i, i + ACCOUNTS_PER_REQUEST), signal)));
  return accounts;
}

// POST /api/users?profile=false, deliberately without a token, for up to 300 ids. "tosViolation" is the mark for
// breaking Lichess's terms of service, shown to everyone but the account itself; a closed account comes back as only
// { id, username, disabled: true }; an account Lichess no longer has at all is left out.
const publicAccounts = (ids: string[], signal?: AbortSignal) =>
  lichessRequest(
    "/api/users?profile=false",
    { method: "POST", text: ids.join(","), signal },
    async (response): Promise<PublicAccount[]> => {
      if (!response.ok) throw await refused("POST /api/users", response);
      const body: unknown = await response.json();
      const asked = new Set(ids);
      if (!Array.isArray(body) || !body.every((account) => typeof account?.id === "string" && asked.has(account.id)))
        throw new LichessError("POST /api/users", response.status, "accounts other than those asked for");
      return body.map((account) => {
        const rating = account.perfs?.blitz?.rating;
        return {
          id: account.id,
          blitzRating: Number.isInteger(rating) ? rating : null,
          marked: account.tosViolation === true,
          closed: account.disabled === true,
        };
      });
    },
  );

// --- Swiss tournaments, which is what every Matchday is (docs/adr/0001) ---

// Lichess's Swiss tournament ids: eight letters and digits.
export const SWISS_ID = /^[A-Za-z0-9]{8}$/;

export type Swiss = { id: string; status: "created" | "started" | "finished"; startsAt: Date };

const NDJSON = "application/x-ndjson";

function readSwiss(body: unknown): Swiss | null {
  const { id, status, startsAt } = (body ?? {}) as Record<string, unknown>;
  const start = typeof startsAt === "string" ? new Date(startsAt) : null;
  if (typeof id !== "string" || !SWISS_ID.test(id) || !start || Number.isNaN(start.getTime())) return null;
  return status === "created" || status === "started" || status === "finished" ? { id, status, startsAt: start } : null;
}

// GET /api/swiss/{id}: the tournament's state and start, or null if Lichess has no such tournament. It does not say
// which team the tournament belongs to: see teamHasSwiss.
export const getSwiss = (id: string, signal?: AbortSignal) =>
  lichessRequest(`/api/swiss/${encodeURIComponent(id)}`, { signal }, async (response): Promise<Swiss | null> => {
    if (response.status === 404) return null;
    if (!response.ok) throw await refused("GET /api/swiss/{id}", response);
    const swiss = readSwiss(await response.json());
    if (swiss?.id !== id) throw new LichessError("GET /api/swiss/{id}", response.status, "no usable tournament");
    return swiss;
  });

// The lines of an ndjson answer, parsed as they arrive, so that reading can stop early; the rest is then not downloaded.
async function* ndjsonLines(response: Response): AsyncGenerator<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let rest = "";
  try {
    for (let done = false; !done; ) {
      const chunk = await reader.read();
      done = chunk.done;
      const lines = (rest + decoder.decode(chunk.value, { stream: !done })).split("\n");
      rest = done ? "" : lines.pop()!;
      for (const line of lines) if (line.trim()) yield JSON.parse(line);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

// More tournaments than the Club will hold for years, and still listed within 30 s at the 20 a second Lichess sends.
const TEAM_SWISS_MAX = 300;

// GET /api/team/{teamId}/swiss: whether the tournament is one of the team's. Lichess lists a team's tournaments as
// ndjson, latest start first, so reading stops at the tournament or at the first one that starts before it.
export const teamHasSwiss = (teamId: string, swiss: Swiss, signal?: AbortSignal) =>
  lichessRequest(
    `/api/team/${encodeURIComponent(teamId)}/swiss?max=${TEAM_SWISS_MAX}`,
    { accept: NDJSON, signal },
    async (response) => {
      if (!response.ok) throw await refused("GET /api/team/{teamId}/swiss", response);
      for await (const line of ndjsonLines(response)) {
        const listed = readSwiss(line);
        if (!listed) throw new LichessError("GET /api/team/{teamId}/swiss", response.status, "no usable tournament");
        if (listed.id === swiss.id) return true;
        if (listed.startsAt < swiss.startsAt) return false;
      }
      return false;
    },
  );

// GET /api/swiss/{id}/results: every participant's final standing, best first, as the ndjson text ingestMatchday reads.
export const swissResults = (id: string, signal?: AbortSignal) =>
  lichessRequest(`/api/swiss/${encodeURIComponent(id)}/results`, { accept: NDJSON, signal }, async (response) => {
    if (!response.ok) throw await refused("GET /api/swiss/{id}/results", response);
    return response.text();
  });

// Lichess sends a request without a token at most 20 Games a second: five rounds of 300 players take under 40 s.
const GAMES_TIMEOUT_MS = 300_000;

// GET /api/swiss/{id}/games: every Game of the tournament with its moves and clock times, oldest first, as the ndjson
// text ingestMatchday reads. Without the ndjson Accept header Lichess answers in PGN, and without clocks=true it leaves
// the clock times out.
export const swissGames = (id: string, signal?: AbortSignal) =>
  lichessRequest(
    `/api/swiss/${encodeURIComponent(id)}/games?moves=true&clocks=true`,
    { accept: NDJSON, timeoutMs: GAMES_TIMEOUT_MS, signal },
    async (response) => {
      if (!response.ok) throw await refused("GET /api/swiss/{id}/games", response);
      return response.text();
    },
  );
