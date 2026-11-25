// The tests' fake Lichess (lib/fixtures/fake-lichess.ts) as a server at LICHESS_URL, so that the Connect Lichess step
// and the Profile's "Switch Lichess account" work in a browser without lichess.org. Run beside `pnpm dev`, with the
// block from `pnpm db:start` in .env.local:
//
//   pnpm fake-lichess
//
// Its approval page asks who you are on Lichess: a new account, which connects; any seeded Member's, which is "taken",
// or for the marked one "marked", and for the closed one fails; or nobody, which declines. Started with another team
// password than the site's (LICHESS_TEAM_PASSWORD=wrong pnpm fake-lichess), it refuses to add anyone to the team.
// It knows the Members' accounts as they were when it started, so restart it after `pnpm seed`. Each request is
// logged, method, path and status. Stop it with Ctrl-C, or `pnpm db:stop`.
import { createServer } from "node:http";
import { notLocal } from "./local-db.mjs";
import { db } from "@/lib/db";
import { createFakeLichess } from "@/lib/fixtures/fake-lichess";

const address = URL.parse(process.env.LICHESS_URL ?? "");
const why =
  notLocal(process.env.DATABASE_URL) ?? (address?.hostname === "127.0.0.1" ? null : "LICHESS_URL is not http://127.0.0.1:<port>");
if (why || !address) {
  console.error(`Refusing to start the fake Lichess: ${why}. Put the block from pnpm db:start in .env.local.`);
  process.exit(1);
}

const blitz = (rating: number) => ({ games: 100, rating, rd: 60, prog: 0 });
const lichess = createFakeLichess({
  teamId: process.env.LICHESS_TEAM_ID ?? "",
  teamPassword: process.env.LICHESS_TEAM_PASSWORD ?? "",
  accounts: [],
});
let newcomers = 0;

// The page Lichess shows when asking the person to approve Offboard, with a choice of who they are.
function approval(url: URL) {
  const choice = (as: string, label: string) => {
    const to = new URL(url);
    to.searchParams.set("as", as);
    return `<li><a href="${(to.pathname + to.search).replaceAll("&", "&amp;")}">${label}</a></li>`;
  };
  const accounts = [...lichess.accounts.values()].map((a) =>
    choice(a.id, `As ${a.username}${a.tosViolation ? " (marked)" : a.disabled ? " (closed)" : ", already another Member's"}`),
  );
  const page = `<!doctype html><meta charset="utf-8"><title>Fake Lichess</title><h1>Fake Lichess: approve Offboard?</h1>
<ul>${choice("new", "As a new Lichess account")}${accounts.join("")}${choice("none", "Decline")}</ul>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
}

const server = createServer(async (request, reply) => {
  const url = new URL(request.url ?? "/", address);
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  let response: Response;
  if (url.pathname === "/oauth" && !url.searchParams.has("as")) response = approval(url);
  else {
    if (url.pathname === "/oauth") {
      const as = url.searchParams.get("as");
      url.searchParams.delete("as");
      if (as === "new") {
        const id = `pretend-newcomer-${++newcomers}`;
        lichess.accounts.set(id, { id, username: `Pretend-Newcomer-${newcomers}`, perfs: { blitz: blitz(1500) } });
      }
      lichess.signedInAs = as === "new" ? `pretend-newcomer-${newcomers}` : as === "none" ? null : as;
    }
    const headers = Object.entries(request.headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : []));
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    response = await lichess.handle(new Request(url, { method: request.method, headers: headers as [string, string][], body }));
  }
  console.log(`${request.method} ${url.pathname} ${response.status}`);
  reply.writeHead(response.status, Object.fromEntries(response.headers));
  reply.end(Buffer.from(await response.arrayBuffer()));
});

// Every seeded Member's account, as Lichess would show it, then the server.
db.query<{ id: string; username: string; rating: number | null; marked: boolean; closed: boolean }>(
  `select "lichessId" as id, "lichessUsername" as username, "lichessBlitzRating" as rating, "lichessMarked" as marked,
     "lichessClosed" as closed from "user" where "lichessId" is not null order by "lichessUsername"`,
).then(async ({ rows }) => {
  await db.end();
  for (const { id, username, rating, marked, closed } of rows)
    lichess.accounts.set(id, { id, username, perfs: rating === null ? {} : { blitz: blitz(rating) }, tosViolation: marked, disabled: closed });
  server.listen(Number(address.port), "127.0.0.1", () => console.log(`The fake Lichess is at ${address.origin}.`));
});
