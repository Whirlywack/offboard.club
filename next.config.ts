import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // CLAUDE.md already carries the Next.js note; do not generate AGENTS.md beside it.
  agentRules: false,
};

export default nextConfig;
