import type { Metadata, Viewport } from "next";
import Script from "next/script";
import googleAnalytics from "../../../backend/controlbox/google_analytics.json";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { AppShell } from "@/app/app-shell";
import { ClientProviders } from "@/app/client-providers";
import { SiteBanner } from "@/app/SiteBanner";
import {
  getRequestHostnameSchoolStatus,
  getRequestSchool,
  getSchoolDirectoryForPage,
} from "@/shared/api/schools.server";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import { getSchoolThemeStyle } from "@/shared/lib/schoolBranding";
import "../index.css";
import "@/styles/motion.css";

// Satoshi ships as a single variable file per style, so one declaration covers
// every weight the UI asks for. Self-hosted rather than fetched: the licence
// requires it, and it removes a third-party request from the critical path.
const satoshi = localFont({
  src: "../../public/fonts/WEB/fonts/Satoshi-Variable.woff2",
  weight: "300 900",
  style: "normal",
  variable: "--font-satoshi",
  display: "swap",
});

// Italic text appears in one place (the door list), so its 43 KB face is not
// preloaded on every page; `.font-italic-satoshi` downloads it where it is used.
const satoshiItalic = localFont({
  src: "../../public/fonts/WEB/fonts/Satoshi-VariableItalic.woff2",
  weight: "300 900",
  style: "italic",
  variable: "--font-satoshi-italic",
  display: "swap",
  preload: false,
});

const APP_DESCRIPTION =
  "Discover campus events, explore student clubs, and stay connected with what's happening around you.";

const themeInitScript = `
(function() {
  try {
    var themeKey = ${JSON.stringify(STORAGE_KEYS.THEME)};
    var themeCookie = document.cookie
      .split('; ')
      .find(function(cookie) { return cookie.indexOf(themeKey + '=') === 0; });
    var cookieTheme = themeCookie
      ? decodeURIComponent(themeCookie.slice(themeKey.length + 1))
      : null;
    var localTheme = localStorage.getItem(themeKey);
    if (localTheme) {
      try { localTheme = JSON.parse(localTheme); } catch (error) {}
    }
    var savedTheme = cookieTheme || localTheme;
    var isDark = savedTheme === 'dark' ||
      (savedTheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  } catch (error) {
    document.documentElement.classList.toggle(
      'dark',
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  }
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      document.documentElement.classList.remove('no-transitions');
    });
  });
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL("https://wat2do.io"),
  title: "Wat2Do | Campus Events",
  description: APP_DESCRIPTION,
  authors: [{ name: "Wat2Do" }],
  robots: {
    index: false,
    follow: true,
  },
  applicationName: "Wat2Do",
  manifest: "/manifest.json",
  // Square raster icons: the wide wordmark SVG was squeezed and cropped as an icon.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
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
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const initialSchool = await getRequestSchool();
  const hostnameSchoolStatus = await getRequestHostnameSchoolStatus();
  const initialSchools = await getSchoolDirectoryForPage(initialSchool).catch(
    (error: unknown) => {
      console.error("Failed to preload the school directory:", error);
      return undefined;
    },
  );
  const school = initialSchools?.find((school) => school.slug === initialSchool);

  return (
    <html
      lang={school?.language ?? "en"}
      className={`no-transitions ${satoshi.variable} ${satoshiItalic.variable}`}
      style={getSchoolThemeStyle(school)}
      suppressHydrationWarning
    >
      <head>
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body>
        {/* Inside the providers so the strip's own controls can be translated;
            it is still a server component, rendered on the server as a child. */}
        <ClientProviders
          initialSchool={initialSchool}
          initialSchools={initialSchools}
        >
          <SiteBanner schoolName={school?.name} />
          <AppShell hostnameSchoolStatus={hostnameSchoolStatus}>{children}</AppShell>
        </ClientProviders>
        {process.env.NODE_ENV === "production" && googleAnalytics.measurement_id ? (
          <GoogleAnalyticsAfterLoad measurementId={googleAnalytics.measurement_id} />
        ) : null}
      </body>
    </html>
  );
}

/**
 * Google Analytics (177 KB) loads in idle time after the page's load event, so it
 * never competes with the site's own code for a phone's bandwidth or CPU. Single
 * page navigations are still counted by GA4's history-change page views.
 */
function GoogleAnalyticsAfterLoad({ measurementId }: { measurementId: string }) {
  return (
    <>
      <Script
        id="ga-loader"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
        strategy="lazyOnload"
      />
      <Script id="ga-init" strategy="lazyOnload">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(measurementId)});`}
      </Script>
    </>
  );
}
