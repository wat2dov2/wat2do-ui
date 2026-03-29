/**
 * Lightweight interaction tracker.
 * Buffers events and flushes to POST /interactions/batch every 10s or on page unload.
 */

import { getAccessToken } from "@/shared/services/apiClient";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const FLUSH_INTERVAL_MS = 10_000;
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
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.flush(true));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.flush(true);
      });
    }
  }

  track(eventId: number, type: string, metadata?: Record<string, unknown>) {
    this.queue.push({ event_id: eventId, interaction_type: type, metadata });
  }

  flush(useBeacon = false) {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    const payload = JSON.stringify({
      session_id: getSessionId(),
      interactions: batch,
    });

    const url = `${BASE_URL}/interactions/batch`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, { method: "POST", headers, body: payload }).catch(() => {});
    }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.flush(true);
  }
}

export const tracker = new Tracker();
