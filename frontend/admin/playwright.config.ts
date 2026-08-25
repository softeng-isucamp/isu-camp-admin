import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:5198",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 1024 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5198",
    url: "http://127.0.0.1:5198",
    env: { VITE_API_MODE: "local", VITE_MAP_FIXTURE: "osm" },
    reuseExistingServer: false,
  },
});
