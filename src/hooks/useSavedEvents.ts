import { useState, useEffect, useCallback } from "react";
import {
  loadSavedEventIds,
  saveSavedEventIds,
} from "@/repositories/userRepository";

/**
 * Custom hook for managing saved events
 */
export function useSavedEvents() {
  const [savedEventIds, setSavedEventIds] = useState<number[]>(() => {
    return loadSavedEventIds();
  });

  // Persist saved events to localStorage
  useEffect(() => {
    saveSavedEventIds(savedEventIds);
  }, [savedEventIds]);

  // Toggle save event handler
  const toggleSaveEvent = useCallback(
    (eventId: number, onConversionAction?: (eventId: number) => void) => {
      setSavedEventIds((prev) => {
        const wasSaved = prev.includes(eventId);
        const newIds = prev.includes(eventId)
          ? prev.filter((id) => id !== eventId)
          : [...prev, eventId];

        // Track conversion if user came from QR code
        if (!wasSaved && onConversionAction) {
          onConversionAction(eventId);
        }

        return newIds;
      });
    },
    []
  );

  return {
    savedEventIds,
    toggleSaveEvent,
  };
}
