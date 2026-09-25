/**
 * Navigation, URL params, and initial-route handling.
 * QR redirect is handled by QRRedirectPage at /qr/:id.
 */

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { QP } from "@/shared/constants/queryParams";
import { ROUTES } from "@/shared/constants/routes";
import { consumePendingFilterState } from "@/features/search/api/filterService";
import { useSearchStore } from "@/features/search/store/search.store";

interface UseAppNavigationOptions {
  setSchoolFilter: (school: string) => void;
}

/** Keep full discovery payloads warm even when their navigation links are hidden. */
export function warmDiscoveryRoutes(router: Pick<ReturnType<typeof useRouter>, "prefetch">): () => void {
  let cancelled = false;
  for (const href of [ROUTES.HOME, ROUTES.POSITIONS]) {
    const warm = () => {
      if (cancelled) return;
      // Next's AUTO mode only warms the loading boundary for these dynamic pages.
      router.prefetch(href, { kind: PrefetchKind.FULL, onInvalidate: warm });
    };
    warm();
  }
  return () => { cancelled = true; };
}

export function useAppNavigation({
  setSchoolFilter,
}: UseAppNavigationOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => warmDiscoveryRoutes(router), [router]);

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
