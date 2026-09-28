import { defineConfig } from "@playwright/test";
import nextConfig from "./next.config";

// Browser-free checks consume the same public build projection as the application.
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
