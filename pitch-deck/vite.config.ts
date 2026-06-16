import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxy = {
  "/api": {
    target: "https://wat2do.io",
    changeOrigin: true,
    secure: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
});
