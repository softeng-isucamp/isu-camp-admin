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

/** The rejected digits shown in the empty boxes. */
const ghostDigits = (page: Page) =>
  Promise.all([1, 2, 3, 4, 5, 6].map((n) => page.getByLabel(`Digit ${n} of 6`).getAttribute("placeholder"))).then((values) =>
    values.map((value) => value ?? "").join(""),
  );

async function pasteWrongCode(page: Page, code: string) {
  await page.getByLabel("Digit 1 of 6").focus();
  await ctrlV(page, code);
  await expect(page.getByRole("alert")).toContainText("Incorrect code.");
}

test("a wrong code pasted with Ctrl+V shows as readable ghost digits in empty invalid boxes", async ({ page }) => {
  await reachCodeStep(page);

  await pasteWrongCode(page, "123456");

  await expect(page.getByRole("alert")).toContainText("Incorrect code. 4 attempts left.");
  expect(await boxValues(page)).toBe("");
  await expect.poll(() => ghostDigits(page)).toBe("123456");
  const first = page.getByLabel("Digit 1 of 6");
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(first).toBeFocused();
  // Browsers fade placeholders by default; the ghost digits must keep the error colour at full strength.
  const ghostStyle = await first.evaluate((el) => {
    const style = getComputedStyle(el, "::placeholder");
    return { color: style.color, opacity: style.opacity };
  });
  expect(ghostStyle).toEqual({ color: "rgb(167, 53, 53)", opacity: "1" });
});

test("a new code inserted into box 3 without keystrokes replaces everything and is checked as typed", async ({ page }) => {
  await reachCodeStep(page);
  await pasteWrongCode(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  // The path of IME composition, autofill and touch-keyboard suggestions: one input event, no key events.
  await page.getByLabel("Digit 3 of 6").click();
  await page.keyboard.insertText("365432");

  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
  await expect.poll(() => ghostDigits(page)).toBe("365432");
  expect(await boxValues(page)).toBe("");
});

test("pasting the same wrong code again, or a different one, is checked again", async ({ page }) => {
  await reachCodeStep(page);
  await pasteWrongCode(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  await ctrlV(page, "123456");
  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
  await expect.poll(() => ghostDigits(page)).toBe("123456");
  await ctrlV(page, "654321");
  await expect(page.getByRole("alert")).toContainText("2 attempts left.");
  await expect.poll(() => ghostDigits(page)).toBe("654321");
});

test("typing one digit over the ghost, even the same digit, starts a fresh entry and removes the ghost", async ({ page }) => {
  await reachCodeStep(page);
  await pasteWrongCode(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  await page.keyboard.press("1");

  expect(await boxValues(page)).toBe("1");
  expect(await ghostDigits(page)).toBe("");
  await expect(page.getByLabel("Digit 1 of 6")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Digit 2 of 6")).toBeFocused();
  await page.waitForTimeout(300);
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");
});

test("digits typed in a later box fill like fresh boxes and never join the ghost digits", async ({ page }) => {
  await reachCodeStep(page);
  await pasteWrongCode(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => ghostDigits(page)).toBe("123456");
  await page.getByLabel("Digit 3 of 6").click();
  await page.keyboard.type("6543");

  expect(await boxValues(page)).toBe("6543");
  expect(await ghostDigits(page)).toBe("");
  await page.waitForTimeout(300);
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");
});
