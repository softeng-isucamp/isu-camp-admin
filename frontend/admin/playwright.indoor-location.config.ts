import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "indoor-location-marker.spec.ts",
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:5201",
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    video: "on",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "VITE_TEST_LOCAL_ADAPTER=true VITE_API_MODE=local npm run dev -- --host 127.0.0.1 --port 5201",
    url: "http://127.0.0.1:5201",
    env: { VITE_TEST_LOCAL_ADAPTER: "true", VITE_API_MODE: "local" },
    reuseExistingServer: false,
  },
});
