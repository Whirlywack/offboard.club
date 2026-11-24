// A fake Lichess for tests and local runs: the authorization page, the token endpoint, the account, a public user,
// joining a team and revoking a token, behaving as Lichess's OpenAPI spec describes and, where lichess.org differs,
// as lichess.org's source (lila) does:
// - a wrong team password is a 400 there, a 403 in the spec;
// - "tosViolation" is shown to everyone except the account itself, so never on /api/account;
// - a closed ("disabled") account's token is refused, and its public user is only { id, username, disabled }.
//
// Use `fetch` in place of the global one. The authorization page is the browser's, not the site's, so visits to it
// are not recorded in `calls`; it approves as `signedInAs`, or declines when that is null.

import { createHash, randomBytes } from "node:crypto";

export type FakeAccount = {
  id: string;
  username: string;
  perfs?: { blitz?: { games: number; rating: number; rd: number; prog: number } };
  disabled?: boolean;
  tosViolation?: boolean;
};

export type FakeCall = {
  method: string;
  path: string;
  authorization: string | null;
  userAgent: string | null;
  body: URLSearchParams;
};

type Code = { accountId: string; challenge: string; clientId: string; redirectUri: string; scope: string; used: boolean };
type Token = { accountId: string; scope: string; revoked: boolean };

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function createFakeLichess(options: { teamId: string; teamPassword: string; accounts: FakeAccount[] }) {
  const codes = new Map<string, Code>();
  const tokens = new Map<string, Token>();
  const fake = {
    accounts: new Map(options.accounts.map((account) => [account.id, account])),
    team: { id: options.teamId, password: options.teamPassword, members: new Set<string>() },
    calls: [] as FakeCall[],
    tokens,
    signedInAs: null as string | null,
    // Answers a call in place of the fake's own behaviour when it returns a Response.
    override: undefined as ((call: FakeCall) => Response | undefined) | undefined,

    fetch: (input: RequestInfo | URL, init?: RequestInit) => fake.handle(new Request(input, init)),

    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/oauth") return authorize(url);
      const call: FakeCall = {
        method: request.method,
        path: url.pathname,
        authorization: request.headers.get("authorization"),
        userAgent: request.headers.get("user-agent"),
        body: new URLSearchParams(request.method === "GET" ? "" : await request.text()),
      };
      fake.calls.push(call);
      const overridden = fake.override?.(call);
      if (overridden) return overridden;

      if (call.method === "POST" && call.path === "/api/token") return exchange(call.body);
      const user = /^\/api\/user\/([^/]+)$/.exec(call.path);
      if (call.method === "GET" && user) {
        const account = fake.accounts.get(decodeURIComponent(user[1]).toLowerCase());
        if (!account) return json({ error: "Not found" }, 404);
        if (account.disabled) return json({ id: account.id, username: account.username, disabled: true });
        const viewer = bearer(call)?.accountId;
        return json({ ...shown(account), ...(account.tosViolation && viewer !== account.id && { tosViolation: true }) });
      }
      const token = bearer(call);
      if (!token) return json({ error: "No such token" }, 401);
      if (call.method === "DELETE" && call.path === "/api/token") {
        token.revoked = true;
        return new Response(null, { status: 204 });
      }
      if (call.method === "GET" && call.path === "/api/account") return json(shown(fake.accounts.get(token.accountId)!));
      const join = /^\/team\/([^/]+)\/join$/.exec(call.path);
      if (call.method === "POST" && join) {
        if (!token.scope.split(" ").includes("team:write")) return json({ error: "Missing scope" }, 403);
        if (decodeURIComponent(join[1]) !== fake.team.id) return json({ error: "Not found" }, 404);
        if (call.body.get("password") !== fake.team.password) return json({ error: "This team requires a password." }, 400);
        fake.team.members.add(token.accountId); // already a member: nothing changes, still ok
        return json({ ok: true });
      }
      return json({ error: "Not found" }, 404);
    },
  };

  function authorize(url: URL): Response {
    const p = url.searchParams;
    const redirectUri = p.get("redirect_uri");
    if (p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || !p.get("client_id") || !redirectUri || !p.get("code_challenge"))
      return json({ error: "invalid_request" }, 400);
    const back = new URL(redirectUri);
    if (fake.signedInAs === null) {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("error_description", "user cancelled authorization");
    } else {
      const code = `liu_${randomBytes(12).toString("hex")}`;
      codes.set(code, {
        accountId: fake.signedInAs,
        challenge: p.get("code_challenge")!,
        clientId: p.get("client_id")!,
        redirectUri,
        scope: p.get("scope") ?? "",
        used: false,
      });
      back.searchParams.set("code", code);
    }
    if (p.has("state")) back.searchParams.set("state", p.get("state")!);
    return new Response(null, { status: 303, headers: { location: back.toString() } });
  }

  function exchange(body: URLSearchParams): Response {
    const code = codes.get(body.get("code") ?? "");
    const verifier = body.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      body.get("grant_type") !== "authorization_code" ||
      !code ||
      code.used ||
      code.clientId !== body.get("client_id") ||
      code.redirectUri !== body.get("redirect_uri") ||
      code.challenge !== challenge
    )
      return json({ error: "invalid_grant" }, 400);
    code.used = true;
    const token = `lio_${randomBytes(16).toString("hex")}`;
    tokens.set(token, { accountId: code.accountId, scope: code.scope, revoked: false });
    return json({ token_type: "Bearer", access_token: token, expires_in: 31_536_000 });
  }

  // A valid token, unless it is revoked or its account has been closed.
  function bearer(call: FakeCall): Token | null {
    const token = tokens.get(call.authorization?.replace(/^Bearer /, "") ?? "");
    return token && !token.revoked && !fake.accounts.get(token.accountId)?.disabled ? token : null;
  }

  // An account as Lichess shows it, its marks left out.
  function shown({ id, username, perfs }: FakeAccount) {
    return { id, username, perfs: perfs ?? {}, url: `https://lichess.org/@/${username}` };
  }

  return fake;
}
