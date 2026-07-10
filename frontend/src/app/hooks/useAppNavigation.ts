/**
 * Navigation, URL params, and initial-route handling.
 * QR redirect is handled by QRRedirectPage at /qr/:id.
 */

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Event } from "@/shared/types";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";
import { ROUTES } from "@/shared/constants/routes";
import { consumePendingFilterState } from "@/features/search/api/filterService";
import { useSearchStore } from "@/features/search/store/search.store";

interface UseAppNavigationOptions {
  events: Event[];
  setSchoolFilter: (school: string) => void;
}

export function useAppNavigation({
  events,
  setSchoolFilter,
}: UseAppNavigationOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasProcessedInitialRouteMode = useRef(false);
  const hasProcessedInitialSchool = useRef(false);
  const hasProcessedInitialScroll = useRef(false);
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
        hasProcessedInitialScroll.current = true;
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

  useEffect(() => {
    const eventId = searchParams.get(QP.EVENT_ID);
    if (!hasProcessedInitialScroll.current && eventId) {
      if (events.length === 0) {
        return;
      }
      const event = events.find((e) => e.id === parseInt(eventId, 10));
      if (event) {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const rafId = requestAnimationFrame(() => {
          timeoutId = setTimeout(() => {
            const eventCard = document.querySelector(
              `[data-event-id="${eventId}"]`,
            );
            eventCard?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, SCROLL_INTO_VIEW_DELAY_MS);
        });
        hasProcessedInitialScroll.current = true;
        return () => {
          cancelAnimationFrame(rafId);
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        };
      } else {
        hasProcessedInitialScroll.current = true;
      }
    } else if (!eventId) {
      hasProcessedInitialScroll.current = true;
    }
  }, [searchParams, events]);
}
