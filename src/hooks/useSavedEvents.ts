import { useState, useEffect, useCallback } from "react";

/**
 * Custom hook for managing saved events
 * Persists to localStorage following Vercel React best practices
 */
export function useSavedEvents() {
  const [savedEventIds, setSavedEventIds] = useState<number[]>(() => {
    const saved = localStorage.getItem("savedEventIds");
    return saved ? JSON.parse(saved) : [];
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem("savedEventIds", JSON.stringify(savedEventIds));
  }, [savedEventIds]);

  const toggleSaveEvent = useCallback((eventId: number) => {
    setSavedEventIds((prev) => {
      const wasSaved = prev.includes(eventId);
      const newIds = prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId];
      
      // Track conversion if user came from QR code
      if (!wasSaved) {
        const sessionId = sessionStorage.getItem("qrSessionId");
        if (sessionId) {
          // Find the most recent QR scan for this session
          import("@/utils/qrRedirect").then(({ getQRScans, addConversionAction }) => {
            const scans = getQRScans();
            const recentScan = scans
              .filter((s) => s.sessionId === sessionId)
              .sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime())[0];
            if (recentScan) {
              addConversionAction(recentScan.qrCodeId, "event_saved", sessionId);
            }
          });
        }
      }
      
      return newIds;
    });
  }, []);

  return {
    savedEventIds,
    toggleSaveEvent,
  };
}
