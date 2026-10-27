import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotUsername } from "./ForgotUsername";
import { Login } from "./AuthPages";
import { exhausted, expired, issued, jsonResponse, mockBackend, settle, verified, wrongCode } from "./testing/recoveryFetch";

const EMAIL = "admin@isu.edu.ph";
const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";

const renderFrom = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-username" element={<ForgotUsername />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const box = (position: number) => screen.getByLabelText(`Digit ${position} of 6`);
const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.input(box(i + 1), { target: { value: digit } }));

const reachCodeStep = async () => {
  fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByRole("heading", { name: /verification code/i });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("login: forgot username link", () => {
  it("sits directly under the username field, before the password field", () => {
    mockBackend({});
    renderFrom("/login");

    const link = screen.getByRole("link", { name: "Forgot username?" });
    expect(link).toHaveAttribute("href", "/forgot-username");

    const username = screen.getByLabelText(/^username$/i);
    const password = screen.getByLabelText(/^password$/i);
    expect(username.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the forgot-username flow", async () => {
    mockBackend({});
    renderFrom("/login");

    fireEvent.click(screen.getByRole("link", { name: "Forgot username?" }));

    expect(await screen.findByRole("heading", { name: /find your username/i })).toBeInTheDocument();
  });
});

describe("forgot-username flow", () => {
  it("focuses the email step heading when the page first loads", () => {
    mockBackend({});
    renderFrom("/forgot-username");

    expect(screen.getByRole("heading", { name: /find your username/i })).toHaveFocus();
  });

  it("requests a code with the username purpose", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()] });
    renderFrom("/forgot-username");

    await reachCodeStep();

    expect(sent[REQUEST]).toEqual([{ email: EMAIL, purpose: "username" }]);
  });

  it("verifies with the username purpose, shows the username, and continues to login prefilled", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [verified("admin_justine")] });
    renderFrom("/forgot-username");
    await reachCodeStep();

    typeCode("000000");
    await settle();

    expect(sent[VERIFY]).toEqual([{ email: EMAIL, purpose: "username", code: "000000" }]);
    expect(await screen.findByRole("heading", { name: /your username/i })).toBeInTheDocument();
    expect(screen.getByText("admin_justine")).toBeInTheDocument();
    expect(screen.getByText("Your username has been recovered. Use it to sign in to the admin console.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue to login" }));

    expect(await screen.findByLabelText(/^username$/i)).toHaveValue("admin_justine");
    expect(screen.getByLabelText(/^password$/i)).toHaveValue("");
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("keeps the admin on the code step after a wrong code", async () => {
    mockBackend({
      [REQUEST]: [issued()],
      [VERIFY]: [jsonResponse({ success: false, code: "invalid_code", message: "Invalid verification code", attemptsRemaining: 4 }, 400)],
    });
    renderFrom("/forgot-username");
    await reachCodeStep();

    typeCode("111111");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 4 attempts remaining.");
    expect(screen.queryByText("admin_justine")).not.toBeInTheDocument();
  });
});

describe("forgot-username: same instructions and feedback as forgot password", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the shared email helper, code-step instructions, countdown and resend cooldown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600, resendAfterSeconds: 60 })] });
    renderFrom("/forgot-username");
    expect(screen.getByText(/primary or alternative email associated with your administrator account/i)).toBeInTheDocument();
    expect(screen.getByText(/An email that is not on an administrator account is refused\./)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    expect(screen.getByText(/verification code has been sent to/i)).toHaveTextContent(
      `A 6-digit verification code has been sent to ${EMAIL}.`,
    );
    expect(screen.getByText(/Only the most recently sent code will work/)).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 10:00");
    expect(screen.getByText("Resend available in 60s.")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 09:59");
  });

  it.each([
    ["an incorrect code without a count", () => wrongCode(), "The verification code is incorrect. Please try again."],
    ["the last attempt", () => wrongCode(1), "Incorrect verification code. You have 1 attempt remaining."],
    ["an expired code", () => expired(), "This verification code has expired. Request a new code to continue."],
    ["an exhausted code", () => exhausted(), "You've used all verification attempts for this code. Request a new code to continue."],
  ])("words %s like forgot password", async (_name, reply, message) => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [reply()] });
    renderFrom("/forgot-username");
    await reachCodeStep();

    typeCode("111111");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });
});
