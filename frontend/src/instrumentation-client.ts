import posthog from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (
  typeof window !== "undefined" &&
  token &&
  process.env.NODE_ENV === "production" &&
  !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
) {
  posthog.init(token, {
    api_host: host || "https://us.i.posthog.com",
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
}
