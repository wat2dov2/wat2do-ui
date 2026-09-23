/**
 * Lightweight interaction tracker.
 * Buffers events and flushes via fetch-keepalive on page unload / visibility change.
 *
 * Uses fetch() with keepalive instead of sendBeacon so we can attach the
 * Authorization header.  sendBeacon cannot set custom headers, which previously
 * forced the access token into the JSON body - a credential-exposure risk
 * (POST bodies are logged by proxies, WAFs, and APM tools).
 */

import { getAccessToken } from "@/shared/services/apiClient";
import { API_BASE_URL } from "@/shared/config/api";
import { controlBox } from "@/shared/config/controlBox";
import type { components } from "@/shared/generated/api-types";
import discoveryQueriesControl from "../../../../backend/controlbox/discovery_queries.json";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";

interface QueuedInteraction {
  event_id: number;
  interaction_type: string;
  metadata?: Record<string, unknown>;
}

/** High-signal types flush immediately so SPA navigations don't drop them. */
const IMMEDIATE_FLUSH_TYPES = new Set(["click", "going", "ungoing", "share", "detail_view"]);

function getSessionId(): string {
  let sid = sessionStorage.getItem(STORAGE_KEYS.SESSION_ID);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEYS.SESSION_ID, sid);
  }
  return sid;
}

function isExpectedFlushAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") {
    return true;
  }

  const message = err instanceof Error ? err.message : String(err);
  return message === "Failed to fetch" && document.visibilityState === "hidden";
}

function isExpectedLocalDevNetworkMiss(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const localApi =
    API_BASE_URL.startsWith("http://localhost") ||
    API_BASE_URL.startsWith("http://127.0.0.1");

  return process.env.NODE_ENV === "development" && localApi && message === "Failed to fetch";
}

/** Shared unload-safe transport; telemetry never enters the UI API/error path. */
function postTrackingPayload(path: string, body: string, signal?: AbortSignal) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body,
    keepalive: true,
    priority: "low",
    signal,
  });
}

export function trackDiscoveryQuery(data: components["schemas"]["DiscoveryQueryCreate"]) {
  const send = async () => {
    const body = JSON.stringify(data);
    for (let attempt = 0; attempt <= discoveryQueriesControl.retry_delays_ms.length; attempt++) {
      try {
        const response = await postTrackingPayload(
          "/discovery-queries/", body,
          AbortSignal.timeout(discoveryQueriesControl.request_timeout_ms),
        );
        if (response.ok || (response.status < 500 && response.status !== 429)) return;
      } catch {
        // Network failures affect telemetry only. Retry the same immutable row ID.
      }
      const delay = discoveryQueriesControl.retry_delays_ms[attempt];
      if (delay === undefined) return;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  };
  // Defer even serialization/network setup until after the current UI task.
  setTimeout(() => { void send().catch(() => undefined); }, 0);
}

// Low-signal leftovers still debounce; clicks/going flush immediately.
class Tracker {
  private queue: QueuedInteraction[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.flush());
      window.addEventListener("pagehide", () => this.flush());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.flush();
      });
    }
  }

  track(eventId: number, type: string, metadata?: Record<string, unknown>) {
    this.queue.push({ event_id: eventId, interaction_type: type, metadata });
    if (IMMEDIATE_FLUSH_TYPES.has(type)) {
      this.flush();
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, controlBox.interactionTracking.flushDebounceMs);
  }

  flush() {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.flushing || this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    const payload = JSON.stringify({
      session_id: getSessionId(),
      interactions: batch,
    });

    this.flushing = true;
    void postTrackingPayload("/interactions/batch", payload)
      .then((response) => {
        if (!response.ok) {
          // Put the batch back so a later open/hide can retry.
          this.queue.unshift(...batch);
          console.error(
            "Failed to flush interaction batch:",
            response.status,
            response.statusText,
          );
        }
      })
      .catch((err: unknown) => {
        if (isExpectedFlushAbort(err) || isExpectedLocalDevNetworkMiss(err)) return;
        this.queue.unshift(...batch);
        console.error("Failed to flush interaction batch:", err);
      })
      .finally(() => {
        this.flushing = false;
        if (this.queue.length > 0) {
          this.scheduleFlush();
        }
      });
  }
}

export const tracker = new Tracker();
