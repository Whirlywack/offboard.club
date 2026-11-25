import Link from "next/link";
import ui from "../../ui.module.css";

// For a Sunday with no ingested Matchday. This streams in after the page's App Shell, so the status stays 200 and
// Next.js marks the page noindex. A 404 would need the database read before anything is sent, which Cache Components
// allows only for cached data (keeping a miss after the Matchday is ingested by a separate process that cannot clear
// the cache, and turning an unreachable database into an error page) or in Proxy, which Next.js says is not for
// fetching data. Addresses that cannot be a Matchday's date at all get a real 404 from proxy.ts.
export default function NoRecap() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Recap</p>
        <h1>No Recap for that Sunday</h1>
        <p className={ui.lede}>
          Either there was no Matchday that day, or its results haven&apos;t come in yet. All Recaps so far are in the
          list.
        </p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/recaps">All Recaps</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
