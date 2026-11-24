import Link from "next/link";

// For a Sunday with no ingested Matchday. This streams in after the page's App Shell, so the status stays 200 and
// Next.js marks the page noindex. A 404 would need the database read before anything is sent, which Cache Components
// allows only for cached data (keeping a miss after the Matchday is ingested by a separate process that cannot clear
// the cache, and turning an unreachable database into an error page) or in Proxy, which Next.js says is not for
// fetching data. Addresses that cannot be a Matchday's date at all get a real 404 from proxy.ts.
export default function NoRecap() {
  return (
    <main>
      <h1>No Recap here</h1>
      <p>There is no Recap at this address: no Matchday of that date has been played and collected.</p>
      <p>
        <Link href="/recaps">All Recaps</Link>
      </p>
    </main>
  );
}
