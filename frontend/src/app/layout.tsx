import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ClientProviders } from "@/app/client-providers";
import { PageBackground } from "@/shared/layout";
import "../index.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const APP_DESCRIPTION =
  "Discover campus events, explore student organizations, and stay connected with what's happening around you.";

const themeInitScript = `
(function() {
  document.documentElement.classList.add('dark');
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL("https://wat2do.io"),
  title: "Wat2Do | Campus Events",
  description: APP_DESCRIPTION,
  authors: [{ name: "Wat2Do" }],
  robots: "index, follow",
  applicationName: "Wat2Do",
  manifest: "/manifest.json",
  icons: {
    icon: "/wat2do-logo.svg",
    apple: "/wat2do-logo.svg",
  },
  openGraph: {
    type: "website",
    title: "Wat2Do | Campus Events",
    description: APP_DESCRIPTION,
    url: "https://wat2do.io",
    siteName: "Wat2Do",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "Wat2Do | Campus Events",
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f0f0f",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark no-transitions ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="stylesheet" href="/api/school-theme" />
      </head>
      <body>
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <PageBackground />
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
