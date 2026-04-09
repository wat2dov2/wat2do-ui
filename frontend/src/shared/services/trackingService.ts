/**
 * Lightweight interaction tracker.
 * Buffers events and flushes via fetch-keepalive on page unload / visibility change.
 *
 * Uses fetch() with keepalive instead of sendBeacon so we can attach the
 * Authorization header.  sendBeacon cannot set custom headers, which previously
 * forced the access token into the JSON body — a credential-exposure risk
 * (POST bodies are logged by proxies, WAFs, and APM tools).
 */

import { getAccessToken } from "@/shared/services/apiClient";
import { API_BASE_URL } from "@/shared/config/api";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";

interface QueuedInteraction {
  event_id: number;
  interaction_type: string;
  metadata?: Record<string, unknown>;
}

function getSessionId(): string {
  let sid = sessionStorage.getItem(STORAGE_KEYS.SESSION_ID);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEYS.SESSION_ID, sid);
  }
  return sid;
}

class Tracker {
  private queue: QueuedInteraction[] = [];

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.flush());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.flush();
      });
    }
  }

  track(eventId: number, type: string, metadata?: Record<string, unknown>) {
    this.queue.push({ event_id: eventId, interaction_type: type, metadata });
  }

  flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    const payload = JSON.stringify({
      session_id: getSessionId(),
      interactions: batch,
    });

    const url = `${API_BASE_URL}/interactions/batch`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // fetch + keepalive survives page unload (like sendBeacon) but supports
    // custom headers, so the token travels in the Authorization header — not
    // in the request body where it could be logged by intermediaries.
    fetch(url, {
      method: "POST",
      headers,
      body: payload,
      keepalive: true,
    }).catch((err) => console.error("Failed to flush interaction batch:", err));
  }
}

export const tracker = new Tracker();
