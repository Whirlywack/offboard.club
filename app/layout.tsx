import type { Metadata, Viewport } from "next";
import { Newsreader } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { LogoMark } from "./logo";
import site from "./site.module.css";
import { organiserEmail } from "@/lib/contact";

// Self-hosted by next/font at build time: the browser never asks Google for anything. Headings only, so the weight
// axis alone: the optical-size axis more than doubled the files preloaded on every page (218 KB against 94 KB) for a
// display cut that is only a touch finer, visible side by side at the largest heading. Latin Extended is kept because
// headings show Members' names, and Lithuanian ones need ą, č, ė, š, ž.
const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
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
  // The browser's own chrome cannot read CSS custom properties: these repeat --paper from globals.css, light and dark.
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
              <Link href="/seasons">Season</Link>
              <Link href="/all-time">All-time</Link>
              <Link href="/recaps">Recaps</Link>
            </nav>
          </header>
          {children}
          <footer className={site.footer}>
            <p>Offboard is a free chess Club for people who work in tech in and around Vilnius.</p>
            <p>Games are played on Lichess. Offboard isn&apos;t affiliated with Lichess or LinkedIn.</p>
            <p className={site.contact}>
              <Link href="/privacy">Privacy and terms</Link>
            </p>
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
