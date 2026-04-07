/**
 * Lightweight interaction tracker.
 * Buffers events and flushes via sendBeacon on page unload / visibility change.
 */

import { getAccessToken } from "@/shared/services/apiClient";
import { API_BASE_URL } from "@/shared/config/api";

const BASE_URL = API_BASE_URL;
const SESSION_KEY = "wat2do_session_id";

interface QueuedInteraction {
  event_id: number;
  interaction_type: string;
  metadata?: Record<string, unknown>;
}

function getSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sid);
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
      token: getAccessToken(),
      interactions: batch,
    });

    const url = `${BASE_URL}/interactions/batch`;
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(url, blob);
  }
}

export const tracker = new Tracker();
