/**
 * EventsContext
 * Provides shared state and actions for events feature components
 * Reduces prop drilling across EventList, EventCard, and related components
 */

import React, { createContext, useContext, useMemo } from "react";
import type { Event } from "@/shared/types";

interface EventsContextValue {
  // Saved events
  savedEventIds: number[];
  toggleSaveEvent: (eventId: number) => void;
  
  // Promotions
  activePromotedEventIds: number[];
  
  // Admin actions
  isAdmin: boolean;
  onEdit?: (event: Event) => void;
  onDelete?: (eventId: number) => void;
  
  // All events (for similar events in modal)
  allEvents: Event[];
  
  // Clear filters action
  onClearFilters?: () => void;
  
  // Optional event click handlers
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
}

const EventsContext = createContext<EventsContextValue | null>(null);

interface EventsProviderProps {
  children: React.ReactNode;
  savedEventIds: number[];
  toggleSaveEvent: (eventId: number) => void;
  activePromotedEventIds: number[];
  isAdmin: boolean;
  onEdit?: (event: Event) => void;
  onDelete?: (eventId: number) => void;
  allEvents: Event[];
  onClearFilters?: () => void;
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
}

export function EventsProvider({
  children,
  savedEventIds,
  toggleSaveEvent,
  activePromotedEventIds,
  isAdmin,
  onEdit,
  onDelete,
  allEvents,
  onClearFilters,
  onEventClick,
  disableModal,
}: EventsProviderProps) {
  const value = useMemo(
    () => ({
      savedEventIds,
      toggleSaveEvent,
      activePromotedEventIds,
      isAdmin,
      onEdit,
      onDelete,
      allEvents,
      onClearFilters,
      onEventClick,
      disableModal,
    }),
    [
      savedEventIds,
      toggleSaveEvent,
      activePromotedEventIds,
      isAdmin,
      onEdit,
      onDelete,
      allEvents,
      onClearFilters,
      onEventClick,
      disableModal,
    ]
  );

  return (
    <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
  );
}

export function useEventsContext(): EventsContextValue {
  const context = useContext(EventsContext);
  if (!context) {
    throw new Error("useEventsContext must be used within EventsProvider");
  }
  return context;
}
