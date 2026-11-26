import type { Metadata } from "next";
import Link from "next/link";
import ui from "./ui.module.css";

export const metadata: Metadata = { title: "Page not found" };

// For any address the site does not have, including Recap addresses that cannot be a Matchday's date (proxy.ts).
export default function NotFound() {
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>Nothing at this address</h1>
        <p className={ui.lede}>The address may have a typo in it.</p>
      </div>
      <nav aria-label="More" className={ui.backLinks}>
        <Link href="/">Home</Link>
        <Link href="/recaps">Recaps</Link>
      </nav>
    </main>
  );
}
