import { useState, useEffect, useCallback } from "react";
import type { Event, EventFormData } from "@/types";
import { mockEvents } from "@/data/events";
import {
  createEvent,
  updateEvent as updateEventService,
} from "@/services/eventService";
import {
  loadUserEvents,
  saveUserEvents,
  loadUserEventIds,
  saveUserEventIds,
  removeUserEvent,
} from "@/repositories/eventRepository";

/**
 * Hook to get day of week from date string
 * This is a helper that should be provided by a date utility
 */
type GetDayOfWeekFn = (date: string) => string;

interface UseEventsOptions {
  getDayOfWeek: GetDayOfWeekFn;
}

/**
 * Custom hook for managing events
 */
export function useEvents(options: UseEventsOptions) {
  const { getDayOfWeek } = options;

  // Events state (combines mock events with user-created events)
  const [events, setEvents] = useState<Event[]>(() => {
    const userEvents = loadUserEvents();
    return [...mockEvents, ...userEvents];
  });

  // Track user-created event IDs separately for persistence
  const [userCreatedEventIds, setUserCreatedEventIds] = useState<number[]>(
    () => {
      return loadUserEventIds();
    }
  );

  // Persist user-created events to localStorage
  useEffect(() => {
    const userEvents = events.filter((e) => userCreatedEventIds.includes(e.id));
    saveUserEvents(userEvents);
    saveUserEventIds(userCreatedEventIds);
  }, [events, userCreatedEventIds]);

  // Add event handler
  const addEvent = useCallback(
    (eventData: EventFormData): number => {
      const newEvent = createEvent(eventData, getDayOfWeek);
      const newId = newEvent.id;

      setEvents((prev) => [newEvent, ...prev]);
      setUserCreatedEventIds((prev) => [...prev, newId]);
      return newId;
    },
    [getDayOfWeek]
  );

  // Update event handler
  const updateEvent = useCallback(
    (eventId: number, eventData: EventFormData) => {
      setEvents((prev) =>
        prev.map((event) =>
          event.id === eventId
            ? updateEventService(event, eventData, getDayOfWeek)
            : event
        )
      );

      // Update localStorage if it's a user-created event
      if (userCreatedEventIds.includes(eventId)) {
        const updatedEvents = events
          .filter((e) => userCreatedEventIds.includes(e.id))
          .map((e) =>
            e.id === eventId
              ? updateEventService(e, eventData, getDayOfWeek)
              : e
          );
        saveUserEvents(updatedEvents);
      }
    },
    [events, userCreatedEventIds, getDayOfWeek]
  );

  // Delete event handler
  const deleteEvent = useCallback(
    (eventId: number) => {
      setEvents((prev) => prev.filter((event) => event.id !== eventId));

      // Remove from user-created events if applicable
      if (userCreatedEventIds.includes(eventId)) {
        setUserCreatedEventIds((prev) => prev.filter((id) => id !== eventId));
        removeUserEvent(eventId);
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
