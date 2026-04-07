/**
 * Events Store (Zustand)
 *
 * Single source of truth for all events data. State lives outside React,
 * so every component that imports this store reads the same data — no
 * duplicate fetches, no divergent state.
 */

import { create } from "zustand";
import type { Event, EventFormData } from "@/shared/types";
import {
  fetchAllEvents,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { getUniqueEvents } from "@/shared/utils/event";

type GetDayOfWeekFn = (date: string) => string;

interface EventsState {
  events: Event[];
  isLoading: boolean;
  userCreatedEventIds: number[];

  /** Fetch all events from backend. Idempotent — skips if already loaded. */
  fetchEvents: () => Promise<void>;
  addEvent: (data: EventFormData, getDayOfWeek: GetDayOfWeekFn) => Promise<number>;
  updateEvent: (eventId: number, data: EventFormData, getDayOfWeek: GetDayOfWeekFn) => Promise<void>;
  deleteEvent: (eventId: number) => Promise<void>;
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  isLoading: true,
  userCreatedEventIds: [],

  fetchEvents: async () => {
    // Already loaded or in-flight — skip
    if (get().events.length > 0 || !get().isLoading) return;
    try {
      const events = await fetchAllEvents();
      set({ events, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch events:", err);
      set({ isLoading: false });
    }
  },

  addEvent: async (data, getDayOfWeek) => {
    const created = await createEventAPI(data, getDayOfWeek);
    set((state) => ({
      events: getUniqueEvents([created, ...state.events]),
      userCreatedEventIds: [...state.userCreatedEventIds, created.id],
    }));
    return created.id;
  },

  updateEvent: async (eventId, data, getDayOfWeek) => {
    const event = get().events.find((e) => e.id === eventId);
    if (!event) return;
    const updated = await updateEventAPI(event, data, getDayOfWeek);
    set((state) => ({
      events: state.events.map((e) => (e.id === eventId ? updated : e)),
    }));
  },

  deleteEvent: async (eventId) => {
    try {
      await deleteEventAPI(eventId);
      set((state) => ({
        events: state.events.filter((e) => e.id !== eventId),
        userCreatedEventIds: state.userCreatedEventIds.filter((id) => id !== eventId),
      }));
    } catch (err) {
      console.error("Failed to delete event:", err);
    }
  },
}));
