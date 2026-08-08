"use client";

import { LoadingPage } from "@/shared/ui/loading-page";

/**
 * What a route shows while its server component is still resolving.
 *
 * Next renders this the moment a navigation starts, so following a link feels
 * like something happened immediately rather than the previous screen sitting
 * there - or going blank - until the new page's data has been fetched.
 *
 * Plugging it into a route is one line: a `loading.tsx` in that segment that
 * re-exports this as its default. Keeping the markup here rather than in each
 * of those files means every route waits the same way.
 */
export function RouteLoading() {
  return <LoadingPage className="min-h-[60dvh]" />;
}

export default RouteLoading;
