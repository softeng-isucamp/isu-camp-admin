import { expect, test } from "@playwright/test";

test("seeded administrator previews the unchanged Map Editor baseline", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  await page.goto("/login");
  await page.getByLabel("USERNAME").fill("admin01");
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
