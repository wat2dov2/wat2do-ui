import { useState, useEffect, useCallback, useRef } from "react";
import {
  loadSavedEventIdsAPI,
  saveSavedEventIdsAPI,
  toggleSaveEventAPI,
  fetchSavedEventIdsFromBackend,
  saveEventToBackend,
  unsaveEventFromBackend,
} from "@/features/events/api/events.api";
import { isAuthenticated } from "@/features/auth";

/**
 * Custom hook for managing saved events.
 * Syncs to backend when authenticated, falls back to localStorage.
 */
export function useSavedEvents() {
  const [savedEventIds, setSavedEventIds] = useState<number[]>(() => {
    return loadSavedEventIdsAPI();
  });
  const hasSyncedRef = useRef(false);

  // On mount: if authenticated, fetch from backend and merge with localStorage
  useEffect(() => {
    if (!isAuthenticated() || hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    const localIds = loadSavedEventIdsAPI();
    fetchSavedEventIdsFromBackend()
      .then((backendIds) => {
        // Merge: union of local and backend, backend is source of truth
        const merged = [...new Set([...backendIds, ...localIds])];
        setSavedEventIds(merged);
        saveSavedEventIdsAPI(merged);

        // Sync any local-only saves to backend (fire-and-forget)
        const localOnly = localIds.filter((id) => !backendIds.includes(id));
        for (const id of localOnly) {
          saveEventToBackend(id).catch(() => {});
        }
      })
      .catch(() => {
        // Backend unavailable, keep using localStorage
      });
  }, []);

  // Persist to localStorage on every change
  useEffect(() => {
    saveSavedEventIdsAPI(savedEventIds);
  }, [savedEventIds]);

  // Toggle save event handler
  const toggleSaveEvent = useCallback(
    (eventId: number, onConversionAction?: (eventId: number) => void) => {
      setSavedEventIds((prev) => {
        const wasSaved = prev.includes(eventId);
        const newIds = toggleSaveEventAPI(eventId, prev);

        // Sync to backend (fire-and-forget)
        if (isAuthenticated()) {
          if (wasSaved) {
            unsaveEventFromBackend(eventId).catch(() => {});
          } else {
            saveEventToBackend(eventId).catch(() => {});
          }
        }

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
