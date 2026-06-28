/**
 * Hook for managing navigation, routing, URL params, and QR redirects
 *
 * - Combined URL param handling into a single useEffect
 * - QR redirect handled by QRRedirectPage at /qr/:id
 */

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FilterState, Event } from "@/shared/types";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";
import { ROUTES } from "@/shared/constants/routes";
import { EMPTY_FILTER_STATE, parseFilterQueryString } from "@/features/search";

interface UseAppNavigationOptions {
  events: Event[];
  setFilterStateFromURL: (filters: FilterState) => void;
  setSchoolFilter: (school: string) => void;
}

/**
 * Hook for managing navigation, routing, URL params, and QR redirects
 */
export function useAppNavigation({
  events,
  setFilterStateFromURL,
  setSchoolFilter,
}: UseAppNavigationOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  // Track one-shot URL concerns. Filters themselves are intentionally parsed
  // whenever the URL changes so back/forward/shared links hydrate state.
  const hasProcessedInitialRouteMode = useRef(false);
  const hasProcessedInitialSchool = useRef(false);
  const hasProcessedInitialScroll = useRef(false);

  useEffect(() => {
    const filtersParam = searchParams.get(QP.FILTERS);
    const schoolParam = searchParams.get(QP.SCHOOL);
    const pageModeParam = searchParams.get(QP.PAGE_MODE);

    // Process pageMode exactly once on initial mount.
    if (!hasProcessedInitialRouteMode.current) {
      // Handle pageMode redirect
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

    // Handle filters from URL on every URL change. Cap length to protect
    // against oversized/attacker-controlled blobs.
    const MAX_FILTERS_PARAM_BYTES = 4096;
    if (
      filtersParam &&
      filtersParam.length > 2 &&
      filtersParam.length <= MAX_FILTERS_PARAM_BYTES
    ) {
      const parsed = parseFilterQueryString(search ? `?${search}` : "");
      setFilterStateFromURL(parsed ?? EMPTY_FILTER_STATE);
    } else {
      setFilterStateFromURL(EMPTY_FILTER_STATE);
    }
  }, [router, search, searchParams, setFilterStateFromURL, setSchoolFilter]);

  useEffect(() => {
    const eventId = searchParams.get(QP.EVENT_ID);
    // Handle eventId scroll. Only mark processed once we've actually found the
    // event in the loaded events array (cold-load deep-link support).
    if (!hasProcessedInitialScroll.current && eventId) {
      if (events.length === 0) {
        // Wait for events to load; effect will re-run when events changes.
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
        // Events are loaded but this event is not in the list — don't keep
        // re-entering. Mark as processed.
        hasProcessedInitialScroll.current = true;
      }
    } else if (!eventId) {
      hasProcessedInitialScroll.current = true;
    }
  }, [searchParams, events]);
}
