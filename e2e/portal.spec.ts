import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
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
  await page.getByLabel("NEW PASSWORD").fill("password123");
  await page.getByRole("button", { name: /save password/i }).click();
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
  await expect(page).toHaveScreenshot("location-add-dialog.png", {
    animations: "disabled",
    maxDiffPixels: 200,
  });
  await page
    .getByPlaceholder(/student innovation center/i)
    .fill("Test Facility");
  await page.getByRole("button", { name: /save location/i }).click();
  await expect(page.getByRole("status")).toContainText("saved successfully");
  await expect(
    page.getByRole("heading", { name: "Location Added" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-added-success.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByTitle("Edit location").first().click();
  await expect(
    page.getByRole("heading", { name: "Edit Location" }),
  ).toBeVisible();
  await page.locator(".modal input").first().fill("Test Facility Updated");
  await page.getByRole("button", { name: /save location/i }).click();
  await expect(
    page.getByRole("heading", { name: "Location Updated" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-edit-success.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByTitle("View location history").first().click();
  await expect(
    page.getByRole("heading", { name: "Location History" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page
    .getByRole("button", { name: /import json/i })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Import Locations JSON" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-import-dialog.png", {
    animations: "disabled",
  });
  await page.locator(".json-input").fill("{bad");
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Invalid JSON file.")).toBeVisible();
  await expect(page).toHaveScreenshot("location-import-invalid.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", { name: /import json/i })
    .first()
    .click();
  await page
    .locator(".json-input")
    .fill(
      '{"id":"loc-imported","name":"Imported Facility","code":"IMP-01","type":"Facility","parentId":null,"status":"Active","lat":16.72,"lng":121.69}',
    );
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(
    page.getByText(/Validation passed for 1 locations/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Locations Imported" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("location-import-success.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByTitle("Locate on map").first().click();
  await expect(page).toHaveURL(/\/map-editor\?location=/);
  await expect(page.getByText("SELECTED LOCATION")).toBeVisible();
  await expect(page).toHaveScreenshot("location-locate-on-map.png", {
    animations: "disabled",
  });

  await page.goto("/locations?mockFailure=locationSave");
  await page.getByRole("button", { name: /add location/i }).click();
  await page
    .getByPlaceholder(/student innovation center/i)
    .fill("Failed Facility");
  await page.getByRole("button", { name: /save location/i }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Mock locationSave failed",
  );
  await expect(page).toHaveScreenshot("location-save-failure.png", {
    animations: "disabled",
    maxDiffPixels: 200,
  });

  await page.goto("/routes");
  await expect(page.getByLabel("Route geometry preview")).toBeVisible();
  await page.getByRole("button", { name: /add route/i }).click();
  await expect(
    page.getByRole("heading", { name: "Add Route / Path" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("route-add-dialog.png", {
    animations: "disabled",
  });
  await page.locator(".modal input").first().fill("Test Walkway");
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("status")).toContainText("saved successfully");
  await expect(
    page.getByRole("heading", { name: "Route Saved" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("route-save-success.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByTitle("Delete route").first().click();
  await expect(
    page.getByRole("heading", { name: "Delete Route?" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("route-delete-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", { name: /import/i })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Import Routes JSON" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("route-import-dialog.png", {
    animations: "disabled",
  });
  await page
    .locator(".json-input")
    .fill(
      '{"id":"bad-route","name":"Broken","sourceNodeId":"missing","destinationNodeId":"missing","pathPoints":[]}',
    );
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText(/node reference not found/i)).toBeVisible();
  await expect(page).toHaveScreenshot("route-import-invalid-reference.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", { name: /import/i })
    .first()
    .click();
  await page
    .locator(".json-input")
    .fill(
      '{"id":"route-imported","name":"Imported Walkway","sourceNodeId":"ccsict-entry","destinationNodeId":"junction-a","pathPoints":[]}',
    );
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText(/Validation passed for 1 routes/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Routes Imported" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("route-import-success.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Done" }).click();

  await page.goto("/routes?mockFailure=routeSave");
  await page.getByRole("button", { name: /add route/i }).click();
  await page.locator(".modal input").first().fill("Failed Walkway");
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Mock routeSave failed",
  );
  await expect(page).toHaveScreenshot("route-save-failure.png", {
    animations: "disabled",
    maxDiffPixels: 200,
  });

  await page.goto("/users?mockFailure=userUpdate");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Mock userUpdate failed",
  );
  await expect(page).toHaveScreenshot("user-save-failure.png", {
    animations: "disabled",
    maxDiffPixels: 200,
  });

  await page.goto("/users");
  await page.getByRole("button", { name: /add user/i }).click();
  await expect(page.getByRole("heading", { name: "Add User" })).toBeVisible();
  await expect(page).toHaveScreenshot("user-add-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit User" })).toBeVisible();
  await expect(page).toHaveScreenshot("user-edit-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByRole("status")).toContainText("User updated");
  await page.getByRole("button", { name: "View History" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Audit History" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("user-audit-history-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Reset Password" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Reset Password?" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("user-reset-password-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Remove User?" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("user-remove-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/system-logs");
  await page.getByRole("button", { name: "Admin Activity" }).click();
  await expect(page.getByText("Admin activity").first()).toBeVisible();
  await page.getByRole("button", { name: "View Details" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Log Details" }),
  ).toBeVisible();
  await expect(page.getByText("Administrator detail")).toBeVisible();
  await expect(page).toHaveScreenshot("log-details-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "User Activity" }).click();
  await page.getByRole("button", { name: "View Details" }).first().click();
  await expect(page.getByText("User activity detail")).toBeVisible();
  await expect(page).toHaveScreenshot("log-user-details-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Admin Activity" }).click();
  await page.getByLabel("ACTOR").selectOption("admin01");
  await page.getByLabel("DATE").selectOption("Aug 17, 2026");
  await expect(page).toHaveScreenshot("system-logs-date-filter.png", {
    animations: "disabled",
  });
  await page.getByLabel("ACTOR").selectOption("All Actors");
  await page.getByLabel("DATE").selectOption("All Dates");
  await page.getByRole("button", { name: "All Logs" }).click();
  await page.getByRole("button", { name: "2" }).click();
  await expect(page.getByText("Showing 21–25 of 25")).toBeVisible();
  await expect(page).toHaveScreenshot("system-logs-page-2.png", {
    animations: "disabled",
  });

  await page.goto("/map-editor");
  await page
    .locator(".leaflet-overlay-pane path")
    .first()
    .dispatchEvent("click");
  await expect(page.getByText("SELECTED AREA")).toBeVisible();
  await expect(page).toHaveScreenshot("map-selected-area.png", {
    animations: "disabled",
  });
  await page.getByPlaceholder("Search campus places...").fill("Computer Lab");
  await expect(
    page.getByRole("button", { name: /Computer Lab 1/ }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("map-search-results.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: /Computer Lab 1/ }).click();
  await expect(page.getByText("SELECTED LOCATION")).toBeVisible();
  await expect(page).toHaveScreenshot("map-selected-location.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Move Marker" }).click();
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 390, y: 235 } });
  await expect(page.getByText(/Preview position:/)).toBeVisible();
  await expect(page).toHaveScreenshot("map-move-marker-preview.png", {
    animations: "disabled",
  });
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
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 470, y: 250 } });
  await expect(page.getByText(/Preview position:/)).toBeVisible();
  await expect(page).toHaveScreenshot("map-move-node-preview.png", {
    animations: "disabled",
  });
  await page.goto("/map-editor");
  await page
    .getByPlaceholder("Search campus places...")
    .fill("CCSICT Entrance");
  await page
    .getByRole("button", { name: /CCSICT Entrance.*Walkway Junction A/ })
    .click();
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
  await page.getByPlaceholder("Search campus places...").fill("Computer Lab");
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
});
