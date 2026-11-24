// A fake Lichess for tests and local runs: the authorization page, the token endpoint, the account, public users one at
// a time and in bulk, joining a team, revoking a token, and Swiss tournaments with their results and Games, behaving as
// Lichess's OpenAPI spec describes and, where lichess.org differs, as lichess.org's source (lila) does:
// - a wrong team password is a 400 there, a 403 in the spec;
// - "tosViolation" is shown to everyone except the account itself, so never on /api/account;
// - a closed ("disabled") account's token is refused, and its public user is only { id, username, disabled };
// - POST /api/users takes the first 300 ids and leaves out accounts it does not have;
// - a Swiss tournament's own JSON does not say which team it is on; the team's list of tournaments, latest start
//   first, is what does;
// - a Swiss tournament's Games come as PGN unless the request accepts ndjson, and without clock times unless asked;
// - a team's own page lists the leaders shown publicly (`team.leaders`);
// - a new Swiss tournament needs a token with tournament:write whose account leads the team with its permission for
//   tournaments, else 404 "You're not a leader of that team", whatever the team's page shows; its form is checked as
//   lila's SwissForm checks it, and it must start after `now()`;
// - a team's tournaments can be listed by exact name, creator and status.
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

// A Swiss tournament, with its exports as Lichess sends them: `results` and `games` are ndjson text. One created through
// the API also keeps the form it was created with.
export type FakeSwiss = {
  id: string;
  teamId: string;
  status: "created" | "started" | "finished";
  startsAt: string;
  results: string;
  games: string;
  name?: string;
  createdBy?: string;
  form?: Record<string, string>;
};

export type FakeCall = {
  method: string;
  path: string;
  query: URLSearchParams;
  accept: string | null;
  authorization: string | null;
  userAgent: string | null;
  text: string;
  body: URLSearchParams;
};

type Code = { accountId: string; challenge: string; clientId: string; redirectUri: string; scope: string; used: boolean };
type Token = { accountId: string; scope: string; revoked: boolean };

const json = (body: unknown, status = 200) => Response.json(body, { status });

const ndjson = (lines: unknown[]) =>
  new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""), { headers: { "content-type": "application/x-ndjson" } });

export function createFakeLichess(options: { teamId: string; teamPassword: string; accounts: FakeAccount[]; tournaments?: FakeSwiss[] }) {
  const codes = new Map<string, Code>();
  const tokens = new Map<string, Token>();
  const fake = {
    accounts: new Map(options.accounts.map((account) => [account.id, account])),
    tournaments: new Map((options.tournaments ?? []).map((swiss) => [swiss.id, swiss])),
    // `leaders` are shown publicly on the team's page; of those, `withoutTournaments` lack the team's permission for
    // tournaments, which lila needs to create one (Swiss.apiCreate: isGranted(teamId, _.Tour)).
    team: {
      id: options.teamId,
      password: options.teamPassword,
      members: new Set<string>(),
      leaders: new Set<string>(),
      withoutTournaments: new Set<string>(),
    },
    calls: [] as FakeCall[],
    tokens,
    signedInAs: null as string | null,
    // Lichess's clock, for whether a tournament starts in the future.
    now: () => Date.now(),
    // Answers a call in place of the fake's own behaviour when it returns a Response.
    override: undefined as ((call: FakeCall) => Response | undefined) | undefined,

    fetch: (input: RequestInfo | URL, init?: RequestInit) => fake.handle(new Request(input, init)),

    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/oauth") return authorize(url);
      const text = request.method === "GET" ? "" : await request.text();
      const call: FakeCall = {
        method: request.method,
        path: url.pathname,
        query: url.searchParams,
        accept: request.headers.get("accept"),
        authorization: request.headers.get("authorization"),
        userAgent: request.headers.get("user-agent"),
        text,
        body: new URLSearchParams(text),
      };
      fake.calls.push(call);
      const overridden = fake.override?.(call);
      if (overridden) return overridden;

      if (call.method === "POST" && call.path === "/api/token") return exchange(call.body);
      const user = /^\/api\/user\/([^/]+)$/.exec(call.path);
      if (call.method === "GET" && user) {
        const account = fake.accounts.get(decodeURIComponent(user[1]).toLowerCase());
        if (!account) return json({ error: "Not found" }, 404);
        return json(publicUser(account, bearer(call)?.accountId));
      }
      if (call.method === "POST" && call.path === "/api/users") {
        const ids = call.text.replace(/\n/g, "").split(",").slice(0, 300).map((id) => id.trim().toLowerCase());
        const viewer = bearer(call)?.accountId;
        return json(ids.flatMap((id) => (fake.accounts.has(id) ? [publicUser(fake.accounts.get(id)!, viewer)] : [])));
      }
      const swiss = /^\/api\/swiss\/([^/]+)(\/results|\/games)?$/.exec(call.path);
      if (call.method === "GET" && swiss) return swissAnswer(call, decodeURIComponent(swiss[1]), swiss[2]);
      const teamSwiss = /^\/api\/team\/([^/]+)\/swiss$/.exec(call.path);
      if (call.method === "GET" && teamSwiss) {
        const [name, createdBy, status] = ["name", "createdBy", "status"].map((key) => call.query.get(key));
        const listed = [...fake.tournaments.values()]
          .filter((t) => t.teamId === decodeURIComponent(teamSwiss[1]))
          .filter((t) => (name === null || swissJson(t).name === name) && (createdBy === null || swissJson(t).createdBy === createdBy))
          .filter((t) => status === null || t.status === status)
          .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
          .slice(0, Number(call.query.get("max") ?? 100));
        return ndjson(listed.map(swissJson));
      }
      const team = /^\/api\/team\/([^/]+)$/.exec(call.path);
      if (call.method === "GET" && team) {
        if (decodeURIComponent(team[1]) !== fake.team.id) return json({ error: "Not found" }, 404);
        const leaders = [...fake.team.leaders].map((id) => ({ id, name: fake.accounts.get(id)?.username ?? id }));
        return json({ id: fake.team.id, name: "Offboard", open: false, leader: leaders[0], nbMembers: fake.team.members.size, leaders });
      }
      const token = bearer(call);
      if (!token) return json({ error: "No such token" }, 401);
      const newSwiss = /^\/api\/swiss\/new\/([^/]+)$/.exec(call.path);
      if (call.method === "POST" && newSwiss) return createSwiss(call, token, decodeURIComponent(newSwiss[1]));
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

  // An account as Lichess shows it to `viewer`, who may be nobody: its mark, unless it is the viewer's own, and only
  // its name if it is closed.
  function publicUser(account: FakeAccount, viewer: string | undefined) {
    if (account.disabled) return { id: account.id, username: account.username, disabled: true };
    return { ...shown(account), ...(account.tosViolation && viewer !== account.id && { tosViolation: true }) };
  }

  // POST /api/swiss/new/{teamId}, checked as lila's Swiss.apiCreate and SwissForm check it.
  function createSwiss(call: FakeCall, token: Token, teamId: string): Response {
    if (!token.scope.split(" ").includes("tournament:write")) return json({ error: "Missing scope" }, 403);
    const granted = fake.team.leaders.has(token.accountId) && !fake.team.withoutTournaments.has(token.accountId);
    if (teamId !== fake.team.id || !granted) return json({ error: "You're not a leader of that team" }, 404);
    const form = Object.fromEntries(call.body);
    const int = (key: string) => (/^-?\d+$/.test(form[key] ?? "") ? Number(form[key]) : null);
    const limit = int("clock.limit");
    const increment = int("clock.increment");
    const rounds = int("nbRounds");
    const startsAt = form.startsAt === undefined ? fake.now() + 600_000 : int("startsAt");
    const name = form.name;
    const problems = [
      limit === null || ![0, 15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 600, 900].includes(limit) ? "clock.limit" : null,
      increment === null || increment < 0 || increment > 120 ? "clock.increment" : null,
      rounds === null || rounds < 3 || rounds > 100 ? "nbRounds" : null,
      startsAt === null || startsAt <= fake.now() ? "startsAt" : null,
      name !== undefined && (!/^[\p{L}\p{N}\-\s:.,;'°ª+]{2,30}$/u.test(name) || /lichess/i.test(name)) ? "name" : null,
      ...["rated", "conditions.playYourGames"].map((key) => (key in form && !["true", "false"].includes(form[key]) ? key : null)),
    ].filter(Boolean);
    if (problems.length > 0) return json({ error: Object.fromEntries(problems.map((key) => [key, ["Invalid value"]])) }, 400);
    const swiss: FakeSwiss = {
      id: randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8),
      teamId,
      status: "created",
      startsAt: new Date(startsAt!).toISOString(),
      results: "",
      games: "",
      name: name ?? "Random Grandmaster",
      createdBy: token.accountId,
      form,
    };
    fake.tournaments.set(swiss.id, swiss);
    return json(swissJson(swiss));
  }

  // A tournament as GET /api/swiss/{id} shows it: no team. One created through the API shows what it was created with.
  function swissJson({ id, status, startsAt, name = "Offboard Matchday", createdBy = "organiser", form = {} }: FakeSwiss) {
    const nbRounds = Number(form.nbRounds ?? 5);
    return {
      id,
      createdBy,
      startsAt,
      name,
      clock: { limit: Number(form["clock.limit"] ?? 300), increment: Number(form["clock.increment"] ?? 3) },
      variant: "standard",
      round: status === "created" ? 0 : nbRounds,
      nbRounds,
      nbPlayers: 0,
      nbOngoing: status === "started" ? 1 : 0,
      status,
      verdicts: { list: [], accepted: true },
      rated: form.rated !== "false",
    };
  }

  function swissAnswer(call: FakeCall, id: string, part: string | undefined): Response {
    const swiss = fake.tournaments.get(id);
    if (!swiss) return json({ error: "Not found" }, 404);
    if (!part) return json(swissJson(swiss));
    const lines = (text: string) => text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    if (part === "/results") return ndjson(lines(swiss.results));
    if (!call.accept?.includes("application/x-ndjson"))
      return new Response(`[Event "Offboard Matchday"]\n\n1. e4 *\n`, { headers: { "content-type": "application/x-chess-pgn" } });
    const clocks = call.query.get("clocks") === "true";
    const moves = call.query.get("moves") !== "false";
    return ndjson(
      lines(swiss.games).map(({ clocks: clockTimes, moves: played, ...game }) => ({
        ...game,
        ...(moves && { moves: played }),
        ...(clocks && clockTimes && { clocks: clockTimes }),
      })),
    );
  }

  return fake;
}
