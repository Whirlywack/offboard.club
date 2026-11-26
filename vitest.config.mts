import { defineConfig } from "vitest/config";
import { nodeNotice } from "./scripts/local-db.mjs";

// pnpm test runs on CI's Node.js; run another way, on another major version, the tests say so first.
const notice = nodeNotice();
if (notice) console.warn(notice);

export default defineConfig({
  resolve: { tsconfigPaths: true }, // "@/lib/..." as in the app
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".claude/**"],
  },
});
