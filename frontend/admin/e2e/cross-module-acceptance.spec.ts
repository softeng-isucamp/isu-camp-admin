import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("USERNAME").fill("admin_justine");
  await page.getByLabel(/PASSWORD/).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("Map Editor remains usable at a narrow viewport", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/map-editor");
  await expect(page.getByRole("heading", { name: "Interactive Map Editor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview Map" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();
});

test("Locations keeps outdoor creation guidance passive", async ({ page }) => {
  await signIn(page);
  await page.goto("/locations");

  await expect(page.getByText("Manage Buildings and Indoor Locations. Create mapped campus places in Map Editor.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Building in Map Editor" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create Outdoor Point Location in Map Editor" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/\?create=/);
});

test("the removed Routes & Paths URL remains unavailable without a redirect", async ({ page }) => {
  await signIn(page);
  await page.goto("/routes");
  await expect(page).toHaveURL(/\/routes$/);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByText("Routes & Paths", { exact: true })).toHaveCount(0);
});
