import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useEvents } from "@/features/events/hooks/useEvents";
import { getDayOfWeek } from "@/shared/utils/date";
import type { Event, EventFormData } from "@/shared/types";
import { getEventCategory } from "@/shared/utils/event";

/**
 * Hook for managing events in the App component
 * Extends useEvents with App-specific functionality like edit handling
 */
export function useAppEvents() {
  const { t } = useTranslation();
  const getDayOfWeekFn = useCallback(
    (dateStr: string) => getDayOfWeek(dateStr, t),
    [t]
  );

  const { events, isLoading, addEvent, updateEvent, deleteEvent } = useEvents({
    getDayOfWeek: getDayOfWeekFn,
  });

  // Edit event state
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  // Handle edit event
  const handleEditEvent = useCallback((event: Event) => {
    setEditingEvent(event);
  }, []);

  // Convert Event to EventFormData for edit mode (derive date/time from dtstart_utc when missing)
  const eventToFormData = useCallback((event: Event): EventFormData => {
    let date = event.date || "";
    let time = event.time || "";
    if ((!date || !time) && event.dtstart_utc) {
      const d = new Date(event.dtstart_utc as string);
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }

    const category = getEventCategory(event);

    return {
      title: event.title,
      description: event.description || "",
      date,
      time,
      location: event.location ?? "",
      category,
      price: event.price ?? 0,
      food: event.food || [],
      requiresRegistration: event.requiresRegistration ?? event.registration ?? false,
      organization: event.organization || "",
    };
  }, []);

  // Clear editing state
  const clearEditing = useCallback(() => {
    setEditingEvent(null);
  }, []);

  return {
    events,
    isLoading,
    addEvent,
    updateEvent,
    deleteEvent,
    editingEvent,
    handleEditEvent,
    eventToFormData,
    clearEditing,
  };
}
