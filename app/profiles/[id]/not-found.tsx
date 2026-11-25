import Link from "next/link";
import ui from "../../ui.module.css";

// For an address with no Profile behind it, whether nobody has that id or they have not finished signing up.
export default function NoProfile() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Member Profile</p>
        <h1>No Profile at this address</h1>
        <p className={ui.lede}>
          Nobody has a Profile here. If someone sent you this link, they may not have finished signing up yet.
        </p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/recaps">Recaps</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
