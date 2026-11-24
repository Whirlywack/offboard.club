import type { Metadata } from "next";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
