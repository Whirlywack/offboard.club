import Link from "next/link";
import ui from "../../ui.module.css";

// For an address with no Profile behind it, whether nobody has that id or they have not finished signing up.
export default function NoProfile() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Profile</p>
        <h1>No Profile here</h1>
        <p className={ui.lede}>There is no Profile at this address.</p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
