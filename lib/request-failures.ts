// Requests that fail on the server (#60): a page, a route, a server action or the proxy that throws, as Next.js hands
// each to instrumentation.ts, or that catches a failure itself to show something in its place (noticeLater). Each is
// recorded by its kind in "requestFailure" (migrations/012_request_failures.sql), where the Organiser page shows the
// latest and the private alerts (lib/alerts.ts) tell the Organiser of each kind once a day. A request never messages the
// Organiser itself, so however many fail, they send nothing: when the database cannot be used, the alerts' own hourly
// run says so (alertWithoutDatabase in lib/alerts.ts).
//
// What is kept and said of a failure holds nothing a person sent or an error said, which could name a Member, hold what
// they typed or give the database's address: the route's shape from the app's own folders, never the address asked
// for, and a reason from the fixed list below. And nothing a visitor can cause at will is a failure (#60 review).

import { waitUntil } from "@vercel/functions";
import type { Instrumentation } from "next";
import { unstable_rethrow } from "next/navigation";
import { db } from "./db";

type Context = Pick<Parameters<Instrumentation.onRequestError>[2], "routePath" | "routeType">;

// Next.js's routeType: a page's render, a route handler, a server action, the proxy.
const KINDS: Record<Context["routeType"], string> = { render: "page", route: "route", action: "server action", proxy: "proxy" };

// The route as Next.js names it from the app's folders, such as "/recaps/[date]", or "/recaps/[date]/page" on some of
// its paths (node_modules/next/dist/build/templates/app-page-runtime.js); held to what such a name has.
const ROUTE = /^\/[\w.[\]/-]{0,200}$/;
function shape(routePath: string) {
  const route = routePath.replace(/\/(page|route)$/, "") || "/";
  return ROUTE.test(route) ? route : "an unknown address";
}

// The mark lib/db.ts puts on what the site's pool throws, by the same Symbol.for key: an error is the database's only
// when it has it, as a code such as ECONNRESET is any socket's, a visitor's who drops an upload included (#60 review).
const FROM_DATABASE = Symbol.for("offboard.from-database");
// Node's codes for a connection that was never made or was cut, and pg's words when it gave up on one or lost it.
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]);
const UNREACHABLE = /^(Connection terminated due to connection timeout|Connection terminated unexpectedly|timeout exceeded when trying to connect)$/;
const DATABASE = "the database";

// Why it failed, in words from a fixed list, looking through the error and what caused it, five deep, as the sign-in
// library wraps the database's error in its own ("Failed to get session"). A fetch that failed is another site's. Of
// what the pool threw, a code with a severity is Postgres's own error (SQLSTATE), whose message can quote a value a
// person sent, and a connection that could not be made or was lost is the database's being out of reach.
export const reasonOf = (error: unknown) => causeOf(error, 0) ?? thrown(error);

function causeOf(error: unknown, depth: number): string | null {
  if (!(error instanceof Object) || depth === 5) return null;
  const { message, code, cause } = error as { message?: unknown; code?: unknown; cause?: unknown };
  if (message === "fetch failed") return "another site couldn't be reached";
  if (Object.hasOwn(error, FROM_DATABASE)) {
    if ("severity" in error && typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `${DATABASE} refused it (error ${code})`;
    if ((typeof code === "string" && UNREACHABLE_CODES.has(code)) || (typeof message === "string" && UNREACHABLE.test(message)))
      return `${DATABASE} couldn't be reached`;
  }
  return causeOf(cause, depth + 1);
}

// The error's own name, such as TypeError, when it is a name.
function thrown(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Z][A-Za-z]{0,39}$/.test(name) ? `the code threw ${name}` : "the code threw an error";
}

// Whether `value` is `error` or one of the errors that caused it, five deep.
const isCause = (value: unknown, error: unknown, depth = 0): boolean =>
  depth < 5 && error instanceof Object && (value === error || isCause(value, (error as { cause?: unknown }).cause, depth + 1));

// What Next.js throws at a router state header it cannot read, which no page of the site sends
// (node_modules/next/dist/server/app-render/parse-and-validate-flight-router-state.js).
const ROUTER_STATE = new Set([
  "The router state header was sent but could not be parsed.",
  "Multiple router state headers were sent. This is not allowed.",
  "The router state header was too large.",
]);

export type FailedRequest = { route: string; kind: string; reason: string; at: Date };

// How an alert and a log line say it.
export const failedRequestText = ({ route, kind, reason }: Omit<FailedRequest, "at">) => `A ${kind} failed at ${route}: ${reason}.`;

// The kinds this process is recording right now, shared by the hook's copy of this module and the pages' (Symbol.for):
// a failure of a kind already on its way is not recorded again, so while the database is slow or down, however many
// requests hand their failures over, each kind costs one statement at a time, and one log line when it fails, rather
// than one of each a failure, all to land on one row once the database is back (#60 review).
const RECORDING = Symbol.for("offboard.recording-failures");
const recording: Set<string> = ((globalThis as Record<symbol, Set<string> | undefined>)[RECORDING] ??= new Set());

// Records a request that failed with `error`, as Next.js describes it in `context`, sent with `method`. Not failures:
// - Next.js's own signals, which send a visitor elsewhere or to the not-found page. Next.js keeps them from the hook on
//   the paths read (app-render's error handlers, the server action handler), and unstable_rethrow is its own test for
//   them: what it throws is the signal, the error or one of its causes, and anything else, such as the stack
//   overflowing on an error that is its own cause, is a failure like any other.
// - A router state header Next.js cannot read.
// - A server action, or a page sent a POST, which Next.js takes for one, that fails but for the database. Next.js
//   decodes the action's arguments from whatever body the request has, and from a body no form of the site sends,
//   Next.js, React, busboy and undici throw TypeErrors, SyntaxErrors and Errors of every kind (some twenty seen on a
//   production build), while only the database's failure says something went wrong on the site's side.
// When the database cannot be used the failure is logged instead, in the same words. Never throws.
export async function noticeFailedRequest(error: unknown, { routePath, routeType }: Context, method = "GET") {
  try {
    unstable_rethrow(error);
  } catch (signal) {
    if (isCause(signal, error)) return;
  }
  if (error instanceof Error && ROUTER_STATE.has(error.message)) return;
  const failure = { route: shape(routePath), kind: KINDS[routeType], reason: reasonOf(error) };
  const action = routeType === "action" || (routeType === "render" && method === "POST");
  if (action && !failure.reason.startsWith(DATABASE)) return;
  const kind = `${failure.route} ${failure.kind} ${failure.reason}`;
  if (recording.has(kind)) return;
  recording.add(kind);
  try {
    await db.query(
      `insert into "requestFailure" ("route", "kind", "reason") values ($1, $2, $3)
       on conflict ("route", "kind", "reason") do update set "lastAt" = now()`,
      [failure.route, failure.kind, failure.reason],
    );
  } catch (cause) {
    console.error(`${failedRequestText(failure)} It couldn't be recorded: ${reasonOf(cause)}.`);
  } finally {
    recording.delete(kind);
  }
}

// The same without holding the response, for the hook and for a page, a route or a server action that catches an
// error itself to show something in its place (#60 review): Vercel keeps the instance up until it is done.
export const noticeLater = (error: unknown, routePath: string, routeType: Context["routeType"] = "render", method = "GET") =>
  void waitUntil(noticeFailedRequest(error, { routePath, routeType }, method));

// The kind of failed request that failed last, for the Organiser page; null if none has.
export async function lastFailedRequest(): Promise<FailedRequest | null> {
  const { rows } = await db.query<FailedRequest>(
    `select "route", "kind", "reason", "lastAt" as "at" from "requestFailure" order by "lastAt" desc limit 1`,
  );
  return rows[0] ?? null;
}

// The kinds that failed after `since`, each with when it last did.
export async function failedRequestsSince(since: Date): Promise<FailedRequest[]> {
  const { rows } = await db.query<FailedRequest>(`select "route", "kind", "reason", "lastAt" as "at" from "requestFailure" where "lastAt" > $1`, [
    since,
  ]);
  return rows;
}
