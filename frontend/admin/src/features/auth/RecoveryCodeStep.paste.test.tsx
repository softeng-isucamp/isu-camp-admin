import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";
import { Login } from "./AuthPages";
import { issued, jsonResponse, mockBackend, settle, verified, wrongCode } from "./testing/recoveryFetch";

const EMAIL = "admin@isu.edu.ph";
const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";
const RATE_LIMITED = () => jsonResponse({ message: "Too many requests." }, 429, { "Retry-After": "2" });

const renderForgotPassword = () =>
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <AuthProvider>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const sendCode = async () => {
  fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByRole("heading", { name: /verification code/i });
};

const positions = [1, 2, 3, 4, 5, 6];
const box = (position: number) => screen.getByLabelText(`Digit ${position} of 6`);
const boxValues = () => positions.map((n) => (box(n) as HTMLInputElement).value).join("");
const expectAllInvalid = () => positions.forEach((n) => expect(box(n)).toBeInvalid());
const expectNoneInvalid = () => positions.forEach((n) => expect(box(n)).toBeValid());
const sentCodes = (sent: Record<string, unknown[]>) => (sent[VERIFY] ?? []).map((body) => (body as { code: string }).code);

/** Pastes into box 1 with real clipboard events and waits for the reply to land. */
const pasteIntoFirstBox = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.click(box(1));
  await user.paste(text);
  await settle();
};

const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.change(box(i + 1), { target: { value: digit } }));
const pasteCode = (position: number, text: string) => fireEvent.paste(box(position), { clipboardData: { getData: () => text } });
const tickSecond = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("code step: a rejected code stays on screen", () => {
  it("keeps the pasted digits visible and marked invalid next to the error, with focus back in box 1", async () => {
    const user = userEvent.setup();
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4)] });
    renderForgotPassword();
    await sendCode();
    expectNoneInvalid();

    await pasteIntoFirstBox(user, "123456");

    expect(screen.getByRole("alert")).toHaveTextContent(/^Incorrect code\. 4 attempts left\.$/);
    expect(boxValues()).toBe("123456");
    expectAllInvalid();
    expect(box(1)).toHaveFocus();
  });

  it("restarts from box 1 when one digit is typed over the rejected code, and sends nothing", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "123456");

    await user.keyboard("7");
    await settle();

    expect(boxValues()).toBe("7");
    expect(box(2)).toHaveFocus();
    expectNoneInvalid();
    expect(sentCodes(sent)).toEqual(["123456"]);
  });

  it("submits only the new digits when a whole new code is typed over the rejected one", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "123456");

    await user.keyboard("654321");
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", "654321"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 3 attempts left.");
  });

  it.each(["Backspace", "Delete"])("empties every box when %s is pressed over the rejected code, and sends nothing", async (key) => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "123456");

    await user.keyboard(`{${key}}`);
    await settle();

    expect(boxValues()).toBe("");
    expect(box(1)).toHaveFocus();
    expectNoneInvalid();
    expect(sentCodes(sent)).toEqual(["123456"]);
  });

  it("checks the same code again when it is pasted again, and answers with the new attempt count", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "123456");

    await pasteIntoFirstBox(user, "123456");

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 3 attempts left.");
    expect(boxValues()).toBe("123456");
    expectAllInvalid();
  });

  it("checks the same code again when it is typed again after clearing it", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "123456");

    await user.keyboard("{Backspace}123456");
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
  });

  it("checks a different pasted code, even when the paste starts in a later box or has separators", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3), wrongCode(2)] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "111111");

    await pasteIntoFirstBox(user, "222-222");
    await user.click(box(4));
    await user.paste("333 333");
    await settle();

    expect(sentCodes(sent)).toEqual(["111111", "222222", "333333"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 2 attempts left.");
  });

  it("lets Verify check the rejected digits again as an explicit retry", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "123456");

    await user.click(screen.getByRole("button", { name: "Verify" }));
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 3 attempts left.");
  });

  it("sends nothing on its own after a rejection: not on blur, refocus or the passing of time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
    pasteCode(1, "123456");
    await settle();
    expect(sentCodes(sent)).toEqual(["123456"]);

    fireEvent.blur(box(1));
    fireEvent.focus(box(4));
    fireEvent.blur(box(4));
    fireEvent.focus(box(1));
    await tickSecond();
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(boxValues()).toBe("123456");
  });

  it("sends nothing for the old digits on a resend; the boxes come back empty and ready", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sent } = mockBackend({
      [REQUEST]: [issued({ resendAfterSeconds: 1 }), issued()],
      [VERIFY]: [wrongCode(4), wrongCode(3)],
    });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
    pasteCode(1, "123456");
    await settle();
    await tickSecond();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    await tickSecond();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(boxValues()).toBe("");
    expectNoneInvalid();
    expect(box(1)).toHaveFocus();

    // The new code starts fresh, so the same digits are checked against it.
    pasteCode(1, "123456");
    await settle();
    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
  });

  it("sends a code pasted without a click after a rejection, because focus is already in box 1", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), verified()] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "111111");

    await user.paste("222222");
    await settle();

    expect(sentCodes(sent)).toEqual(["111111", "222222"]);
  });
});

describe("code step: a code entered during a rate-limit wait", () => {
  const openCodeStep = async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
  };

  it("is submitted once, automatically, when the wait ends", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "111111");
    await settle();
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();

    // Replace the rate-limited code with a new one while the wait runs.
    pasteCode(1, "222222");
    await settle();
    expect(sentCodes(sent)).toEqual(["111111"]);
    await tickSecond();
    expect(sentCodes(sent)).toEqual(["111111"]);
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["111111", "222222"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 4 attempts left.");

    await tickSecond();
    await tickSecond();
    expect(sentCodes(sent)).toHaveLength(2);
  });

  it("submits the code that was itself rate limited when the wait ends", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), verified()] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();
    await tickSecond();
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
  });

  it("is not submitted by a wait that ends with an incomplete code in the boxes", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();
    fireEvent.keyDown(box(6), { key: "Backspace" });
    fireEvent.change(box(6), { target: { value: "" } });

    await tickSecond();
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });

  it("never submits rejected digits when the wait ends, but Verify still can", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), RATE_LIMITED(), wrongCode(3)] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();
    expectAllInvalid();

    // Verify on the rejected digits runs into a rate limit; the digits are still the rejected ones.
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await settle();
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();
    await tickSecond();
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
    expectAllInvalid();

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await settle();
    expect(sentCodes(sent)).toEqual(["123456", "123456", "123456"]);
  });

  it("fills the boxes from a retyped code and still submits it when the wait ends", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), RATE_LIMITED(), wrongCode(3)] });
    await openCodeStep();
    pasteCode(1, "111111");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await settle();

    typeCode("222222");
    await settle();
    expect(sentCodes(sent)).toEqual(["111111", "111111"]);
    await tickSecond();
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["111111", "111111", "222222"]);
  });
});
