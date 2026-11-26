// For tests: what the code hands to Vercel's waitUntil (@vercel/functions), such as a failed request being recorded
// (lib/request-failures.ts), kept so that a test can wait for it as Vercel keeps an instance up until it settles. It
// stands in for the request context Vercel gives each request; vi.unstubAllGlobals ends it.
import { vi } from "vitest";

// Returns what waits for everything handed over so far.
export function keepWaitUntil() {
  const kept: Promise<unknown>[] = [];
  vi.stubGlobal(Symbol.for("@vercel/request-context"), { get: () => ({ waitUntil: (work: Promise<unknown>) => kept.push(work) }) });
  return () => Promise.all(kept.splice(0));
}
