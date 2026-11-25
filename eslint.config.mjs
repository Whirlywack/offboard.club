import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// A test value shaped like a real Lichess or Telegram token is refused by GitHub's push protection, and by then it
// is in a commit that has to be rewritten. Shapes: lio_ plus 32 letters or digits, lip_ plus 20 (Lichess's own
// generator, lichess-org/scalalib); digits, a colon and 35 more (Telegram).
const tokenShaped = String.raw`li[op]_[A-Za-z0-9]{20,}|\d{8,10}:[A-Za-z0-9_-]{35}`;
const pretendInstead = 'This is shaped like a real access token, which GitHub will refuse to accept. Use a plainly pretend value such as "a-pretend-lichess-token".';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${tokenShaped}/]`, message: pretendInstead },
        { selector: `TemplateElement[value.raw=/${tokenShaped}/]`, message: pretendInstead },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".claude/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
