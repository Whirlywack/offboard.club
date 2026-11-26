"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";

// What the root layout shows on every page but the home page, which draws its own header with the Season's strip
// above it. At the home page the layout has no segment below it; outside a route at all (a test rendering the layout
// alone) there is no list of segments, and the children show.
export function NotOnHome({ children }: { children: ReactNode }) {
  return useSelectedLayoutSegments()?.length === 0 ? null : children;
}
