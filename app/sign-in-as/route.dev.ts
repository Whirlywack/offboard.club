// The switch between people in the local site: open /sign-in-as and press a button to look at the site as a visitor,
// someone part-way through signing up, a Member or the Organiser. GET lists everyone in the database; POST signs this
// browser in as the one chosen, in a new session of their own, or out for a visitor, and goes to the home page.
//
// It is a way round signing in, so it exists only where nothing is real. It is in no production build at all: its file
// name ends in .dev.ts, which next.config.ts makes a route for `next dev` alone, and a production build answers 404 at
// its address (app/sign-in-as.test.ts). Under `next dev` it refuses, before anything else, any database but one
// `pnpm db:start` made on this machine, by the seed's own tests of one: `pnpm dev` with the main checkout's settings,
// whose database is a copy of live with its real accounts, gets a 403.
import { randomBytes, randomUUID } from "node:crypto";
import { mustWelcome } from "@/lib/consent";
import { db } from "@/lib/db";
import { mustConnectLichess } from "@/lib/members";
import { isOrganiser } from "@/lib/organiser";
import { SESSION_COOKIE, signedSession } from "@/lib/session-cookie";
import { madeByDbStart, notLocal } from "@/scripts/local-db.mjs";

// Why the switch must not run here, or null on a database db:start made on this machine. The address is asked first,
// so that a database that is not on this machine is not reached at all.
async function refusal() {
  const why = notLocal(process.env.DATABASE_URL);
  if (why) return `Refusing: ${why}. The switch between people works only on a database pnpm db:start made on this machine.`;
  if (!(await madeByDbStart(db))) return "Refusing: this database was not made by pnpm db:start, so the switch between people leaves it alone.";
  return null;
}

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const escape = (value: string) => value.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

type Person = { id: string; name: string; publicDisplayConsentAt: Date | null; houseRulesAcceptedAt: Date | null; lichessId: string | null };

export async function GET() {
  const why = await refusal();
  if (why) return text(why, 403);
  const { rows } = await db.query<Person>(
    `select id, name, "publicDisplayConsentAt", "houseRulesAcceptedAt", "lichessId" from "user" order by name, id`,
  );
  const button = (p: Person, note = "") =>
    `<li><button name="as" value="${escape(p.id)}">${escape(p.name)}</button> <code>${escape(p.id)}</code>${note}</li>`;
  const partWay = rows.filter((p) => mustWelcome(p) || mustConnectLichess(p));
  const groups = [
    ["The Organiser", rows.filter((p) => isOrganiser(p)).map((p) => button(p))],
    ["Members", rows.filter((p) => !isOrganiser(p) && !partWay.includes(p)).map((p) => button(p))],
    ["Part-way through signing up", partWay.map((p) => button(p, mustWelcome(p) ? ", has not agreed yet" : ", has agreed, no Lichess yet"))],
  ] as const;
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in as anyone</title>
<main>
<h1>Sign in as anyone</h1>
<p>On this local site only. Each button signs this browser in as that person, or out, and goes to the home page.</p>
<form method="post">
<p><button name="as" value="">A visitor</button>, signed out</p>
${groups.map(([title, items]) => (items.length ? `<h2>${title}</h2>\n<ul>\n${items.join("\n")}\n</ul>` : "")).join("\n")}
</form>
${rows.length ? "" : "<p>Nobody is in this database yet: pnpm seed.</p>"}
</main>
</html>
`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST(request: Request) {
  const why = await refusal();
  if (why) return text(why, 403);
  const id = String((await request.formData()).get("as") ?? "");
  const home = (value: string, end = "") =>
    new Response(null, { status: 303, headers: { location: "/", "set-cookie": `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${end}` } });
  if (!id) return home("", "; Max-Age=0");
  // A session of its own, as signing in makes one: the seeded session of the same person is gone once anyone signs
  // out of it on the site.
  const token = randomBytes(32).toString("base64url");
  const { rowCount } = await db.query(
    `insert into "session" (id, "expiresAt", token, "updatedAt", "userId")
     select $1, now() + interval '7 days', $2, now(), id from "user" where id = $3`,
    [randomUUID(), token, id],
  );
  if (!rowCount) return text(`Nobody in this database has the id ${id}.`, 404);
  return home(signedSession(token));
}
