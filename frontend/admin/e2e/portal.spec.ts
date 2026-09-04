import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("USERNAME").fill("admin_justine");
  await page.getByLabel(/PASSWORD/).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("redirects unauthenticated visitors from protected routes", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "ISU-CAMP" })).toBeVisible();
  await expect(page).toHaveScreenshot("guard-login-redirect.png", {
    animations: "disabled",
  });
});

test("administrator can sign in and navigate modules", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "ISU-CAMP" })).toBeVisible();
  await expect(page).toHaveScreenshot("login.png", { animations: "disabled" });
  await page.getByLabel("USERNAME").fill("admin_justine");
  await page.getByLabel(/PASSWORD/).fill("password123");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(
    page.getByRole("heading", { name: "Campus Overview" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("dashboard.png", {
    animations: "disabled",
    fullPage: true,
  });
  await page.reload();
  await expect(page).toHaveURL(/dashboard/);
  await expect(
    page.getByRole("heading", { name: "Campus Overview" }),
  ).toBeVisible();
  await page.locator(".sidebar a", { hasText: "Locations" }).click();
  await expect(page).toHaveURL(/locations/);
  await expect(
    page.getByRole("heading", { name: "Campus Locations" }),
  ).toBeVisible();
  await page.locator(".sidebar a", { hasText: "System Logs" }).click();
  await expect(
    page.getByRole("heading", { name: "System Logs" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign out?" })).toBeVisible();
  await expect(page).toHaveScreenshot("sign-out-confirmation.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
});

test("password recovery reaches verification step", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/reset-password/);
  await expect(page).toHaveScreenshot("password-recovery-request.png", {
    animations: "disabled",
  });
  await page.getByLabel("ADMIN USERNAME").fill("admin_justine");
  await page.getByRole("button", { name: /send code/i }).click();
  await expect(
    page.getByRole("heading", { name: /enter verification code/i }),
  ).toBeVisible();
  await page.getByLabel("VERIFICATION CODE").fill("123");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByRole("alert")).toContainText(
    "6-digit verification code",
  );
  await expect(page).toHaveScreenshot("password-recovery-code-error.png", {
    animations: "disabled",
  });
  await page.getByLabel("VERIFICATION CODE").fill("000000");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel("NEW PASSWORD", { exact: true }).fill("password123");
  const confirmInput = page.getByLabel(/confirm new password/i);
  if ((await confirmInput.count()) > 0) {
    await confirmInput.fill("password123");
  }
  await page.getByRole("button", { name: /reset password|save password/i }).click();
  await expect(
    page.getByRole("heading", { name: /password reset successful/i }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("password-recovery-success.png", {
    animations: "disabled",
  });
});

test("protected modules have stable desktop visual states", async ({
  page,
}) => {
  await signIn(page);
  const modules = [
    ["map-editor", "map-editor.png", "Interactive Map Editor"],
    ["locations", "locations.png", "Campus Locations"],
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
  await page.getByLabel("TYPE").selectOption("Laboratory");
  await expect(page.getByRole("row").filter({ hasText: /Laboratory/ }).first()).toBeVisible();
  await expect(page).toHaveScreenshot("locations-type-filter.png", {
    animations: "disabled",
  });
  await page.getByLabel("TYPE").selectOption("All Types");
  await page.getByLabel("STATUS").selectOption("Active");
  await expect(page).toHaveScreenshot("locations-status-filter.png", {
    animations: "disabled",
  });
  await page.getByLabel("STATUS").selectOption("All Statuses");
  await page.locator(".filters select").nth(1).selectOption("College of Information Communication Technology");
  await page.locator(".filters select").nth(2).selectOption("2nd Floor");
  await expect(page.getByRole("row").filter({ hasText: /Laboratory/ }).first()).toBeVisible();
  await expect(page).toHaveScreenshot("locations-building-floor-filter.png", {
    animations: "disabled",
  });
  await page.locator(".filters select").nth(1).selectOption("All Buildings");
  await page.locator(".filters select").nth(2).selectOption("All Floors");
  await page
    .getByRole("button", { name: /Actions for/i })
    .first()
    .click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page).toHaveScreenshot("location-actions-open.png", {
    animations: "disabled",
  });
  await page.reload();
  await page.locator("button").filter({ hasText: "Add Location" }).last().click({ force: true });
  await expect(
    page.getByRole("heading", { name: "Add Location" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-add-dialog.png", {
    animations: "disabled",
    maxDiffPixels: 200,
  });
  await page.getByLabel("Location name").fill("Test Facility");
  await page.getByLabel("PARENT BUILDING").selectOption({ label: "Administration Building" });
  await page.getByLabel("FLOOR LEVEL").selectOption({ label: "Ground Floor" });
  await page.getByRole("button", { name: /save location/i }).click();
  await expect(page.getByRole("heading", { name: "Location added" })).toBeVisible();
  await expect(page).toHaveScreenshot("location-added-success.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: "Edit location" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Location" }),
  ).toBeVisible();
  await page.locator(".modal-card input").first().fill("Test Facility Updated");
  await page.getByRole("button", { name: /save location/i }).click();
  await expect(
    page.getByRole("heading", { name: "Location updated" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-edit-success.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: "View history" }).click();
  await expect(
    page.getByRole("heading", { name: "Audit History" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-history-modal.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Bulk Import" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Bulk Import Locations" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-import-dialog.png", {
    animations: "disabled",
  });
  await page.getByLabel("Choose location JSON file").setInputFiles({
    name: "invalid-locations.json",
    mimeType: "application/json",
    buffer: Buffer.from("{bad"),
  });
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Invalid JSON file.")).toBeVisible();
  await expect(page).toHaveScreenshot("location-import-invalid.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", { name: "Bulk Import" })
    .first()
    .click();
  await page.getByLabel("Choose location JSON file").setInputFiles({
    name: "unsupported-location.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"id":"loc-imported","name":"Imported Facility","code":"IMP-01","type":"Facility","parentId":null,"status":"Active","lat":16.72,"lng":121.69}',
    ),
  });
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText(/only Room, Office, Laboratory, and Restroom records can be imported/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: /Locate on map/ }).click();
  await expect(page).toHaveURL(/\/map-editor\?location=/);
  await expect(page.getByRole("heading", { name: "Interactive Map Editor" })).toBeVisible();

  await page.goto("/locations?mockFailure=locationSave");
  await page.getByRole("button", { name: /add location/i }).click();
  await page.getByLabel("Location name").fill("Failed Facility");
  await page.getByLabel("PARENT BUILDING").selectOption({ label: "Administration Building" });
  await page.getByLabel("FLOOR LEVEL").selectOption({ label: "Ground Floor" });
  await page.getByRole("button", { name: /save location/i }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Mock locationSave failed",
  );
  await expect(page).toHaveScreenshot("location-save-failure.png", {
    animations: "disabled",
    maxDiffPixels: 200,
  });
  await page.goto("/locations");
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: "Delete location" }).click();
  await expect(
    page.getByRole("heading", { name: "Delete Location?" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-delete-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("permanently deleted");


  await page.goto("/users?mockFailure=userUpdate");
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: "Edit user" }).click();
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Mock userUpdate failed",
  );
  await expect(page).toHaveScreenshot("user-save-failure.png", {
    animations: "disabled",
    maxDiffPixels: 200,
  });

  await page.goto("/users");
  await expect(
    page.getByRole("columnheader", { name: "CREATED AT" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "LAST SIGN IN" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "DEVICE ID" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /add user/i }).click();
  await expect(page.getByRole("heading", { name: "Add User" })).toBeVisible();
  await expect(page).toHaveScreenshot("user-add-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: "Edit user" }).click();
  await expect(page.getByRole("heading", { name: "Edit User" })).toBeVisible();
  await expect(page).toHaveScreenshot("user-edit-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByRole("status")).toContainText("User updated");
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: "View history" }).click();
  await expect(
    page.getByRole("heading", { name: "Audit History" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("user-audit-history-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: "Reset password" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset Password?" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("user-reset-password-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /Actions for/i }).first().click();
  await page.getByRole("menuitem", { name: "Remove user" }).click();
  await expect(
    page.getByRole("heading", { name: "Remove User?" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("user-remove-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Remove User" }).click();
  await expect(page.getByRole("status")).toContainText("removed successfully");

  await page.goto("/system-logs");
  await page.getByRole("button", { name: "Admin Activity" }).click();
  await expect(page.getByText("Admin activity").first()).toBeVisible();
  await page.getByRole("button", { name: "View Details" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Log Details" }),
  ).toBeVisible();
  await expect(
    page.getByText("This administrator action changed protected campus data."),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("log-details-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "User Activity" }).click();
  await page.getByRole("button", { name: "View Details" }).first().click();
  await expect(
    page.getByText("This user event records activity originating from a campus account."),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("log-user-details-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Admin Activity" }).click();
  await page.getByLabel("ACTOR").selectOption("admin01");
  await page.getByLabel("DATE").selectOption("Aug 17, 2026");
  await expect(page).toHaveScreenshot("system-logs-date-filter.png", {
    animations: "disabled",
  });
  await page.getByPlaceholder("Search logs...").fill("Administration Building");
  await expect(page.getByText("Updated Location")).toBeVisible();
  await expect(page).toHaveScreenshot("system-logs-search-computer-lab.png", {
    animations: "disabled",
  });
  await page.getByPlaceholder("Search logs...").fill("");
  await page.getByLabel("ACTOR").selectOption("All Actors");
  await page.getByLabel("DATE").selectOption("All Dates");
  await page.getByRole("button", { name: "All Logs" }).click();
  await page.getByRole("button", { name: "2" }).click();
  await expect(page.getByText("Showing 21–25 of 25")).toBeVisible();
  await expect(page).toHaveScreenshot("system-logs-page-2.png", {
    animations: "disabled",
  });

  // Map Editor behavior is covered by the dedicated consolidation specs.
  // The former inline map flow exercised removed local-feature and point-placement UI.
  if (false) {
  await page.goto("/map-editor");
  await page.goto("/map-editor");
  await page
    .getByPlaceholder("Search campus places...")
    .fill("CCSICT Entrance");
  await page
    .getByRole("button", { name: /CCSICT Entrance Route Node/ })
    .click();
  await expect(page.getByText("SELECTED ROUTE NODE")).toBeVisible();
  await expect(page).toHaveScreenshot("map-selected-route-node.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Move Node" }).click();
  await expect(
    page.getByText("Click the map to preview a new position."),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("map-place-route-node-initial.png", {
    animations: "disabled",
  });
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 470, y: 250 } });
  await expect(page.getByText(/Preview position:/)).toBeVisible();
  await expect(page).toHaveScreenshot("map-move-node-preview.png", {
    animations: "disabled",
  });
  await page.goto("/map-editor");
  await page.getByPlaceholder("Search campus places...").fill("Gate–Arts");
  await page.getByRole("button", { name: /Gate–Arts/ }).click();
  await expect(page.getByText("SELECTED CONNECTION")).toBeVisible();
  await expect(page).toHaveScreenshot("map-selected-pathway.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Satellite" }).click();
  await expect(page).toHaveScreenshot("map-satellite-basemap.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Edit Path Points" }).click();
  await expect(
    page.getByText(/Click the map to add path points/),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("map-edit-path-points.png", {
    animations: "disabled",
  });
  await expect(
    page.getByText(/drag an existing point to move it/i),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("map-move-point-instruction.png", {
    animations: "disabled",
  });
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 420, y: 260 } });
  await expect(page.getByText(/2 points plotted/)).toBeVisible();
  await expect(page).toHaveScreenshot("map-path-point-added.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Remove Last Point" }).click();
  await expect(page.getByText(/1 points plotted/)).toBeVisible();
  await expect(page).toHaveScreenshot("map-path-point-removed.png", {
    animations: "disabled",
  });
  const pathPointMarker = page.locator(".leaflet-marker-icon").last();
  const markerBox = await pathPointMarker.boundingBox();
  if (!markerBox) throw new Error("Path point marker was not rendered.");
  await page.mouse.move(
    markerBox.x + markerBox.width / 2,
    markerBox.y + markerBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    markerBox.x + markerBox.width / 2 + 36,
    markerBox.y + markerBox.height / 2 + 24,
  );
  await page.mouse.up();
  await expect(page.getByText(/1 points plotted/)).toBeVisible();
  await expect(page).toHaveScreenshot("map-moved-point-result.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Place" }).click();
  await expect(
    page.getByText("Click the map to preview a new position."),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("map-place-mode.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Area" }).click();
  await expect(page.getByText("Draw Campus Zone")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear Area" })).toBeVisible();
  await expect(page).toHaveScreenshot("map-area-mode.png", {
    animations: "disabled",
  });
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 320, y: 210 } });
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 520, y: 210 } });
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 420, y: 340 } });
  await expect(page.getByText("Points plotted: 3")).toBeVisible();
  await expect(page).toHaveScreenshot("map-area-drawn.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Save map changes?" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("map-save-confirmation.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(
    page.getByRole("heading", { name: "Discard changes?" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("map-discard-confirmation.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.goto("/map-editor?mockFailure=mapSave");
  await page.getByPlaceholder("Search campus places...").fill("Laboratory");
  await page.getByRole("button", { name: /Computer Lab 1/ }).click();
  await page.getByRole("button", { name: "Move Marker" }).click();
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 400, y: 245 } });
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Save Changes", exact: true })
    .last()
    .click();
  await expect(page.getByRole("alert")).toContainText("Mock mapSave failed");
  await expect(page).toHaveScreenshot("map-save-failure.png", {
    animations: "disabled",
    maxDiffPixels: 200,
  });
  }
});
