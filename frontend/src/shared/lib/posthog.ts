import posthog from "posthog-js";

let initialized = false;

function isLocalHostname(): boolean {
  if (typeof window === "undefined") return true;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

/**
 * Initialize PostHog once on the client.
 * Skips development and localhost so local browsing does not burn free-tier quota.
 */
export function initPostHog(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "development" || isLocalHostname()) return;

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return;

  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";

  posthog.init(token, {
    api_host: host,
    defaults: "2026-05-30",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-ph-mask]",
    },
  });

  initialized = true;
}

/** Link the current session to the authenticated user when a profile exists. */
export function identifyPostHogUser(
  userId: string | undefined,
  email?: string | null,
): void {
  if (!initialized || !userId) return;
  posthog.identify(userId, email ? { email } : undefined);
}

/** Clear identity on logout so the next visitor is not attributed to the previous user. */
export function resetPostHogUser(): void {
  if (!initialized) return;
  posthog.reset();
}
