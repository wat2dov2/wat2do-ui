import posthog from "posthog-js";

/** True once PostHog has been initialized for this page load. */
function isPostHogReady(): boolean {
  return posthog.__loaded === true;
}

/** Link the current session to the authenticated user when a profile exists. */
export function identifyPostHogUser(
  userId: string | undefined,
  email?: string | null,
): void {
  if (!isPostHogReady() || !userId) return;
  posthog.identify(userId, email ? { email } : undefined);
}

/** Clear identity on logout so the next visitor is not attributed to the previous user. */
export function resetPostHogUser(): void {
  if (!isPostHogReady()) return;
  posthog.reset();
}
