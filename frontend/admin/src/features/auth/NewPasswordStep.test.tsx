import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/me")) return jsonResponse({ authenticated: false });
    if (url.endsWith("/api/recovery/request")) return jsonResponse({ success: true, message: "Sent." });
    if (url.endsWith("/api/recovery/verify")) return jsonResponse({ success: true, username: "admin_justine" });
    if (url.endsWith(RESET)) {
      resets.push(JSON.parse(String(init?.body)));
      const next = resetReplies.shift();
      if (!next) throw new Error("No reset reply queued");
      return next;
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  return { resets };
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
  fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByRole("heading", { name: /verification code/i });
  [..."000000"].forEach((digit, i) =>
    fireEvent.change(screen.getByLabelText(`Digit ${i + 1} of 6`), { target: { value: digit } }),
  );
  await screen.findByRole("heading", { name: /create a new password/i });
};

const newPassword = () => screen.getByLabelText("NEW PASSWORD");
const confirmPassword = () => screen.getByLabelText("CONFIRM NEW PASSWORD");
const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

const requirements = () => within(screen.getByRole("list", { name: "Password requirements" }));
const rule = (name: RegExp) => requirements().getByText(name).closest("li") as HTMLElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("new password step: requirements checklist", () => {
  it("starts with every requirement unmet", async () => {
    mockBackend();
    await reachNewPassword();

    expect(requirements().getAllByRole("listitem")).toHaveLength(5);
    for (const item of requirements().getAllByRole("listitem")) expect(item).toHaveTextContent(/^.*Not met:/);
  });

  it("ticks each requirement as it is satisfied and reports the state in text", async () => {
    mockBackend();
    await reachNewPassword();

    type(newPassword(), "abcdefgh");
    expect(rule(/at least 8 characters/i)).toHaveTextContent("Met:");
    expect(rule(/lowercase letter/i)).toHaveTextContent("Met:");
    expect(rule(/uppercase letter/i)).toHaveTextContent("Not met:");
    expect(rule(/a number/i)).toHaveTextContent("Not met:");
    expect(rule(/a symbol/i)).toHaveTextContent("Not met:");

    type(newPassword(), "Abcdefg1");
    expect(rule(/uppercase letter/i)).toHaveTextContent("Met:");
    expect(rule(/a number/i)).toHaveTextContent("Met:");
    expect(rule(/a symbol/i)).toHaveTextContent("Not met:");

    type(newPassword(), "Abcdef1!");
    for (const item of requirements().getAllByRole("listitem")) expect(item).toHaveTextContent("Met:");

    type(newPassword(), "Abc1!");
    expect(rule(/at least 8 characters/i)).toHaveTextContent("Not met:");
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

  it("sends the new password once every rule passes and the fields match", async () => {
    const { resets } = mockBackend([jsonResponse({ success: true, username: "admin_justine" })]);
    await reachNewPassword();

    type(newPassword(), STRONG);
    type(confirmPassword(), STRONG);
    submit();

    expect(await screen.findByRole("heading", { name: /password reset successful/i })).toBeInTheDocument();
    expect(resets).toEqual([{ email: EMAIL, code: "000000", password: STRONG }]);
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
    expect(screen.getByRole("button", { name: "Reset Password" })).toBeEnabled();
  });
});
