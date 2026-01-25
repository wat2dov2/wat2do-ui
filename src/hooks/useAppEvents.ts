import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useEvents } from "./useEvents";
import { getDayOfWeek } from "@/utils/date";
import type { Event, EventFormData } from "@/types";

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

  const { events, addEvent, updateEvent, deleteEvent } = useEvents({
    getDayOfWeek: getDayOfWeekFn,
  });

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
    events,
    addEvent,
    updateEvent,
    deleteEvent,
    editingEvent,
    handleEditEvent,
    eventToFormData,
    clearEditing,
  };
}
