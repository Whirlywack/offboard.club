// The tests' fake Lichess (lib/fixtures/fake-lichess.ts) as a server at LICHESS_URL, so that connecting Lichess works in
// a browser without lichess.org: a Member's Connect Lichess step and "Switch Lichess account", and the Organiser's
// "Connect Lichess" on /organiser; and the tournaments the latest seed played on it (fake-lichess.json beside the
// database, which `pnpm seed season-over` fills), for `pnpm collect-results` to collect. `pnpm fake-lichess`, in the
// foreground beside `pnpm dev:local`, with the block from `pnpm db:start` in .env.local; it listens on 127.0.0.1 alone
// and logs each request's method, path and status.
//
// Its approval page asks who you are on Lichess: a new account, which connects (and which /organiser refuses, as it
// leads no team); a seeded Member's, as the database has it then, which is "taken", "marked" for the marked one, and
// fails for the closed one; the Organiser's, which leads the Club's team; or nobody, which declines.
//
// The Organiser's permission the seed stores was issued by a fake inside the seed, which this one does not know: until
// the Organiser connects Lichess again on /organiser, removing someone who leaves (/profile/leave), or the account a
// Member switched from, from the team is refused, and the Organiser page lists that account to remove by hand.
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { notLocal, recorder } from "./local-db.mjs";
import { db } from "@/lib/db";
import { createFakeLichess, type FakeAccount, type FakeSwiss } from "@/lib/fixtures/fake-lichess";

if (process.argv.length > 2) {
  console.error("Usage: pnpm fake-lichess, with no arguments.");
  process.exit(1);
}
const address = URL.parse(process.env.LICHESS_URL ?? "");
const why = notLocal(process.env.DATABASE_URL) ?? (address?.hostname === "127.0.0.1" ? null : "LICHESS_URL is not http://127.0.0.1:<port>");
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

let played: string | undefined; // the seed's file

// Every connected account as the database has it now, the Organiser's as the team's leader, and the tournaments the
// latest seed played.
async function refresh() {
  type Row = { userId: string; id: string; username: string; rating: number | null; marked: boolean; closed: boolean };
  const { rows } = await db.query<Row>(
    `select id as "userId", "lichessId" as id, "lichessUsername" as username, "lichessBlitzRating" as rating,
       "lichessMarked" as marked, "lichessClosed" as closed from "user" where "lichessId" is not null order by "lichessUsername"`,
  );
  for (const { id, username, rating, marked, closed } of rows)
    lichess.accounts.set(id, { id, username, perfs: rating === null ? {} : { blitz: blitz(rating) }, tosViolation: marked, disabled: closed });
  lichess.team.leaders.clear();
  for (const row of rows) if (row.userId === process.env.ORGANISER_USER_ID) lichess.team.leaders.add(row.id);
  played ??= `${(await db.query<{ data_directory: string }>("show data_directory")).rows[0].data_directory}/fake-lichess.json`;
  if (existsSync(played)) for (const swiss of JSON.parse(readFileSync(played, "utf8")) as FakeSwiss[]) lichess.tournaments.set(swiss.id, swiss);
}

// The page Lichess shows when asking the person to approve Offboard, with a choice of who they are.
function approval(url: URL) {
  const choice = (as: string, label: string) => {
    const to = new URL(url);
    to.searchParams.set("as", as);
    return `<li><a href="${(to.pathname + to.search).replaceAll("&", "&amp;")}">${label}</a></li>`;
  };
  const whose = (a: FakeAccount) =>
    a.tosViolation ? " (marked)" : a.disabled ? " (closed)" : lichess.team.leaders.has(a.id) ? ", the Organiser's, which leads the team" : ", already another Member's";
  const accounts = [...lichess.accounts.values()].map((a) => choice(a.id, `As ${a.username}${whose(a)}`));
  const page = `<!doctype html><meta charset="utf-8"><title>Fake Lichess</title><h1>Fake Lichess: approve Offboard?</h1>
<ul>${choice("new", "As a new Lichess account")}${accounts.join("")}${choice("none", "Decline")}</ul>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function answer(request: import("node:http").IncomingMessage, url: URL): Promise<Response> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  await refresh();
  if (url.pathname === "/oauth" && !url.searchParams.has("as")) return approval(url);
  if (url.pathname === "/oauth") {
    const as = url.searchParams.get("as");
    url.searchParams.delete("as");
    if (as === "new") {
      const id = `pretend--newcomer-${++newcomers}`;
      lichess.accounts.set(id, { id, username: `Pretend--Newcomer-${newcomers}`, perfs: { blitz: blitz(1500) } });
    }
    lichess.signedInAs = as === "new" ? `pretend--newcomer-${newcomers}` : as === "none" ? null : as;
  }
  const headers = Object.entries(request.headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : []));
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return lichess.handle(new Request(url, { method: request.method, headers: headers as [string, string][], body }));
}

const record = recorder(); // for pnpm local:list and pnpm local:stop, found before listening
createServer(async (request, reply) => {
  const url = new URL(request.url ?? "/", address);
  // A request the fake cannot make sense of, such as a redirect_uri that is not an address, is answered, not fatal.
  const response = await answer(request, url).catch(
    (error: Error) => new Response(`The fake Lichess could not answer that: ${error.message}`, { status: 400 }),
  );
  console.log(`${request.method} ${url.pathname} ${response.status}`);
  reply.writeHead(response.status, Object.fromEntries(response.headers));
  reply.end(Buffer.from(await response.arrayBuffer()));
})
  .once("error", (error) => {
    console.error(`The fake Lichess could not listen at ${address.origin}: ${error.message}`);
    process.exit(1);
  })
  .listen(Number(address.port), "127.0.0.1", () => {
    record("fake Lichess", Number(address.port));
    console.log(`The fake Lichess is at ${address.origin}.`);
  });
