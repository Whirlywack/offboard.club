import Link from "next/link";
import ui from "../../ui.module.css";

// For an address with no Profile behind it, whether nobody has that id or they have not finished signing up.
export default function NoProfile() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>No Profile at this address</h1>
        <p className={ui.lede}>The person may still be signing up, or may have left the Club.</p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/recaps">Recaps</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
