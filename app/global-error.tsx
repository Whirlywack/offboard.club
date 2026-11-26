"use client"; // Error boundaries must be Client Components

import "./globals.css";
import ui from "./ui.module.css";

// The last resort, when the root layout itself fails: it replaces the whole document, so it brings its own <html>,
// <body>, title and styles, and nothing that could fail the same way.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong | Offboard</title>
        <main id="main" className={ui.page}>
          <div className={ui.intro}>
            <p className={ui.eyebrow}>Offboard</p>
            <h1>This page didn&apos;t load</h1>
            <p className={ui.lede}>Something broke on our side. Try again now or in a few minutes.</p>
          </div>
          <div className={ui.actions}>
            <button onClick={() => retry()}>Try again</button>
            {/* A full page load, not a client-side navigation, in case the app itself is what broke. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className={ui.quiet} href="/">
              Home
            </a>
            <a href="/privacy">Privacy and terms</a>
          </div>
        </main>
      </body>
    </html>
  );
}
