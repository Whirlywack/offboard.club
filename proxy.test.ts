// Proxy's 404 for Recap addresses that cannot be a Matchday's date, before any page is rendered.
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const visit = (path: string) => proxy(new NextRequest(`https://offboard.test${path}`));

describe("the Recap addresses Proxy answers", () => {
  it("answers an address that is not a Sunday from 2026 on with Next.js's not-found page and a 404", () => {
    for (const path of ["/recaps/abc", "/recaps/2026-02-30", "/recaps/2026-11-24", "/recaps/2025-12-28", "/recaps/2100-01-03", "/recaps/%E0%A4%A"]) {
      const response = visit(path);
      expect(response?.status).toBe(404);
      expect(new URL(response!.headers.get("x-middleware-rewrite")!).pathname).toBe("/_not-found");
    }
  });

  it("lets a Sunday through to the page, which shows the Recap or says there is none", () => {
    expect(visit("/recaps/2026-11-29")).toBeUndefined();
    expect(visit("/recaps/2026-01-04")).toBeUndefined();
  });

  it("runs only for a single Recap", () => {
    expect(config.matcher).toBe("/recaps/:date");
  });
});
