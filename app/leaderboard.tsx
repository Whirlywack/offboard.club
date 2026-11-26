import Link from "next/link";
import styles from "./leaderboards.module.css";
import ui from "./ui.module.css";
import { companyLabel } from "@/lib/companies";
import type { Member } from "@/lib/leaderboards";

// A Member's cell on the Season and all-time Leaderboards: their name, linking to their Profile, with their Company
// under it as companyLabel names it, "Vinted (vinted.com)", the domain kept in one piece.
export function MemberCell({ member }: { member: Member }) {
  return (
    <th scope="row">
      <Link href={`/profiles/${member.memberId}`}>{member.name}</Link>
      {member.company && <CompanyName company={member.company} />}
    </th>
  );
}

// A Company as companyLabel names it, under a name or in a Recap's Company column.
export function CompanyName({ company }: { company: NonNullable<Member["company"]> }) {
  const label = companyLabel(company);
  const domainAt = label.lastIndexOf(" (");
  return (
    <span className={styles.company}>
      {domainAt < 0 ? (
        label
      ) : (
        <>
          {label.slice(0, domainAt)} <span className={styles.domain}>{label.slice(domainAt + 1)}</span>
        </>
      )}
    </span>
  );
}

// A Season score or a night's points, which can end in a half: a whole number keeps the half's room, so the column
// lines up on the point.
export function ScoreCell({ value }: { value: number }) {
  return <td className={Number.isInteger(value) ? `${styles.score} ${styles.whole}` : styles.score}>{value}</td>;
}

// Under a Leaderboard with names on it, for anyone who is not a Member: on the Season and all-time Leaderboards and
// under a Recap's.
export function ProfilesNote() {
  return <p className={`${ui.small} ${ui.muted}`}>Only signed-in Members can open Profiles.</p>;
}

// Where to go from a Leaderboard, at its foot.
export function MoreLinks({ links }: { links: [href: string, label: string][] }) {
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
