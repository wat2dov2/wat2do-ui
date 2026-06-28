import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { ClientProviders } from "@/app/client-providers";
import "../index.css";

const APP_DESCRIPTION =
  "Discover campus events, explore student organizations, and stay connected with what's happening around you.";

const themeInitScript = `
(function() {
  try {
    var raw = localStorage.getItem('theme');
    var theme = null;
    try { theme = raw !== null ? JSON.parse(raw) : null; } catch(e) { theme = raw; }
    var isDark = theme !== null
      ? theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
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
  themeColor: "#3B82F6",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="no-transitions" suppressHydrationWarning>
      <body>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
