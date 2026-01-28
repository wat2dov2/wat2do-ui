/**
 * Events Store
 * Manages events state
 */

import { useState, useEffect, useCallback } from "react";
import type { Event, EventFormData } from "@/shared/types";
import {
  loadAllEvents,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { getUniqueEvents } from "@/shared/utils/event";

type GetDayOfWeekFn = (date: string) => string;

interface UseEventsStoreOptions {
  getDayOfWeek: GetDayOfWeekFn;
}

/**
 * Events store hook
 * Manages events state and persistence
 */
export function useEventsStore(options: UseEventsStoreOptions) {
  const { getDayOfWeek } = options;

  // Events state (combines mock events with user-created events)
  const [events, setEvents] = useState<Event[]>(() => {
    return loadAllEvents();
  });

  // Track user-created event IDs separately
  const [userCreatedEventIds, setUserCreatedEventIds] = useState<number[]>(
    () => {
      const userEvents = loadAllEvents().filter((e) =>
        e.addedDate !== undefined
      );
      return userEvents.map((e) => e.id);
    }
  );
  
  // Note: Persistence is now handled automatically by API functions

  // Add event handler
  const addEvent = useCallback(
    (eventData: EventFormData): number => {
      const newEvent = createEventAPI(eventData, getDayOfWeek);
      const newId = newEvent.id;

      setEvents((prev) => {
        // Deduplicate to prevent adding the same event twice
        const updated = [newEvent, ...prev];
        return getUniqueEvents(updated);
      });
      setUserCreatedEventIds((prev) => [...prev, newId]);
      return newId;
    },
    [getDayOfWeek]
  );

  // Update event handler
  const updateEvent = useCallback(
    (eventId: number, eventData: EventFormData) => {
      const event = events.find((e) => e.id === eventId);
      if (!event) return;
      
      // API handles persistence automatically
      const updatedEvent = updateEventAPI(event, eventData, getDayOfWeek);
      
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? updatedEvent : e))
      );
    },
    [events, getDayOfWeek]
  );

  // Delete event handler
  const deleteEvent = useCallback(
    (eventId: number) => {
      setEvents((prev) => prev.filter((event) => event.id !== eventId));

      // Remove from user-created events if applicable
      if (userCreatedEventIds.includes(eventId)) {
        setUserCreatedEventIds((prev) => prev.filter((id) => id !== eventId));
        deleteEventAPI(eventId);
      }
    },
    [userCreatedEventIds]
  );

  return {
    events,
    userCreatedEventIds,
    addEvent,
    updateEvent,
    deleteEvent,
  };
}
