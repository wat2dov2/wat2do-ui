import { useState, useEffect, useCallback, useMemo } from "react";
import type { PromotedEvent } from "@/types";
import {
  promoteEvent as promoteEventService,
  getActivePromotedEventIds,
} from "@/services/promotionService";
import {
  loadUserCredits,
  saveUserCredits,
  loadPromotedEvents,
  savePromotedEvents,
} from "@/repositories/userRepository";

/**
 * Custom hook for managing promotions and credits
 */
export function usePromotions() {
  const [userCredits, setUserCredits] = useState<number>(() => {
    return loadUserCredits();
  });

  const [promotedEvents, setPromotedEvents] = useState<PromotedEvent[]>(() => {
    return loadPromotedEvents();
  });

  // Persist credits and promotions to localStorage
  useEffect(() => {
    saveUserCredits(userCredits);
  }, [userCredits]);

  useEffect(() => {
    savePromotedEvents(promotedEvents);
  }, [promotedEvents]);

  // Add credits handler
  const addCredits = useCallback((amount: number) => {
    setUserCredits((prev) => prev + amount);
  }, []);

  // Promote event handler
  const promoteEvent = useCallback(
    (
      eventId: number,
      packageId: string,
      credits: number,
      duration: number
    ): { success: boolean; needsCredits?: boolean } => {
      const result = promoteEventService(
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
    return getActivePromotedEventIds(promotedEvents);
  }, [promotedEvents]);

  // Check if event is currently promoted
  const isEventPromoted = useCallback(
    (eventId: number) => {
      const now = new Date().toISOString();
      return promotedEvents.some(
        (p) => p.eventId === eventId && p.endDate > now
      );
    },
    [promotedEvents]
  );

  return {
    userCredits,
    promotedEvents,
    activePromotedEventIds,
    addCredits,
    promoteEvent,
    isEventPromoted,
  };
}
