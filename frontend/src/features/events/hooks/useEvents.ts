/**
 * Events Feature Hook
 * Main hook for events feature - combines store and business logic
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useEventsStore } from "@/features/events/store/events.store";
import { getDayOfWeek } from "@/shared/utils/date";
import type { Event, EventFormData } from "@/shared/types";

/**
 * Helper type for day of week function
 */
type GetDayOfWeekFn = (date: string) => string;

interface UseEventsOptions {
  getDayOfWeek: GetDayOfWeekFn;
}

/**
 * Main events hook
 * Provides events state and operations
 */
export function useEvents(options?: UseEventsOptions) {
  const { t } = useTranslation();
  const getDayOfWeekFn = useCallback(
    (dateStr: string) => {
      if (options?.getDayOfWeek) {
        return options.getDayOfWeek(dateStr);
      }
      return getDayOfWeek(dateStr, t);
    },
    [options?.getDayOfWeek, t]
  );

  const store = useEventsStore({ getDayOfWeek: getDayOfWeekFn });

  // Edit event state
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  // Handle edit event
  const handleEditEvent = useCallback((event: Event) => {
    setEditingEvent(event);
  }, []);

  // Convert Event to EventFormData for edit mode
  const eventToFormData = useCallback((event: Event): EventFormData => {
    return {
      title: event.title,
      description: event.description || "",
      date: event.date || "",
      time: event.time || "",
      location: event.location,
      category: event.category || "Events",
      price: event.price || 0,
      food: event.food || [],
      requiresRegistration: event.requiresRegistration || false,
      organization: event.organization || "",
    };
  }, []);

  // Clear editing state
  const clearEditing = useCallback(() => {
    setEditingEvent(null);
  }, []);

  return {
    ...store,
    editingEvent,
    handleEditEvent,
    eventToFormData,
    clearEditing,
  };
}
