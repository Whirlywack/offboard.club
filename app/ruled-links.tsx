import Link from "next/link";
import ui from "./ui.module.css";

// Places to go, one to a row between rules (ui.ruled), each with its arrow. `className` places the list on its page.
export function RuledLinks({ links, className = "" }: { links: [href: string, label: string][]; className?: string }) {
  return (
    <ul className={`${ui.ruled} ${className}`}>
      {links.map(([href, label]) => (
        <li key={href}>
          <Link href={href}>
            <span>{label}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M3 12h17M14 6l6 6-6 6" />
            </svg>
          </Link>
        </li>
      ))}
    </ul>
  );
}
