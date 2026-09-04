import { expect, test } from "@playwright/test";

test("seeded administrator previews the unchanged Map Editor baseline", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  await page.goto("/login");
  await page.getByLabel("USERNAME").fill("admin_justine");
  await page.getByLabel(/PASSWORD/).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  });
  await page.goto("/map-editor");
  await expect(page.getByRole("heading", { name: "Interactive Map Editor" })).toBeVisible();

  await page.getByRole("button", { name: "Preview Map" }).click();
  await expect(page.getByRole("dialog", { name: "Preview Map" })).toContainText("No pending changes.");
  await expect(page.getByRole("dialog", { name: "Preview Map" })).not.toContainText("Associated Location does not exist.");
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("administrator filters the Walking Network browser and follows map selection", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("USERNAME").fill("admin_justine");
  await page.getByLabel(/PASSWORD/).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/map-editor");
  await expect(page.getByRole("heading", { name: "Interactive Map Editor" })).toBeVisible();

  await page.getByRole("button", { name: "Pathway" }).click();
  const browser = page.getByRole("complementary", { name: "Walking Network browser" });
  await expect(browser).toBeVisible();
  await browser.getByLabel("Search Pathways").fill("no matching pathway");
  await expect(browser.getByRole("status", { name: "Pathway results" })).toHaveText("0 Pathways");
  await browser.getByLabel("Search Pathways").fill("");

  await browser.getByRole("button", { name: "Dismiss Walking Network browser" }).click();
  await page.getByRole("button", { name: "Select" }).click();
  await page.locator(".route-node-icon").first().click();
  await page.getByRole("button", { name: /Select .* Route Node/ }).click();
  await expect(browser.getByRole("tab", { name: "Route Nodes" })).toHaveAttribute("aria-selected", "true");
  await expect(browser.getByRole("button", { pressed: true }).first()).toBeVisible();
});
