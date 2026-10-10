import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";

const EMAIL = "admin@isu.edu.ph";
const STRONG = "Passw0rd!x";
const RESET = "/api/recovery/reset-password";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const mockBackend = (resetReplies: Response[] = []) => {
  const resets: unknown[] = [];
  const requests: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/me")) return jsonResponse({ authenticated: false });
    if (url.endsWith("/api/recovery/request")) {
      requests.push(JSON.parse(String(init?.body)));
      return jsonResponse({ success: true, message: "Sent." });
    }
    if (url.endsWith("/api/recovery/verify")) return jsonResponse({ success: true, username: "admin_justine" });
    if (url.endsWith(RESET)) {
      resets.push(JSON.parse(String(init?.body)));
      const next = resetReplies.shift();
      if (!next) throw new Error("No reset reply queued");
      return next;
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  return { resets, requests };
};

const reachNewPassword = async () => {
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <AuthProvider>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByRole("heading", { name: /verification code/i });
  [..."000000"].forEach((digit, i) =>
    fireEvent.input(screen.getByLabelText(`Digit ${i + 1} of 6`), { target: { value: digit } }),
  );
  await screen.findByRole("heading", { name: /create a new password/i });
};

const newPassword = () => screen.getByLabelText("New password");
const confirmPassword = () => screen.getByLabelText("Confirm new password");
const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

const requirements = () => within(screen.getByRole("list", { name: "Password requirements" }));
const requirement = (state: "Met" | "Not met", label: string) =>
  requirements().getByRole("listitem", { name: `${state}: ${label}` });
const LENGTH = "At least 8 characters";
const UPPERCASE = "An uppercase letter";
const LOWERCASE = "A lowercase letter";
const NUMBER = "A number";
const SYMBOL = "A symbol";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("new password step: requirements checklist", () => {
  it("starts with every requirement unmet", async () => {
    mockBackend();
    await reachNewPassword();

    expect(requirements().getAllByRole("listitem")).toHaveLength(5);
    for (const label of [LENGTH, UPPERCASE, LOWERCASE, NUMBER, SYMBOL]) requirement("Not met", label);
  });

  it("ticks each requirement as it is satisfied and announces the state with it", async () => {
    mockBackend();
    await reachNewPassword();

    type(newPassword(), "abcdefgh");
    requirement("Met", LENGTH);
    requirement("Met", LOWERCASE);
    requirement("Not met", UPPERCASE);
    requirement("Not met", NUMBER);
    requirement("Not met", SYMBOL);

    type(newPassword(), "Abcdefg1");
    requirement("Met", UPPERCASE);
    requirement("Met", NUMBER);
    requirement("Not met", SYMBOL);

    type(newPassword(), "Abcdef1!");
    for (const label of [LENGTH, UPPERCASE, LOWERCASE, NUMBER, SYMBOL]) requirement("Met", label);

    type(newPassword(), "Abc1!");
    requirement("Not met", LENGTH);
  });
});

describe("new password step: length counts characters", () => {
  it("counts each emoji as one character, not two UTF-16 code units", async () => {
    const { resets } = mockBackend([jsonResponse({ success: true, username: "admin_justine" })]);
    await reachNewPassword();

    // "Ab1" plus three emoji is 6 characters even though it has 9 UTF-16 units.
    type(newPassword(), "Ab1😀😀😀");
    requirement("Not met", LENGTH);
    type(confirmPassword(), "Ab1😀😀😀");
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    expect(resets).toEqual([]);

    // "Ab1" plus five emoji is exactly 8 characters.
    type(newPassword(), "Ab1😀😀😀😀😀");
    requirement("Met", LENGTH);
    type(confirmPassword(), "Ab1😀😀😀😀😀");
    submit();
    expect(await screen.findByRole("heading", { name: /password reset successful/i })).toBeInTheDocument();
    expect(resets).toHaveLength(1);
  });
});

describe("new password step: match indicator", () => {
  it("says nothing until the confirmation is started, then follows what is typed", async () => {
    mockBackend();
    await reachNewPassword();
    type(newPassword(), STRONG);

    expect(screen.queryByText(/passwords match/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();

    type(confirmPassword(), "Passw0");
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();

    type(confirmPassword(), STRONG);
    expect(screen.getByText(/passwords match/i)).toBeInTheDocument();
    expect(screen.queryByText(/do not match/i)).not.toBeInTheDocument();

    type(newPassword(), `${STRONG}z`);
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });
});

describe("new password step: show and hide", () => {
  it("toggles each field independently", async () => {
    mockBackend();
    await reachNewPassword();
    expect(newPassword()).toHaveAttribute("type", "password");
    expect(confirmPassword()).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));
    expect(newPassword()).toHaveAttribute("type", "text");
    expect(confirmPassword()).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Show new password" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Show confirm password" }));
    expect(confirmPassword()).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));
    expect(newPassword()).toHaveAttribute("type", "password");
    expect(confirmPassword()).toHaveAttribute("type", "text");
  });
});

describe("new password step: caps lock", () => {
  it("warns on the field being typed in and clears when it loses focus", async () => {
    mockBackend();
    await reachNewPassword();

    fireEvent.keyDown(newPassword(), { key: "A", modifierCapsLock: true });
    expect(screen.getAllByText("Caps Lock is on")).toHaveLength(1);

    fireEvent.blur(newPassword());
    expect(screen.queryByText("Caps Lock is on")).not.toBeInTheDocument();

    fireEvent.keyDown(confirmPassword(), { key: "A", modifierCapsLock: true });
    expect(screen.getByText("Caps Lock is on")).toBeInTheDocument();
    fireEvent.keyUp(confirmPassword(), { key: "CapsLock", modifierCapsLock: false });
    expect(screen.queryByText("Caps Lock is on")).not.toBeInTheDocument();
  });
});

describe("new password step: submit", () => {
  it.each([
    ["abcdefg", /at least 8 characters/i],
    ["abcdefgh1!", /uppercase letter/i],
    ["ABCDEFGH1!", /lowercase letter/i],
    ["Abcdefgh!!", /a number/i],
    ["Abcdefgh12", /a symbol/i],
  ])("blocks %s client-side and names the first unmet rule", async (weak, reason) => {
    const { resets } = mockBackend();
    await reachNewPassword();

    type(newPassword(), weak);
    type(confirmPassword(), weak);
    submit();

    expect(screen.getByRole("alert")).toHaveTextContent(reason);
    expect(resets).toEqual([]);
  });

  it("ties the rejected field to the alert and clears both once the admin edits", async () => {
    mockBackend();
    await reachNewPassword();

    type(newPassword(), "abc");
    type(confirmPassword(), "abc");
    submit();
    expect(newPassword()).toHaveAttribute("aria-invalid", "true");
    expect(newPassword()).toHaveAccessibleDescription(/at least 8 characters/i);
    expect(confirmPassword()).not.toHaveAttribute("aria-invalid");

    type(newPassword(), STRONG);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(newPassword()).not.toHaveAttribute("aria-invalid");
  });

  it("points a mismatch at the confirmation field", async () => {
    mockBackend();
    await reachNewPassword();

    type(newPassword(), STRONG);
    type(confirmPassword(), `${STRONG}y`);
    submit();
    expect(confirmPassword()).toHaveAttribute("aria-invalid", "true");
    expect(confirmPassword()).toHaveAccessibleDescription("Passwords do not match.");
  });

  it("sends the new password once every rule passes and the fields match", async () => {
    const { resets } = mockBackend([jsonResponse({ success: true, username: "admin_justine" })]);
    await reachNewPassword();

    type(newPassword(), STRONG);
    type(confirmPassword(), STRONG);
    submit();

    expect(await screen.findByRole("heading", { name: /password reset successful/i })).toBeInTheDocument();
    expect(resets).toEqual([{ email: EMAIL, code: "000000", password: STRONG }]);
  });

  it("moves focus to the success heading once the reset succeeds", async () => {
    mockBackend([jsonResponse({ success: true, username: "admin_justine" })]);
    await reachNewPassword();

    type(newPassword(), STRONG);
    type(confirmPassword(), STRONG);
    submit();

    // The heading is found as soon as it renders; its focus effect runs a moment later.
    const heading = await screen.findByRole("heading", { name: /password reset successful/i });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("shows the server's weak_password message and stays on the step", async () => {
    mockBackend([jsonResponse({ success: false, code: "weak_password", message: "Password is too common." }, 400)]);
    await reachNewPassword();

    type(newPassword(), STRONG);
    type(confirmPassword(), STRONG);
    submit();
    await act(async () => {
      await Promise.resolve();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Password is too common.");
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
    expect(newPassword()).toHaveValue(STRONG);
    expect(screen.getByRole("button", { name: "Reset password" })).toBeEnabled();
  });
});

describe("new password step: the server turns the code down", () => {
  it.each([
    ["code_exhausted", "You have used all your attempts. Request a new code to continue."],
    ["code_expired", "This code has expired. Request a new code to continue."],
  ])("%s sends the admin back to the code step to request a new code", async (code, message) => {
    const { requests } = mockBackend([jsonResponse({ success: false, code, message: "Server says no." }, 400)]);
    await reachNewPassword();

    type(newPassword(), STRONG);
    type(confirmPassword(), STRONG);
    submit();

    // The heading is found as soon as it renders; its focus effect runs a moment later.
    const heading = await screen.findByRole("heading", { name: /verification code/i });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Digit 1 of 6")).toBeDisabled();

    // Resend is the primary action, available at once, and asks for a new code for the same email.
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByText("A new code has been sent.")).toBeInTheDocument();
    expect(requests).toEqual([{ email: EMAIL, purpose: "password" }, { email: EMAIL, purpose: "password" }]);
    expect(screen.getByLabelText("Digit 1 of 6")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });
});
