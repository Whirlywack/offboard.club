// Requests that fail on the server (#60): a page, a route, a server action or the proxy that throws, as Next.js hands
// each to instrumentation.ts. Each is recorded by its kind in "requestFailure" (migrations/012_request_failures.sql),
// where the Organiser page shows the latest and the private alerts (lib/alerts.ts) tell the Organiser of each kind once
// a day. A request never messages the Organiser itself, so however many fail, they send nothing: when the database
// cannot be used, the alerts' own hourly run says so (alertWithoutDatabase in lib/alerts.ts).
//
// What is kept and said of a failure holds nothing a person sent or an error said, which could name a Member, hold what
// they typed or give the database's address: the route's shape from the app's own folders, never the address asked
// for, and a reason from the fixed list below.

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

// Node's codes for a connection that was never made or was cut, and pg's words when it gave up on one or lost it.
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]);
const UNREACHABLE = /^(Connection terminated due to connection timeout|Connection terminated unexpectedly|timeout exceeded when trying to connect)$/;

// Why it failed, in words from a fixed list, looking through the error and what caused it, five deep, as the sign-in
// library wraps the database's error in its own ("Failed to get session"). A fetch that failed is another site's; a
// code with a severity is Postgres's own error (SQLSTATE), whose message can quote a value a person sent.
export const reasonOf = (error: unknown) => causeOf(error, 0) ?? thrown(error);

function causeOf(error: unknown, depth: number): string | null {
  if (!(error instanceof Object) || depth === 5) return null;
  const { message, code, cause } = error as { message?: unknown; code?: unknown; cause?: unknown };
  if (message === "fetch failed") return "another site couldn't be reached";
  if ((typeof code === "string" && UNREACHABLE_CODES.has(code)) || (typeof message === "string" && UNREACHABLE.test(message)))
    return "the database couldn't be reached";
  if ("severity" in error && typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `the database refused it (error ${code})`;
  return causeOf(cause, depth + 1);
}

// The error's own name, such as TypeError, when it is a name.
function thrown(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Z][A-Za-z]{0,39}$/.test(name) ? `the code threw ${name}` : "the code threw an error";
}

export type FailedRequest = { route: string; kind: string; reason: string; at: Date };

// How an alert and a log line say it.
export const failedRequestText = ({ route, kind, reason }: Omit<FailedRequest, "at">) => `A ${kind} failed at ${route}: ${reason}.`;

// Records a request that failed with `error`, as Next.js describes it in `context`. Next.js's own signals, which send a
// visitor elsewhere or to the not-found page, are not failures: Next.js keeps them from the hook on the paths read
// (app-render's error handlers, the server action handler), and unstable_rethrow is its own test for them. When the
// database cannot be used the failure is logged instead, in the same words. Never throws.
export async function noticeFailedRequest(error: unknown, context: Context) {
  try {
    unstable_rethrow(error);
  } catch {
    return;
  }
  const failure = { route: shape(context.routePath), kind: KINDS[context.routeType], reason: reasonOf(error) };
  try {
    await db.query(
      `insert into "requestFailure" ("route", "kind", "reason") values ($1, $2, $3)
       on conflict ("route", "kind", "reason") do update set "lastAt" = now()`,
      [failure.route, failure.kind, failure.reason],
    );
  } catch (cause) {
    console.error(`${failedRequestText(failure)} It couldn't be recorded: ${reasonOf(cause)}.`);
  }
}

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
