import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Hanken_Grotesk } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { NotOnHome } from "./not-on-home";
import { Masthead } from "./site";
import site from "./site.module.css";
import ui from "./ui.module.css";
import { organiserEmail } from "@/lib/contact";

// Both self-hosted by next/font at build time: the browser never asks Google for anything. The display serif keeps its
// optical-size axis, which draws the hairlines finer as the type grows: the large headings are made of it. Only the
// Latin files are preloaded: Latin Extended, which Lithuanian names need for ą, č, ė, š and ž, is fetched when a page
// has one.
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-bodoni",
  display: "swap",
});
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });

const title = "Offboard: Sunday chess for people in tech in Vilnius";
const description =
  "Working in tech keeps you busy, and busy gets lonely. Offboard is free Sunday chess on Lichess for people in tech in and around Vilnius.";

export const metadata: Metadata = {
  title: { default: title, template: "%s | Offboard" },
  description,
  applicationName: "Offboard",
  openGraph: { type: "website", siteName: "Offboard", title, description },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#0d0b07", // --black in globals.css, which the browser's own chrome cannot read
};

// Every page puts its content in <main id="main">, which the skip link jumps to. The home page draws its own header;
// the hook that tells which page this is waits for a page's address where that is not known ahead of a request, and the
// header shows in the meantime.
export default function RootLayout({ children }: LayoutProps<"/">) {
  const contact = organiserEmail();
  return (
    <html lang="en" className={`${bodoni.variable} ${hanken.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className={site.shell}>
          <Suspense fallback={<Masthead />}>
            <NotOnHome>
              <Masthead />
            </NotOnHome>
          </Suspense>
          {children}
          <footer className={`${site.footer} ${ui.black}`}>
            <p>Offboard is a free chess Club for people who work in tech in and around Vilnius.</p>
            <p>Offboard isn&apos;t affiliated with Lichess or LinkedIn.</p>
            <ul>
              <li>
                <Link href="/privacy">Privacy and terms</Link>
              </li>
              {contact && (
                <li>
                  <a href={`mailto:${contact}`}>Contact the Organiser</a>
                </li>
              )}
            </ul>
          </footer>
        </div>
      </body>
    </html>
  );
}
