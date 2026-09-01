import { expect, test } from "@playwright/test";

async function openMapEditor(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  await page.getByLabel("USERNAME").fill("admin_justine");
  await page.getByLabel(/PASSWORD/).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await page.goto("/map-editor");
}

test("Map Editor hides local map features while retaining the editor map", async ({ page }) => {
  await openMapEditor(page);
  await expect(page.getByRole("button", { name: "Local Feature" })).toHaveCount(0);
  await expect(page.getByText("Campus Aquaculture Lagoon")).toHaveCount(0);
  await expect(page.locator(".leaflet-container")).toBeVisible();
});
