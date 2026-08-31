import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "locations-real-mode.spec.ts",
  timeout: 90_000,
  use: { baseURL: "http://127.0.0.1:5199", viewport: { width: 1280, height: 1024 } },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5199",
    url: "http://127.0.0.1:5199",
    env: { VITE_API_MODE: "real" },
    reuseExistingServer: false,
  },
});
