/**
 * Hook for managing navigation, routing, URL params, and QR redirects
 *
 * - pageMode is derived state (useMemo) — no useEffect needed
 * - Combined URL param handling into a single useEffect
 * - QR redirect handled by QRRedirectPage at /qr/:id
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { FilterState, Event } from "@/shared/types";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";
import { ROUTES } from "@/shared/constants/routes";
import { derivePageMode } from "@/shared/utils/pageMode";
import { parseFilterQueryString } from "@/features/search/api/filterService";

interface FilterSetters {
  setFilterStateFromURL: (filters: FilterState) => void;
}

interface UseAppNavigationOptions {
  events: Event[];
  filters: FilterSetters;
}

/**
 * Hook for managing navigation, routing, URL params, and QR redirects
 */
export function useAppNavigation({
  events,
  filters,
}: UseAppNavigationOptions) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Track if we've already processed initial URL params to avoid re-processing.
  // Split by concern: filters/pageMode process once, but scroll-to-event must
  // wait for the events array to be non-empty (cold-load race).
  const hasProcessedInitialFilters = useRef(false);
  const hasProcessedInitialScroll = useRef(false);

  // Derive pageMode directly from the current pathname (pure function).
  const pageMode = derivePageMode(location.pathname);

  useEffect(() => {
    const eventId = searchParams.get(QP.EVENT_ID);
    const filtersParam = searchParams.get(QP.FILTERS);
    const pageModeParam = searchParams.get(QP.PAGE_MODE);

    // Process filters + pageMode exactly once on initial mount.
    if (!hasProcessedInitialFilters.current) {
      // Handle pageMode redirect
      if (pageModeParam) {
        if (pageModeParam === "marketing") {
          navigate(ROUTES.MARKETING, { replace: true });
        } else if (pageModeParam === "events") {
          navigate(ROUTES.HOME, { replace: true });
        }
        hasProcessedInitialFilters.current = true;
        hasProcessedInitialScroll.current = true;
        return;
      }

      // Handle filters from URL only when explicitly present (e.g. shared link
      // or QR redirect). Cap length to protect against oversized/attacker-
      // controlled blobs.
      const MAX_FILTERS_PARAM_BYTES = 4096;
      if (
        filtersParam &&
        filtersParam.length > 2 &&
        filtersParam.length <= MAX_FILTERS_PARAM_BYTES
      ) {
        const parsed = parseFilterQueryString(`${QP.FILTERS}=${filtersParam}`);
        if (parsed) {
          filters.setFilterStateFromURL(parsed);
        }
      }
      hasProcessedInitialFilters.current = true;
    }

    // Handle eventId scroll. Only mark processed once we've actually found the
    // event in the loaded events array (cold-load deep-link support).
    if (!hasProcessedInitialScroll.current && eventId) {
      if (events.length === 0) {
        // Wait for events to load; effect will re-run when events changes.
        return;
      }
      const event = events.find((e) => e.id === parseInt(eventId, 10));
      if (event) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            const eventCard = document.querySelector(
              `[data-event-id="${eventId}"]`,
            );
            eventCard?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, SCROLL_INTO_VIEW_DELAY_MS);
        });
        hasProcessedInitialScroll.current = true;
      } else {
        // Events are loaded but this event is not in the list — don't keep
        // re-entering. Mark as processed.
        hasProcessedInitialScroll.current = true;
      }
    } else if (!eventId) {
      hasProcessedInitialScroll.current = true;
    }
  }, [location.pathname, searchParams, navigate, filters, events]);

  return {
    pageMode,
    navigate,
    location,
  };
}
