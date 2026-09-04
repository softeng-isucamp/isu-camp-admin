import { expect, test, type Page } from "@playwright/test";

type LocationDto = {
  id: string; name: string; code: string; type: string; parentId: string | null;
  status: "Active"; lat: number | null; lng: number | null; positioned: boolean;
  building?: string; floor?: string; function?: string;
};

async function authenticate(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, admin: { id: "1", username: "admin" } }),
  }));
}

test("real-mode location creation survives a directory reload", async ({ page }) => {
  await authenticate(page);
  const records: LocationDto[] = [
    { id: "building-1", name: "Campus Building", code: "BLDG-1", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false },
    ...Array.from({ length: 11 }, (_, index) => ({
      id: String(index + 1), name: `Campus Room ${index + 1}`, code: `ROOM-${index + 1}`,
      type: "Room", parentId: "building-1", building: "Campus Building", floor: "Ground Floor", status: "Active" as const, lat: null, lng: null, positioned: false,
    })),
  ];
  await page.route("**/api/locations**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      const draft = request.postDataJSON();
      const created = { ...draft, id: "99", status: "Active", lat: null, lng: null, positioned: false } as LocationDto;
      records.push(created);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
      return;
    }
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
    const filtered = records.filter((record) => !q || `${record.name} ${record.code}`.toLowerCase().includes(q));
    const start = (pageNumber - 1) * pageSize;
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: filtered.slice(start, start + pageSize), total: filtered.length, page: pageNumber, pageSize }),
    });
  });

  await page.goto("/locations");
  await page.getByRole("button", { name: /add location/i }).click();
  const dialog = page.getByRole("dialog", { name: "Add Location" });
  await dialog.getByLabel("TYPE").selectOption("Room");
  await dialog.getByLabel("PARENT BUILDING").selectOption("building-1");
  await dialog.getByLabel("FLOOR LEVEL").selectOption("Ground Floor");
  await dialog.getByLabel("Location name").fill("Reloaded Room");
  await dialog.getByLabel("Location code").fill("RELOADED-ROOM");
  await dialog.getByLabel("DESCRIPTION").fill("Fixture-backed reload check");
  await dialog.getByRole("button", { name: /save location/i }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await page.reload();
  await page.getByLabel("Search locations").fill("Reloaded Room");
  await expect(page.getByText("Reloaded Room")).toBeVisible();
});

test("real mode exposes malformed backend data as a visible failure", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/locations**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [{ id: "7", name: "Broken", code: "BAD", type: "Facility", lat: "north", lng: 121.69, positioned: true }], total: 1, page: 1, pageSize: 20 }),
  }));

  await page.goto("/locations");
  await expect(page.getByText(/Unable to load campus locations/)).toContainText("malformed location coordinates");
  await expect(page.getByText("No campus location records have been created yet.")).toHaveCount(0);
});
