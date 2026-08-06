import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ClientProviders } from "@/app/client-providers";
import { SiteBanner } from "@/app/SiteBanner";
import { PageBackground } from "@/shared/layout";
import "../index.css";

// Satoshi ships as a single variable file per style, so one declaration covers
// every weight the UI asks for. Self-hosted rather than fetched: the licence
// requires it, and it removes a third-party request from the critical path.
const satoshi = localFont({
  src: [
    {
      path: "../../public/fonts/WEB/fonts/Satoshi-Variable.woff2",
      weight: "300 900",
      style: "normal",
    },
    {
      path: "../../public/fonts/WEB/fonts/Satoshi-VariableItalic.woff2",
      weight: "300 900",
      style: "italic",
    },
  ],
  variable: "--font-satoshi",
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
      className={`dark no-transitions ${satoshi.variable}`}
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
        {/* Inside the providers so the strip's own controls can be translated;
            it is still a server component, rendered on the server as a child. */}
        <ClientProviders>
          <SiteBanner />
          {children}
        </ClientProviders>
      </body>
    </html>
  );
}
