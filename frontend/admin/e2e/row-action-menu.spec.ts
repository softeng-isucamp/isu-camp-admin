import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin_justine");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

// jsdom delivers a click without the browser's capture/bubble timing, so a row menu that closes
// itself too early passes unit tests yet swallows every choice in a real browser. These run in Chromium.
test("row action menu items run their action in a real browser, by mouse and by keyboard", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Locations" }).first().click();
  const trigger = page.locator("tbody tr").first().getByRole("button", { name: /^Actions for/ });

  await trigger.click();
  await page.getByRole("menuitem", { name: "Edit location" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Location" })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.getByRole("link", { name: "admin_justine" }).first().click();
  await page.locator("table").last().locator("tbody tr").first().getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("dialog", { name: /Delete this backup/ })).toBeVisible();
});
