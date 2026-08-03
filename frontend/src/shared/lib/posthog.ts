type PostHogClient = typeof import("posthog-js").default;

let postHogClient: PostHogClient | null = null;
let postHogInitialization: Promise<void> | null = null;
let pendingIdentity: { userId: string; email?: string | null } | null = null;

function shouldInitializePostHog(): boolean {
  return Boolean(
    typeof window !== "undefined" &&
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
      process.env.NODE_ENV === "production" &&
      !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname),
  );
}

/** Load analytics after the page has become interactive, not in the critical bundle. */
export function initializePostHog(): Promise<void> {
  if (!shouldInitializePostHog()) return Promise.resolve();
  if (postHogInitialization) return postHogInitialization;

  postHogInitialization = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
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
    postHogClient = posthog;

    if (pendingIdentity) {
      posthog.identify(
        pendingIdentity.userId,
        pendingIdentity.email ? { email: pendingIdentity.email } : undefined,
      );
      pendingIdentity = null;
    }
  });

  return postHogInitialization;
}

/** Link the current session to the authenticated user when a profile exists. */
export function identifyPostHogUser(
  userId: string | undefined,
  email?: string | null,
): void {
  if (!userId) return;
  if (!postHogClient) {
    pendingIdentity = { userId, email };
    return;
  }
  postHogClient.identify(userId, email ? { email } : undefined);
}

/** Clear identity on logout so the next visitor is not attributed to the previous user. */
export function resetPostHogUser(): void {
  pendingIdentity = null;
  postHogClient?.reset();
}
