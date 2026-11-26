import Image from "next/image";
import fallback from "../../fallback.module.css";
import pawnOutline from "../../photos/pawn-outline.webp";
import { RuledLinks } from "../../ruled-links";
import ui from "../../ui.module.css";

// For a Sunday with no ingested Matchday. This streams in after the page's App Shell, so the status stays 200 and
// Next.js marks the page noindex. A 404 would need the database read before anything is sent, which Cache Components
// allows only for cached data (keeping a miss after the Matchday is ingested by a separate process that cannot clear
// the cache, and turning an unreachable database into an error page) or in Proxy, which Next.js says is not for
// fetching data. Addresses that cannot be a Matchday's date at all get a real 404 from proxy.ts. It is the not-found
// page's plate (app/not-found.tsx), with its pawn in outline: a Sunday nobody played, or not yet.
export default function NoRecap() {
  return (
    <main id="main" className={`${fallback.plate} ${ui.grain}`}>
      <div className={fallback.text}>
        <h1 className={`${fallback.title} ${ui.display}`}>
          <em>No</em> Recap for that Sunday
        </h1>
        <p className={fallback.lede}>There was no Matchday that day, or its results aren&apos;t in yet.</p>
        <nav aria-label="More">
          <RuledLinks
            className={fallback.links}
            links={[
              ["/recaps", "All Recaps"],
              ["/", "Home"],
            ]}
          />
        </nav>
      </div>
      <Image className={fallback.empty} src={pawnOutline} alt="" sizes="(min-width: 900px) 208px, 104px" />
    </main>
  );
}
