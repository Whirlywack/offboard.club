import type { Instrumentation } from "next";

// Next.js hands here what a request's page, route handler, server action or proxy throws on the server
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md); what a page catches
// itself, as the public pages do when the database cannot be read, is handed over where it is caught. Each is recorded
// for the Organiser (lib/request-failures.ts, #60). Next.js waits for this on a route handler but not on a page, so
// the work is handed to Vercel's waitUntil, which keeps the instance up until it is done, and no response waits on it.
// On Node.js only, where the database is.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { noticeLater } = await import("./lib/request-failures");
  noticeLater(error, context.routePath, context.routeType, request.method);
};
