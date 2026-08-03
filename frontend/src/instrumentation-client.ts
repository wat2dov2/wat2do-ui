import { initializePostHog } from "@/shared/lib/posthog";

function schedulePostHogInitialization(): void {
  const initialize = () => void initializePostHog();

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(initialize, { timeout: 5000 });
    return;
  }

  globalThis.setTimeout(initialize, 0);
}

if (document.readyState === "complete") {
  schedulePostHogInitialization();
} else {
  window.addEventListener("load", schedulePostHogInitialization, { once: true });
}
