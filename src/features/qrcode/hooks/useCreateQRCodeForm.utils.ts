import type { QRCode, Event } from "@/shared/types";
import { getUniqueEvents as getUniqueEventsFromUtils } from "@/shared/utils/event";

/**
 * Re-export getUniqueEvents from shared utils for backward compatibility
 * @deprecated Import directly from @/shared/utils/event instead
 */
export const getUniqueEvents = getUniqueEventsFromUtils;

/**
 * Create a QRCode object from form state
 */
export function createQRCodeFromState(
  state: {
    name: string;
    description: string;
    destinationType: "event" | "events-list" | "custom-url";
    selectedEventId: number | undefined;
    customUrl: string;
    filters: any;
    imageUrl: string;
  },
  userEmail: string
): QRCode {
  return {
    id: `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: state.name.trim(),
    description: state.description.trim() || undefined,
    destinationType: state.destinationType,
    destinationId:
      state.destinationType === "event"
        ? state.selectedEventId
        : state.destinationType === "custom-url"
        ? state.customUrl.trim()
        : undefined,
    filters: state.destinationType === "events-list" ? state.filters : undefined,
    createdAt: new Date().toISOString(),
    createdBy: userEmail,
    isActive: true,
    imageUrl: state.imageUrl || undefined,
    latitude: 0,
    longitude: 0,
  };
}
