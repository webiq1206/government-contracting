import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { themeInitScript } from "@/lib/theme";
import { ClarityAnalytics } from "@/components/marketing/clarity-analytics";
import "./globals.css";
import "./simplified-shell.css";

const SITE_URL = process.env.APP_URL || "https://brostco.com";

/*
 * Inter and Manrope, self-hosted.
 *
 * These used to arrive as a render-blocking stylesheet from Google Fonts,
 * which cost every first visit two extra origins (the CSS host and the font
 * host) before text could be drawn in the right face. The same two variable
 * fonts, Latin subset, now ship from this origin with the page: no third-party
 * round trip, a cache-forever hash in the URL, and a metric-matched fallback
 * face while they load so headings do not jump when they arrive. Both are
 * licensed under the SIL Open Font License (see app/fonts/README.md).
 */
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-inter",
  adjustFontFallback: "Arial",
});
const manrope = localFont({
  src: "./fonts/manrope-latin-variable.woff2",
  weight: "600 800",
  display: "swap",
  variable: "--font-manrope",
  adjustFontFallback: "Arial",
});
const DESCRIPTION =
  "BrostCo is an AI platform for government contractors that finds matching federal opportunities, coordinates subcontractor work, prepares bids, and shows teams exactly what needs attention next.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "BrostCo | AI for Government Contracting",
    template: "%s | BrostCo",
  },
  description: DESCRIPTION,
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "BrostCo",
    title: "BrostCo | AI for Government Contracting",
    description: DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "BrostCo AI platform for government contracting",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BrostCo | AI for Government Contracting",
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F6F6" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1720" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${manrope.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body data-clarity-mask="true" className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        <ClarityAnalytics />
      </body>
    </html>
  );
}
