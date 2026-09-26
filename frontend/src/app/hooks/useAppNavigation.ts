/**
 * Navigation, URL params, and initial-route handling.
 * QR redirect is handled by QRRedirectPage at /qr/:id.
 */

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { QP } from "@/shared/constants/queryParams";
import { DISCOVERY_ROUTES, ROUTES } from "@/shared/constants/routes";
import { consumePendingFilterState } from "@/features/search/api/filterService";
import { useSearchStore } from "@/features/search/store/search.store";
import { controlBox } from "@/shared/config/controlBox";

interface UseAppNavigationOptions {
  setSchoolFilter: (school: string) => void;
}

type DiscoveryRouter = Pick<ReturnType<typeof useRouter>, "prefetch">;

/** Intent and idle warming share Next's full-payload router cache. */
export function prefetchDiscoveryRoute(router: DiscoveryRouter, href: string): void {
  if (DISCOVERY_ROUTES.includes(href)) {
    router.prefetch(href, { kind: PrefetchKind.FULL });
  }
}

/** Warm adjacent pages once, after page resources load, without recurring work. */
export function warmDiscoveryRoutes(router: DiscoveryRouter, pathname: string): () => void {
  const routes = DISCOVERY_ROUTES.filter((href) => href !== pathname);
  let cancelled = false;
  let timer: number | undefined;
  let idle: number | undefined;

  const canWarm = () => {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    return !cancelled && document.readyState === "complete" &&
      document.visibilityState === "visible" && navigator.onLine &&
      !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
  };
  const cancelPending = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    timer = undefined;
    idle = undefined;
  };
  const warmNext = () => {
    idle = undefined;
    if (!canWarm()) return;
    const href = routes.shift();
    if (href) prefetchDiscoveryRoute(router, href);
    schedule();
  };
  const schedule = () => {
    if (!canWarm()) {
      cancelPending();
      return;
    }
    if (!routes.length || timer !== undefined || idle !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!canWarm()) return;
      if (window.requestIdleCallback) {
        idle = window.requestIdleCallback(warmNext, {
          timeout: controlBox.clientCache.discoveryPrefetchIdleTimeoutMs,
        });
      } else {
        warmNext();
      }
    }, controlBox.clientCache.discoveryPrefetchIdleTimeoutMs);
  };

  window.addEventListener("load", schedule);
  window.addEventListener("online", schedule);
  window.addEventListener("offline", schedule);
  document.addEventListener("visibilitychange", schedule);
  schedule();
  return () => {
    cancelled = true;
    cancelPending();
    window.removeEventListener("load", schedule);
    window.removeEventListener("online", schedule);
    window.removeEventListener("offline", schedule);
    document.removeEventListener("visibilitychange", schedule);
  };
}

export function useAppNavigation({
  setSchoolFilter,
}: UseAppNavigationOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => warmDiscoveryRoutes(router, pathname), [router, pathname]);

  const hasProcessedInitialRouteMode = useRef(false);
  const hasProcessedInitialSchool = useRef(false);
  const hasConsumedPendingFilters = useRef(false);

  useEffect(() => {
    const schoolParam = searchParams.get(QP.SCHOOL);
    const pageModeParam = searchParams.get(QP.PAGE_MODE);

    if (!hasProcessedInitialRouteMode.current) {
      if (pageModeParam) {
        if (pageModeParam === "marketing") {
          router.replace(ROUTES.MARKETING);
        } else if (pageModeParam === "events") {
          router.replace(ROUTES.HOME);
        }
        hasProcessedInitialRouteMode.current = true;
        return;
      }
      hasProcessedInitialRouteMode.current = true;
    }

    if (!hasProcessedInitialSchool.current) {
      if (schoolParam?.trim()) {
        setSchoolFilter(schoolParam.trim());
      }
      hasProcessedInitialSchool.current = true;
    }
  }, [router, searchParams, setSchoolFilter]);

  useEffect(() => {
    if (hasConsumedPendingFilters.current) return;
    hasConsumedPendingFilters.current = true;

    const pendingFilters = consumePendingFilterState();
    if (pendingFilters) {
      useSearchStore.getState().setFilterState(pendingFilters);
    }
  }, []);
}
