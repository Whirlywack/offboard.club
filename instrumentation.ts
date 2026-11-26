import type { Instrumentation } from "next";

// Next.js hands every request that fails on the server here: a page, a route handler, a server action or the proxy
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md). Each is recorded for
// the Organiser (lib/request-failures.ts, #60). Next.js waits for this on a route handler but not on a page, so the
// work is handed to Vercel's waitUntil, which keeps the instance up until it is done, and no response waits on it. On
// Node.js only, where the database is.
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ waitUntil }, { noticeFailedRequest }] = await Promise.all([import("@vercel/functions"), import("./lib/request-failures")]);
  waitUntil(noticeFailedRequest(error, context));
};
