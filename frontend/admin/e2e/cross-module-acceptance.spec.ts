import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("USERNAME").fill("admin_justine");
  await page.getByLabel(/PASSWORD/).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("administrator can hand a Pathway from Routes & Paths to Map Editor", async ({ page }) => {
  await signIn(page);
  await page.goto("/routes");

  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toBeVisible();
  const pathwayName = (await firstRow.locator("strong").first().textContent())?.trim();
  expect(pathwayName).toBeTruthy();
  await firstRow.click();
  await page.getByRole("button", { name: "Open in Map Editor" }).click();

  await expect(page).toHaveURL(/\/map-editor\?pathway=/);
  await expect(page.getByText("SELECTED CONNECTION")).toBeVisible();
  await expect(page.getByRole("heading", { name: pathwayName!, exact: true })).toBeVisible();
});

test("Routes & Paths and Map Editor remain usable at a narrow viewport", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/routes");
  await expect(page.getByRole("heading", { name: "Manage Routes & Paths" })).toBeVisible();
  await expect(page.getByRole("button", { name: /add route/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /import/i })).toBeVisible();

  await page.goto("/map-editor");
  await expect(page.getByRole("heading", { name: "Interactive Map Editor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview Map" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();
});
