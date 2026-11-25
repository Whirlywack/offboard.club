import type { Metadata } from "next";
import Link from "next/link";
import ui from "./ui.module.css";

export const metadata: Metadata = { title: "Page not found" };

// For any address the site does not have, including Recap addresses that cannot be a Matchday's date (proxy.ts).
export default function NotFound() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <p className={ui.eyebrow}>Page not found</p>
        <h1>Nothing at this address</h1>
        <p className={ui.lede}>The link may have a typo in it, or the page may have moved.</p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
        <Link href="/recaps">Recaps</Link>
      </nav>
    </main>
  );
}
