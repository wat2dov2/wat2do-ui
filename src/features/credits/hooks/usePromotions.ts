import { useState, useCallback, useMemo } from "react";
import type { PromotedEvent } from "@/shared/types";
import {
  loadCredits,
  loadPromotedEventsAPI,
  addCredits,
  promoteEventAPI,
  getActivePromotedEventIdsAPI,
  isEventPromotedAPI,
} from "@/features/credits/api/credits.api";

/**
 * Custom hook for managing promotions and credits
 */
export function usePromotions() {
  const [userCredits, setUserCredits] = useState<number>(() => {
    return loadCredits();
  });

  const [promotedEvents, setPromotedEvents] = useState<PromotedEvent[]>(() => {
    return loadPromotedEventsAPI();
  });

  // Note: Persistence is handled automatically by API functions

  // Add credits handler
  const handleAddCredits = useCallback((amount: number) => {
    setUserCredits((prev) => {
      const newCredits = addCredits(prev, amount);
      return newCredits;
    });
  }, []);

  // Promote event handler
  const promoteEvent = useCallback(
    (
      eventId: number,
      packageId: string,
      credits: number,
      duration: number
    ): { success: boolean; needsCredits?: boolean } => {
      const result = promoteEventAPI(
        eventId,
        packageId,
        credits,
        duration,
        userCredits,
        promotedEvents
      );

      if (result.success) {
        setUserCredits(result.newCredits);
        setPromotedEvents(result.newPromotions);
        return { success: true };
      } else {
        return { success: false, needsCredits: true };
      }
    },
    [userCredits, promotedEvents]
  );

  // Get active promoted event IDs
  const activePromotedEventIds = useMemo(() => {
    return getActivePromotedEventIdsAPI(promotedEvents);
  }, [promotedEvents]);

  // Check if event is currently promoted
  const isEventPromoted = useCallback(
    (eventId: number) => {
      return isEventPromotedAPI(eventId, promotedEvents);
    },
    [promotedEvents]
  );

  return {
    userCredits,
    promotedEvents,
    activePromotedEventIds,
    addCredits: handleAddCredits,
    promoteEvent,
    isEventPromoted,
  };
}
