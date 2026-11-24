import type { Metadata, Viewport } from "next";
import { Newsreader } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { LogoMark } from "./logo";
import site from "./site.module.css";
import { organiserEmail } from "@/lib/contact";

// Self-hosted by next/font at build time: the browser never asks Google for anything. Latin Extended carries
// Lithuanian names (ą, č, ė, š, ž...).
const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  variable: "--font-newsreader",
  display: "swap",
});

const title = "Offboard: Sunday chess for people in tech in Vilnius";
const description =
  "A free chess Club for people who work in tech in and around Vilnius. Five quick Games on Lichess every Sunday at 20:00. Chess is the weekly excuse to show up; meeting people is the point.";

export const metadata: Metadata = {
  title: { default: title, template: "%s | Offboard" },
  description,
  applicationName: "Offboard",
  openGraph: { type: "website", siteName: "Offboard", title, description },
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
  const contact = organiserEmail();
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
            <p>Offboard is a free chess Club for people who work in tech in and around Vilnius.</p>
            <p>Games are played on Lichess. Offboard isn&apos;t affiliated with Lichess or LinkedIn.</p>
            {contact && (
              <p className={site.contact}>
                <a href={`mailto:${contact}`}>Contact the Organiser</a>
              </p>
            )}
          </footer>
        </div>
      </body>
    </html>
  );
}
