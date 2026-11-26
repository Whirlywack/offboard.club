import { defineConfig } from "vitest/config";
import { nodeNotice } from "./scripts/local-db.mjs";

// pnpm test runs on CI's Node.js; run another way, on another major version, the tests say so first.
const notice = nodeNotice();
if (notice) console.warn(notice);

export default defineConfig({
  resolve: { tsconfigPaths: true }, // "@/lib/..." as in the app
  plugins: [
    {
      // A photograph imported by a page is, as Next.js builds it, its address and its size, which next/image needs: Vite
      // would give the address alone. The size is a stand-in, as in Next.js's own Jest set-up; the file's name is kept.
      name: "photographs-as-next-imports-them",
      enforce: "pre",
      load: (id) =>
        /\.(webp|png|jpe?g)$/.test(id)
          ? `export default ${JSON.stringify({ src: `/${id.split("/").slice(-2).join("/")}`, width: 100, height: 100 })};`
          : null,
    },
  ],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".claude/**"],
  },
});
