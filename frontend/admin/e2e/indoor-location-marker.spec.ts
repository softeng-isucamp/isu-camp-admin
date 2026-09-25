import { expect, test } from "@playwright/test";

test("an admin marks an existing room inside its building and the marker hides when zoomed out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("USERNAME").fill("admin_justine");
  await page.getByLabel(/PASSWORD/).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/map-editor?location=osm-building-c5fb7a267a8ca63d");
  const inspector = page.getByRole("complementary", { name: /Administration Building object details/ });
  await expect(inspector).toBeVisible();
  await inspector.getByRole("button", { name: /More actions for Administration Building/ }).click();
  await page.getByRole("menuitem", { name: /Mark indoor location/ }).click();

  const chooser = page.getByRole("dialog", { name: "Mark indoor location" });
  await expect(chooser).toBeVisible();
  await expect(chooser).toContainText("Administration Building Ground Floor");
  await chooser.getByRole("button", { name: "Place marker" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: /Click inside the building footprint/ })).toBeVisible();

  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible();
  await page.waitForTimeout(1400); // Show the zoom to the selected building in the recording.
  const box = await map.boundingBox();
  if (!box) throw new Error("Map bounds unavailable");
  await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 - 110);

  const marker = page.locator(".indoor-location-marker-icon");
  await expect(marker).toHaveCount(1);
  await page.waitForTimeout(1000);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 900);
  await expect(marker).toHaveCount(0);
  await page.waitForTimeout(800);
});
