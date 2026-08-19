import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("administrator can sign in and navigate modules", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "ISU-CAMP" })).toBeVisible();
  await expect(page).toHaveScreenshot("login.png", { animations: "disabled" });
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(
    page.getByRole("heading", { name: "Campus Overview" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("dashboard.png", {
    animations: "disabled",
  });
  await page.locator(".sidebar a", { hasText: "Locations" }).click();
  await expect(page).toHaveURL(/locations/);
  await expect(
    page.getByRole("heading", { name: "Campus Locations" }),
  ).toBeVisible();
  await page.locator(".sidebar a", { hasText: "System Logs" }).click();
  await expect(
    page.getByRole("heading", { name: "System Logs" }),
  ).toBeVisible();
});

test("password recovery reaches verification step", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/reset-password/);
  await page.getByRole("button", { name: /send code/i }).click();
  await expect(
    page.getByRole("heading", { name: /enter verification code/i }),
  ).toBeVisible();
});

test("protected modules have stable desktop visual states", async ({
  page,
}) => {
  await signIn(page);
  const modules = [
    ["map-editor", "map-editor.png", "MAP EDITOR"],
    ["locations", "locations.png", "Campus Locations"],
    ["routes", "routes.png", "Routes & Paths"],
    ["users", "users.png", "User Management"],
    ["system-logs", "system-logs.png", "System Logs"],
  ] as const;
  for (const [path, snapshot, heading] of modules) {
    await page.goto(`/${path}`);
    await expect(
      page.getByText(heading, { exact: true }).first(),
    ).toBeVisible();
    await expect(page).toHaveScreenshot(snapshot, { animations: "disabled" });
  }
});

test("locations, users, logs, and map expose their key state transitions", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/locations");
  await page.getByRole("button", { name: /add location/i }).click();
  await expect(
    page.getByRole("heading", { name: "Add Location" }),
  ).toBeVisible();
  await page
    .getByPlaceholder(/student innovation center/i)
    .fill("Test Facility");
  await page.getByRole("button", { name: /save location/i }).click();
  await expect(page.getByRole("status")).toContainText("saved successfully");
  await page.getByTitle("View location history").first().click();
  await expect(
    page.getByRole("heading", { name: "Location History" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/routes");
  await page.getByRole("button", { name: /add route/i }).click();
  await expect(
    page.getByRole("heading", { name: "Add Route / Path" }),
  ).toBeVisible();
  await page.locator(".modal input").first().fill("Test Walkway");
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("status")).toContainText("saved successfully");

  await page.goto("/users");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit User" })).toBeVisible();
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByRole("status")).toContainText("User updated");
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Remove User?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/system-logs");
  await page.getByRole("button", { name: "Admin Activity" }).click();
  await expect(page.getByText("Admin activity").first()).toBeVisible();
  await page.getByRole("button", { name: "View Details" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Log Details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("ACTOR").selectOption("admin01");

  await page.goto("/map-editor");
  await page.getByRole("button", { name: "Place" }).click();
  await expect(
    page.getByText("Click the map to preview a new position."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Area" }).click();
  await expect(page.getByText("Draw Campus Zone")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear Area" })).toBeVisible();
});
