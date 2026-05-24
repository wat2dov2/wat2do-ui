import type { Event } from "@/shared/types";
import { tracker } from "@/shared/services/trackingService";
import { formatDisplayDate, formatDisplayTime } from "@/shared/utils/date";

/**
 * Share an event using the Web Share API with fallback to clipboard
 * Follows Web Interface Guidelines for sharing functionality
 */
export async function shareEvent(event: Event): Promise<void> {
  tracker.track(event.id, "share");
  const shareData = {
    title: event.title,
    text: `${event.title}\n${formatDisplayDate(event)} ${formatDisplayTime(event)}\n${event.location}`,
    url: `${window.location.origin}/?eventId=${event.id}`,
  };

  // Use Web Share API if available (mobile browsers, some desktop)
  if (navigator.share && navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      console.error("Web Share API failed, falling back to clipboard:", err);
    }
  }

  // Fallback: Copy to clipboard
  try {
    const shareText = `${shareData.title}\n${shareData.text}\n${shareData.url}`;
    await navigator.clipboard.writeText(shareText);
    
    // Show toast notification (you can enhance this with a toast library)
    // For now, we'll rely on the UI to show feedback
    return;
  } catch (err) {
    console.error("Failed to copy share text to clipboard:", err);
    throw new Error("Failed to share event. Please copy the link manually.");
  }
}
