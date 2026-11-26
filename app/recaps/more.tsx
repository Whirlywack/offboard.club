import Link from "next/link";
import styles from "./recaps.module.css";

// Where to go from the foot of a Recap page: each link with an arrow that leans forward under the pointer.
export function More({ links }: { links: [href: string, label: string][] }) {
  return (
    <nav aria-label="More" className={styles.more}>
      {links.map(([href, label]) => (
        <Link key={href} href={href}>
          <span>{label}</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M2 8h11M9 4l4 4-4 4" />
          </svg>
        </Link>
      ))}
    </nav>
  );
}
