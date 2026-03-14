/**
 * Hook for managing navigation, routing, URL params, and QR redirects
 * Refactored to minimize useEffect usage
 * 
 * Improvements:
 * - pageMode is derived state (useMemo) - no useEffect needed
 * - Combined URL param handling into single useEffect
 * - QR redirect handled efficiently
 */

import { useMemo, useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { PageMode, FilterState, Event } from "@/shared/types";

interface FilterSetters {
  setSearchQuery: (query: string) => void;
  setSelectedCategories: (categories: string[]) => void;
  setSelectedLocations: (locations: string[]) => void;
  setSelectedFoods: (foods: string[]) => void;
  setSelectedDays: (days: string[]) => void;
  setPriceRange: (range: { min: string; max: string }) => void;
  setDateRange: (date: Date | undefined) => void;
  setAddedSince: (date: Date | undefined) => void;
  setRequiresRegistration: (value: boolean) => void;
  setFilterStateFromURL?: (filters: FilterState) => void;
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
  
  // Track if we've already processed initial URL params to avoid re-processing
  const hasProcessedInitialParams = useRef(false);

  // Derived state: Determine current page from route (no useEffect needed)
  const pageMode: PageMode = useMemo(() => {
    const currentPath = location.pathname;
    if (currentPath === "/clubs") return "clubs";
    if (currentPath === "/about") return "about";
    if (currentPath === "/settings") return "settings";
    if (currentPath.startsWith("/admin/events")) return "admin-events";
    if (currentPath.startsWith("/admin/clubs")) return "admin-clubs";
    if (currentPath.startsWith("/admin/submissions")) return "admin-submissions";
    if (currentPath.startsWith("/admin/posters")) return "admin-posters";
    if (currentPath.startsWith("/admin")) return "admin";
    if (currentPath === "/marketing") return "marketing";
    return "events";
  }, [location.pathname]);

  // Combined effect: Handle URL parameters (QR redirect is handled by QRRedirectPage at /qr/:id)
  useEffect(() => {
    // Handle URL parameters (only process once on initial load)
    if (!hasProcessedInitialParams.current) {
      const eventId = searchParams.get("eventId");
      const filtersParam = searchParams.get("filters");
      const pageModeParam = searchParams.get("pageMode");

      // Handle pageMode redirect
      if (pageModeParam) {
        if (pageModeParam === "marketing") {
          navigate("/marketing", { replace: true });
        } else if (pageModeParam === "events") {
          navigate("/", { replace: true });
        }
        hasProcessedInitialParams.current = true;
        return;
      }

      // Handle filters from URL only when explicitly present (e.g. shared link or QR redirect)
      if (filtersParam && filtersParam.length > 2) {
        try {
          const parsedFilters: FilterState = JSON.parse(decodeURIComponent(filtersParam));
          if (filters.setFilterStateFromURL) {
            filters.setFilterStateFromURL(parsedFilters);
          } else {
            if (parsedFilters.categories?.length) filters.setSelectedCategories(parsedFilters.categories);
            if (parsedFilters.locations?.length) filters.setSelectedLocations(parsedFilters.locations);
            if (parsedFilters.foods?.length) filters.setSelectedFoods(parsedFilters.foods);
            if (parsedFilters.days?.length) filters.setSelectedDays(parsedFilters.days);
            if (parsedFilters.priceRange) filters.setPriceRange(parsedFilters.priceRange);
            if (parsedFilters.dateRange) filters.setDateRange(new Date(parsedFilters.dateRange));
            if (parsedFilters.addedSince) filters.setAddedSince(new Date(parsedFilters.addedSince));
            if (parsedFilters.requiresRegistration !== undefined)
              filters.setRequiresRegistration(parsedFilters.requiresRegistration);
            if (parsedFilters.searchQuery) filters.setSearchQuery(parsedFilters.searchQuery);
          }
        } catch {
          // Silently fail if filters can't be parsed from URL
        }
      }

      // Handle eventId scroll
      if (eventId) {
        const event = events.find((e) => e.id === parseInt(eventId));
        if (event) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              const eventCard = document.querySelector(
                `[data-event-id="${eventId}"]`
              );
              eventCard?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 100);
          });
        }
      }

      hasProcessedInitialParams.current = true;
    }
  }, [location.pathname, searchParams, navigate, filters, events]);

  return {
    pageMode,
    navigate,
    location,
  };
}
