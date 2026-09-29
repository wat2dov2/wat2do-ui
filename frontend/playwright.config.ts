import { defineConfig } from "@playwright/test";
import nextConfig from "./next.config";

// Share the small public settings projection; load artwork inside test workers.
process.env.NEXT_PUBLIC_EVENT_DISCOVERY = nextConfig.env?.NEXT_PUBLIC_EVENT_DISCOVERY;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
