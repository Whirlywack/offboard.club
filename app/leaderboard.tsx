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

function CompanyName({ company }: { company: NonNullable<Member["company"]> }) {
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

// Under a Leaderboard with names on it, for anyone who is not a Member: on the Season and all-time Leaderboards and
// under a Recap's.
export function ProfilesNote() {
  return <p className={`${ui.small} ${ui.muted}`}>Only signed-in Members can open Profiles.</p>;
}
