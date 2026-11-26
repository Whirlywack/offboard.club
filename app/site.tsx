import Link from "next/link";
import type { ReactNode } from "react";
import site from "./site.module.css";
import ui from "./ui.module.css";

// The header every page has: the Club's name, home, and the three Leaderboard pages. A page may put a strip above it
// and something after the links, as the home page does.
export function Masthead({ strip, children }: { strip?: ReactNode; children?: ReactNode }) {
  return (
    <header>
      {strip}
      <div className={site.masthead}>
        <Link href="/" className={site.wordmark}>
          Offboard
        </Link>
        <div className={site.right}>
          <nav aria-label="Site" className={site.nav}>
            <ul>
              <li>
                <Link href="/seasons">Season</Link>
              </li>
              <li>
                <Link href="/all-time">All-time</Link>
              </li>
              <li>
                <Link href="/recaps">Recaps</Link>
              </li>
            </ul>
          </nav>
          {children}
        </div>
      </div>
    </header>
  );
}

// One line in black across the top of a page, leading down to the part of the page it names.
export function Strip({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a href={href} className={`${site.strip} ${ui.black}`}>
      <span className={site.mark} aria-hidden="true" />
      <span className={ui.caps}>{label}</span>
      <span className={site.stripText}>{children}</span>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M8 2.5v11M3.5 9 8 13.5 12.5 9" />
      </svg>
    </a>
  );
}
