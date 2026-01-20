import type { Event } from "@/types";

/**
 * Share an event using the Web Share API with fallback to clipboard
 * Follows Web Interface Guidelines for sharing functionality
 */
export async function shareEvent(event: Event): Promise<void> {
  const shareData = {
    title: event.title,
    text: `${event.title}\n${event.date} at ${event.time}\n${event.location}`,
    url: `${window.location.origin}/?eventId=${event.id}`,
  };

  // Use Web Share API if available (mobile browsers, some desktop)
  if (navigator.share && navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      // User cancelled or error occurred, fall back to clipboard
      if ((error as Error).name !== "AbortError") {
        console.error("Error sharing:", error);
      }
    }
  }

  // Fallback: Copy to clipboard
  try {
    const shareText = `${shareData.title}\n${shareData.text}\n${shareData.url}`;
    await navigator.clipboard.writeText(shareText);
    
    // Show toast notification (you can enhance this with a toast library)
    // For now, we'll rely on the UI to show feedback
    return;
  } catch (error) {
    console.error("Error copying to clipboard:", error);
    throw new Error("Failed to share event. Please copy the link manually.");
  }
}

/**
 * Generate a shareable URL for an event
 */
export function getEventShareUrl(event: Event): string {
  return `${window.location.origin}/?eventId=${event.id}`;
}

/**
 * Copy event link to clipboard
 */
export async function copyEventLink(event: Event): Promise<void> {
  const url = getEventShareUrl(event);
  try {
    await navigator.clipboard.writeText(url);
  } catch (error) {
    console.error("Error copying link:", error);
    throw new Error("Failed to copy link to clipboard.");
  }
}
