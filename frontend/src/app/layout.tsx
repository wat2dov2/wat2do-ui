import type { Metadata, Viewport } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import googleAnalytics from "../../../backend/controlbox/google_analytics.json";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { AppShell } from "@/app/app-shell";
import { ClientProviders } from "@/app/client-providers";
import { SiteBanner } from "@/app/SiteBanner";
import {
  getRequestSchool,
  getRequestSchoolSummary,
  getSchoolDirectory,
} from "@/shared/api/schools.server";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import { getSchoolThemeStyle } from "@/shared/lib/schoolBranding";
import { getSchoolLogoImage } from "@/shared/lib/schoolLogo";
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

const BASE_METADATA: Metadata = {
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

/** Tab and home-screen icons follow the school's logo, built from its posters when it has one. */
export async function generateMetadata(): Promise<Metadata> {
  const logo = getSchoolLogoImage(await getRequestSchoolSummary());
  return { ...BASE_METADATA, icons: { icon: logo.src, apple: logo.src } };
}

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
  const [initialSchool, initialSchools] = await Promise.all([
    getRequestSchool(),
    getSchoolDirectory().catch((error: unknown) => {
      console.error("Failed to preload the school directory:", error);
      return undefined;
    }),
  ]);
  const school = initialSchools?.find((school) => school.slug === initialSchool);

  return (
    <html
      lang={school?.language ?? "en"}
      className={`no-transitions ${satoshi.variable}`}
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
        <PageBackground />
        {/* Inside the providers so the strip's own controls can be translated;
            it is still a server component, rendered on the server as a child. */}
        <ClientProviders
          initialSchool={initialSchool}
          initialSchools={initialSchools}
        >
          <SiteBanner schoolName={school?.name} />
          <AppShell>{children}</AppShell>
        </ClientProviders>
        {process.env.NODE_ENV === "production" && googleAnalytics.measurement_id ? <GoogleAnalytics gaId={googleAnalytics.measurement_id} /> : null}
      </body>
    </html>
  );
}
