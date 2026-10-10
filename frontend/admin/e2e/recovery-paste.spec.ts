import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Real clipboard, real Ctrl+V and real typing in chromium, which the jsdom tests can only imitate with synthetic events.
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

const box = (page: Page, n: number) => page.getByLabel(`Digit ${n} of 6`);

/** Lets a request that should NOT have happened show up: the fixture answers within a frame or two. */
const quiet = (page: Page) => page.waitForTimeout(300);

async function pasteWrongCode(page: Page, code: string) {
  await box(page, 1).focus();
  await ctrlV(page, code);
  await expect(page.getByRole("alert")).toContainText("Incorrect code.");
}

async function expectInvalid(page: Page, invalid: boolean) {
  for (const n of [1, 2, 3, 4, 5, 6]) {
    if (invalid) await expect(box(page, n)).toHaveAttribute("aria-invalid", "true");
    else await expect(box(page, n)).not.toHaveAttribute("aria-invalid", "true");
  }
}

test("a wrong code pasted with Ctrl+V stays as real, selectable digits in invalid boxes", async ({ page }) => {
  await reachCodeStep(page);

  await pasteWrongCode(page, "123456");

  await expect(page.getByRole("alert")).toContainText("Incorrect code. 4 attempts left.");
  expect(await boxValues(page)).toBe("123456");
  await expectInvalid(page, true);
  const first = box(page, 1);
  await expect(first).toBeFocused();
  await expect(first).not.toHaveAttribute("placeholder");
  const state = await first.evaluate((el: HTMLInputElement) => ({
    selection: [el.selectionStart, el.selectionEnd],
    color: getComputedStyle(el).color,
  }));
  expect(state).toEqual({ selection: [0, 1], color: "rgb(25, 28, 29)" });
});

test("fixing a middle digit with the mouse and keyboard sends nothing until Verify is pressed", async ({ page }) => {
  await reachCodeStep(page);
  await pasteWrongCode(page, "123456");

  await box(page, 3).click();
  await page.keyboard.type("7");

  expect(await boxValues(page)).toBe("127456");
  await expectInvalid(page, false);
  await expect(box(page, 4)).toBeFocused();
  await quiet(page);
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
  expect(await boxValues(page)).toBe("127456");
});

for (const [name, retyped] of [
  ["a different code", "654321"],
  ["the rejected code again", "123456"],
] as const) {
  test(`retyping all six digits over a rejected code (${name}) sends once, on the sixth`, async ({ page }) => {
    await reachCodeStep(page);
    await pasteWrongCode(page, "123456");

    await page.keyboard.type(retyped.slice(0, 5));
    await quiet(page);
    await expect(page.getByRole("alert")).toContainText("4 attempts left.");
    expect(await boxValues(page)).toBe(retyped.slice(0, 5) + "6");
    await expect(box(page, 6)).toBeFocused();

    await page.keyboard.type(retyped[5]);

    await expect(page.getByRole("alert")).toContainText("3 attempts left.");
    await quiet(page);
    await expect(page.getByRole("alert")).toContainText("3 attempts left.");
    expect(await boxValues(page)).toBe(retyped);
  });
}

test("digits delivered by insertText, with no key events, edit and submit like typed ones, even the same digit", async ({ page }) => {
  await reachCodeStep(page);
  await pasteWrongCode(page, "123456");

  // The path of touch keyboards and IMEs: one input event per digit. Each digit equals the one it replaces.
  for (const digit of "12345") await page.keyboard.insertText(digit);
  await quiet(page);
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");
  await expectInvalid(page, false);
  await expect(box(page, 6)).toBeFocused();

  await page.keyboard.insertText("6");
  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
  await quiet(page);
  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
  expect(await boxValues(page)).toBe("123456");

  // A different code inserted whole into one box is a paste.
  await box(page, 3).click();
  await page.keyboard.insertText("654321");
  await expect(page.getByRole("alert")).toContainText("2 attempts left.");
  expect(await boxValues(page)).toBe("654321");
});

test("pasting the same rejected code again, or a different one, is checked again", async ({ page }) => {
  await reachCodeStep(page);
  await pasteWrongCode(page, "123456");
  await expect(page.getByRole("alert")).toContainText("4 attempts left.");

  await ctrlV(page, "123456");
  await expect(page.getByRole("alert")).toContainText("3 attempts left.");
  expect(await boxValues(page)).toBe("123456");
  await ctrlV(page, "654321");
  await expect(page.getByRole("alert")).toContainText("2 attempts left.");
  expect(await boxValues(page)).toBe("654321");
  await expectInvalid(page, true);
});
