/**
 * Events Store
 * All events come from the backend API.
 */

import { useState, useEffect, useCallback } from "react";
import type { Event, EventFormData } from "@/shared/types";
import {
  fetchAllEvents,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { getUniqueEvents } from "@/shared/utils/event";

type GetDayOfWeekFn = (date: string) => string;

interface UseEventsStoreOptions {
  getDayOfWeek: GetDayOfWeekFn;
}

export function useEventsStore(options: UseEventsStoreOptions) {
  const { getDayOfWeek } = options;

  const [events, setEvents] = useState<Event[]>([]);
  const [userCreatedEventIds, setUserCreatedEventIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    fetchAllEvents()
      .then((apiEvents) => {
        if (!cancelled) setEvents(apiEvents);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const addEvent = useCallback(
    async (eventData: EventFormData): Promise<number> => {
      const created = await createEventAPI(eventData, getDayOfWeek);
      setEvents((prev) => getUniqueEvents([created, ...prev]));
      setUserCreatedEventIds((prev) => [...prev, created.id]);
      return created.id;
    },
    [getDayOfWeek],
  );

  const updateEvent = useCallback(
    async (eventId: number, eventData: EventFormData) => {
      const event = events.find((e) => e.id === eventId);
      if (!event) return;
      const updated = await updateEventAPI(event, eventData, getDayOfWeek);
      setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
    },
    [events, getDayOfWeek],
  );

  const deleteEvent = useCallback(async (eventId: number) => {
    try {
      await deleteEventAPI(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setUserCreatedEventIds((prev) => prev.filter((id) => id !== eventId));
    } catch {
      // Keep event in list on failure
    }
  }, []);

  return { events, isLoading, userCreatedEventIds, addEvent, updateEvent, deleteEvent };
}
