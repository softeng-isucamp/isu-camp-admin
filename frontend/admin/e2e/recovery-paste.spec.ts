import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Real clipboard and real Ctrl+V in chromium, which the jsdom tests can only imitate with synthetic events.
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

async function reachCodeStep(page: Page) {
  await page.goto("/forgot-password");
  await page.getByLabel("Admin email").fill("admin@isu.edu.ph");
  await page.getByRole("button", { name: /send code/i }).click();
  await expect(page.getByRole("heading", { name: /enter verification code/i })).toBeVisible();
}

async function ctrlV(page: Page, text: string) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("Control+V");
}

const boxValues = (page: Page) =>
  Promise.all([1, 2, 3, 4, 5, 6].map((n) => page.getByLabel(`Digit ${n} of 6`).inputValue())).then((values) => values.join(""));

test("a wrong code pasted with Ctrl+V stays visible and invalid next to the error", async ({ page }) => {
  await reachCodeStep(page);
  await page.getByLabel("Digit 1 of 6").focus();

  await ctrlV(page, "123456");

  await expect(page.getByRole("alert")).toContainText("Incorrect code. 4 attempts left.");
  expect(await boxValues(page)).toBe("123456");
  await expect(page.getByLabel("Digit 1 of 6")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Digit 1 of 6")).toBeFocused();
});

test("pasting the same wrong code again, or a different one, is checked again", async ({ page }) => {
  await reachCodeStep(page);
  await page.getByLabel("Digit 1 of 6").focus();

  await ctrlV(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");
  await ctrlV(page, "123456");
  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
  await ctrlV(page, "654321");
  await expect(page.getByRole("alert")).toContainText("2 attempts left.");
});

test("typing one digit over a rejected code starts over instead of submitting a mixed code", async ({ page }) => {
  await reachCodeStep(page);
  await page.getByLabel("Digit 1 of 6").focus();
  await ctrlV(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  await page.keyboard.press("7");

  expect(await boxValues(page)).toBe("7");
  await expect(page.getByLabel("Digit 1 of 6")).not.toHaveAttribute("aria-invalid", "true");
  await page.waitForTimeout(300);
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");
});

test("a digit typed after only moving the caret, or in a later box, never joins the rejected digits", async ({ page }) => {
  await reachCodeStep(page);
  await page.getByLabel("Digit 1 of 6").focus();
  await ctrlV(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => boxValues(page)).toBe("123456");
  await page.keyboard.press("7");
  expect(await boxValues(page)).toBe("7");

  // A second rejection, then a whole code typed starting from the middle of the row.
  await page.getByLabel("Digit 1 of 6").focus();
  await ctrlV(page, "123456");
  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
  await page.getByLabel("Digit 3 of 6").click();
  await page.keyboard.type("6543");

  expect(await boxValues(page)).toBe("6543");
  await page.waitForTimeout(300);
  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
});

test("typing the same first digit over a rejected code starts over", async ({ page }) => {
  await reachCodeStep(page);
  await page.getByLabel("Digit 1 of 6").focus();
  await ctrlV(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  await page.keyboard.press("1");

  expect(await boxValues(page)).toBe("1");
  await expect(page.getByLabel("Digit 1 of 6")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Digit 2 of 6")).toBeFocused();
});
