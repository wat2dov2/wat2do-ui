import React from "react";
import { Search } from "lucide-react";
import { EventCard } from "./EventCard";
import type { Event } from "@/types";

interface EventListProps {
  events: Event[];
  savedEventIds: number[];
  activePromotedEventIds: number[];
  onToggleSave: (eventId: number) => void;
  viewMode: "grid" | "calendar" | "map";
  allEvents?: Event[];
  isAdmin?: boolean;
  onEdit?: (event: Event) => void;
  onDelete?: (eventId: number) => void;
  onClearFilters?: () => void;
}

/**
 * Event list component
 * Follows Vercel React best practices for rendering performance
 * Uses content-visibility CSS for performance boost
 */
export function EventList({
  events,
  savedEventIds,
  activePromotedEventIds,
  onToggleSave,
  viewMode,
  allEvents,
  isAdmin,
  onEdit,
  onDelete,
  onClearFilters,
}: EventListProps) {
  if (viewMode === "calendar") {
    return (
      <div className="text-center py-32 text-muted-foreground">
        Calendar view coming soon...
      </div>
    );
  }

  if (viewMode === "map") {
    return (
      <div className="text-center py-32 text-muted-foreground">
        Map view coming soon...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Search className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No events found
        </h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
          We couldn't find any events matching your current filters. Try adjusting your search or clearing some filters.
        </p>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
          >
            Clear all filters
          </button>
        )}
      </div>
    );
  }

  // Sort promoted events to the top
  const sortedEvents = [...events].sort((a, b) => {
    const aPromoted = activePromotedEventIds.includes(a.id);
    const bPromoted = activePromotedEventIds.includes(b.id);
    if (aPromoted && !bPromoted) return -1;
    if (!aPromoted && bPromoted) return 1;
    return 0;
  });

  // Grid view with content-visibility for performance
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4"
      role="list"
      aria-label={`${events.length} events found`}
    >
      {sortedEvents.map((event) => (
        <div
          key={event.id}
          role="listitem"
          style={{
            contentVisibility: "auto",
          }}
        >
          <EventCard
            event={event}
            isSaved={savedEventIds.includes(event.id)}
            isPromoted={activePromotedEventIds.includes(event.id)}
            onToggleSave={onToggleSave}
            isAdmin={isAdmin}
            onEdit={onEdit}
            onDelete={onDelete}
            allEvents={allEvents}
          />
        </div>
      ))}
    </div>
  );
}
