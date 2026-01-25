import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getQRCodeById, handleQRRedirect } from "@/utils/qrRedirect";
import type { PageMode, FilterState, Event } from "@/types";

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
}

interface UseAppNavigationOptions {
  events: Event[];
  filters: FilterSetters;
}

/**
 * Hook for managing navigation, routing, URL params, and QR redirects in the App component
 */
export function useAppNavigation({
  events,
  filters,
}: UseAppNavigationOptions) {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine current page from route
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

  // Handle QR code scans from URL
  useEffect(() => {
    const path = window.location.pathname;
    const qrMatch = path.match(/^\/qr\/(.+)$/);
    if (qrMatch) {
      const qrCodeId = qrMatch[1];
      const qrCode = getQRCodeById(qrCodeId);
      if (qrCode) {
        handleQRRedirect(qrCode);
      } else {
        // QR code not found, redirect to events page
        navigate("/", { replace: true });
      }
    }
  }, [navigate]);

  // Handle URL parameters for eventId and filters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("eventId");
    const filtersParam = params.get("filters");
    const pageModeParam = params.get("pageMode");

    if (pageModeParam) {
      if (pageModeParam === "marketing") {
        navigate("/marketing", { replace: true });
      } else if (pageModeParam === "events") {
        navigate("/", { replace: true });
      }
    }

    if (filtersParam) {
      try {
        const parsedFilters: FilterState = JSON.parse(decodeURIComponent(filtersParam));
        if (parsedFilters.categories) filters.setSelectedCategories(parsedFilters.categories);
        if (parsedFilters.locations) filters.setSelectedLocations(parsedFilters.locations);
        if (parsedFilters.foods) filters.setSelectedFoods(parsedFilters.foods);
        if (parsedFilters.days) filters.setSelectedDays(parsedFilters.days);
        if (parsedFilters.priceRange) filters.setPriceRange(parsedFilters.priceRange);
        if (parsedFilters.dateRange) filters.setDateRange(new Date(parsedFilters.dateRange));
        if (parsedFilters.addedSince) filters.setAddedSince(new Date(parsedFilters.addedSince));
        if (parsedFilters.requiresRegistration !== undefined)
          filters.setRequiresRegistration(parsedFilters.requiresRegistration);
        if (parsedFilters.searchQuery) filters.setSearchQuery(parsedFilters.searchQuery);
      } catch (e) {
        console.error("Failed to parse filters from URL", e);
      }
    }

    if (eventId) {
      // Scroll to event if found
      const event = events.find((e) => e.id === parseInt(eventId));
      if (event) {
        setTimeout(() => {
          const eventCard = document.querySelector(
            `[data-event-id="${eventId}"]`
          );
          eventCard?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    }
  }, [
    events,
    navigate,
    filters,
  ]);

  return {
    pageMode,
    navigate,
    location,
  };
}
