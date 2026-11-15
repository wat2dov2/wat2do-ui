"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { startAnalytics, trackPageView } from "@/shared/lib/analytics";

/**
 * Google Analytics (177 KB) loads in idle time after the page's load event, so it
 * never competes with the site's own code for a phone's bandwidth or CPU; the
 * commands queue in `dataLayer` until it runs. Each page view, the first and
 * every client-side navigation, is the one `trackPageView` records.
 */
export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const lastLocation = useRef<string | null>(null);

  // One page view per path; a new query alone is not a new page.
  useEffect(() => {
    if (lastLocation.current === null) startAnalytics(measurementId);
    lastLocation.current = trackPageView(
      window.location.href,
      lastLocation.current ?? document.referrer,
    );
  }, [measurementId, pathname]);

  return (
    <Script
      id="ga-loader"
      src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
      strategy="lazyOnload"
    />
  );
}
