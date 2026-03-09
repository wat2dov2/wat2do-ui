import { useState, useEffect, useCallback } from "react";
import {
  loadSavedEventIdsAPI,
  saveSavedEventIdsAPI,
  toggleSaveEventAPI,
} from "@/features/events/api/events.api";

/**
 * Custom hook for managing saved events
 */
export function useSavedEvents() {
  const [savedEventIds, setSavedEventIds] = useState<number[]>(() => {
    return loadSavedEventIdsAPI();
  });

  // Persist saved events to localStorage
  useEffect(() => {
    saveSavedEventIdsAPI(savedEventIds);
  }, [savedEventIds]);

  // Toggle save event handler
  const toggleSaveEvent = useCallback(
    (eventId: number, onConversionAction?: (eventId: number) => void) => {
      setSavedEventIds((prev) => {
        const wasSaved = prev.includes(eventId);
        const newIds = toggleSaveEventAPI(eventId, prev);

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
