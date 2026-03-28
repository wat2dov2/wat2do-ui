import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEvents } from "@/features/events/hooks/useEvents";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { usePromotions } from "@/features/credits";
import { useSavedEvents } from "@/features/events/hooks/useSavedEvents";
import { filterEvents } from "@/features/search";
import { EventList } from "@/features/events/components/EventList";
import { EventsProvider } from "@/features/events/context/EventsContext";
import { getDayOfWeek } from "@/shared/utils/date";
import type { Event } from "@/shared/types";

interface EventsPageProps {
  profileCompleted: boolean;
  isAdmin?: boolean;
  onEditEvent?: (event: Event) => void;
  onDeleteEvent?: (eventId: number) => void;
  onToggleSave?: (eventId: number) => void;
  viewMode?: "grid" | "calendar" | "map";
  onViewModeChange?: (mode: "grid" | "calendar" | "map") => void;
}

/**
 * EventsPage Component
 * Main page for displaying and filtering events
 * Uses extracted hooks and services for business logic
 */
export function EventsPage({
  profileCompleted,
  isAdmin = false,
  onEditEvent,
  onDeleteEvent,
  onToggleSave,
  viewMode = "grid",
}: EventsPageProps) {
  const { t } = useTranslation();

  // Get day of week helper
  const getDayOfWeekHelper = (date: string) => getDayOfWeek(date, t);

  // Use custom hooks for state management
  const { events, deleteEvent } = useEvents({
    getDayOfWeek: getDayOfWeekHelper,
  });

  const {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    selectedLocations,
    selectedFoods,
    selectedDays,
    priceRange,
    requiresRegistration,
    todayFilter,
    freeFilter,
    freeFoodFilter,
    forYouFilter,
    thisWeekFilter,
    includeFoods,
    clearAllFilters,
  } = useFilterState(profileCompleted);

  const { activePromotedEventIds } = usePromotions();

  const { savedEventIds, toggleSaveEvent } = useSavedEvents();

  // Apply filters using service
  const filteredEvents = useMemo(() => {
    const filtered = filterEvents(events, {
      searchQuery,
      savedFilter: false, // This would come from filters hook
      todayFilter,
      freeFilter,
      freeFoodFilter,
      forYouFilter,
      thisWeekFilter,
      selectedDays,
      priceRange,
      selectedLocations,
      includeFoods,
      selectedFoods,
      selectedCategories,
      requiresRegistration,
      profileCompleted,
      savedEventIds,
    });

    // Apply sorting (would use sortEvents service)
    return filtered;
  }, [
    events,
    searchQuery,
    todayFilter,
    freeFilter,
    freeFoodFilter,
    forYouFilter,
    thisWeekFilter,
    selectedDays,
    priceRange,
    selectedLocations,
    includeFoods,
    selectedFoods,
    selectedCategories,
    requiresRegistration,
    profileCompleted,
    savedEventIds,
  ]);

  const handleDelete = (eventId: number) => {
    deleteEvent(eventId);
    onDeleteEvent?.(eventId);
  };

  const handleEdit = (event: Event) => {
    onEditEvent?.(event);
  };

  const handleToggleSave = (eventId: number) => {
    toggleSaveEvent(eventId);
    onToggleSave?.(eventId);
  };

  return (
    <div className="space-y-5">
      {/* Search and Quick Filters - Always Visible */}
      <div className="space-y-5">
        {/* Search Bar */}
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            placeholder={t("search.placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-muted text-foreground rounded-xl pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-border transition-all shadow-md"
          />
        </div>

        {/* Event Count */}
        <div className="flex items-center justify-between">
          <span className="font-bold text-xl text-foreground">
            {filteredEvents.length}{" "}
            {filteredEvents.length === 1 ? t("common.event") : t("common.events")}
          </span>
          <button
            onClick={clearAllFilters}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("events.clearAllFilters")}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="w-full" role="main" aria-label={t("search.ariaLabel")}>
        <EventsProvider
          savedEventIds={savedEventIds}
          toggleSaveEvent={handleToggleSave}
          activePromotedEventIds={activePromotedEventIds}
          isAdmin={isAdmin}
          onEdit={handleEdit}
          onDelete={handleDelete}
          allEvents={events}
          onClearFilters={clearAllFilters}
        >
          <EventList
            events={filteredEvents}
            viewMode={viewMode}
          />
        </EventsProvider>
      </main>
    </div>
  );
}
