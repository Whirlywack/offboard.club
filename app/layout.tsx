import type { Metadata, Viewport } from "next";
import { Newsreader } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { LogoMark } from "./logo";
import site from "./site.module.css";

// Self-hosted by next/font at build time: the browser never asks Google for anything. Latin Extended carries
// Lithuanian names (ą, č, ė, š, ž...).
const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  variable: "--font-newsreader",
  display: "swap",
});

const description =
  "Offboard is a free chess Club for people working in tech in and around Vilnius. A Matchday on Lichess every Sunday at 20:00; meeting people is the point.";

export const metadata: Metadata = {
  title: { default: "Offboard: chess for people in tech in Vilnius", template: "%s | Offboard" },
  description,
  applicationName: "Offboard",
  openGraph: {
    type: "website",
    siteName: "Offboard",
    title: "Offboard: chess for people in tech in Vilnius",
    description,
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

// Every page puts its content in <main id="main">, which the skip link jumps to.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={newsreader.variable}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className={site.shell}>
          <header className={site.header}>
            <Link href="/" className={site.brand}>
              <LogoMark className={site.mark} />
              Offboard
            </Link>
            <nav aria-label="Site" className={site.nav}>
              <Link href="/recaps">Recaps</Link>
            </nav>
          </header>
          {children}
          <footer className={site.footer}>
            <p>Offboard: a free chess Club for people in tech in Vilnius.</p>
            <p>Games are played on Lichess. Offboard is not affiliated with Lichess or LinkedIn.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
