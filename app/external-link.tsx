import type { ReactNode } from "react";

// A link to another site, opened in a new tab, that says so. The arrow after it (globals.css) is for the eye only; the
// words are in the markup because screen readers do not all read alternative text given to CSS generated content.
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}
