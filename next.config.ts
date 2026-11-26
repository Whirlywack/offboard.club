import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // CLAUDE.md already carries the Next.js note; do not generate AGENTS.md beside it.
  agentRules: false,
  // A route whose file ends in .dev.ts is a route for `next dev` alone: a production build leaves it out entirely. The
  // switch between people in the local site (app/sign-in-as/route.dev.ts) is one.
  pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ["dev.ts", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],
});

export default nextConfig;
