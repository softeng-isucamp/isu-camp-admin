import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { Login } from "./AuthPages";

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** `/api/me` says signed out; each sign-in attempt consumes the next response. */
const mockBackend = (...loginResponses: Response[]) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/api/me")) return jsonResponse({ authenticated: false });
    const next = loginResponses.shift();
    if (!next) throw new Error("Unexpected sign-in request");
    return next;
  });

const renderLogin = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  );

const attemptSignIn = async () => {
  fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: "admin01" } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "wrong-pass" } });
  fireEvent.click(screen.getByRole("button", { name: /^login$/i }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const rejected = (attemptsRemaining?: number) =>
  jsonResponse(
    { success: false, message: "Invalid username or password", ...(attemptsRemaining === undefined ? {} : { attemptsRemaining }) },
    401,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("login attempts left", () => {
  it("shows how many attempts remain after a failed sign-in", async () => {
    mockBackend(rejected(4));
    renderLogin();
    await attemptSignIn();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Incorrect username or password. 4 attempts left.");
    expect(alert).not.toHaveClass("error-urgent");
  });

  it("turns urgent at 2 attempts left and says 'attempt' for the last one", async () => {
    mockBackend(rejected(3), rejected(2), rejected(1));
    renderLogin();

    await attemptSignIn();
    expect(screen.getByRole("alert")).not.toHaveClass("error-urgent");

    await attemptSignIn();
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect username or password. 2 attempts left.");
    expect(screen.getByRole("alert")).toHaveClass("error-urgent");

    await attemptSignIn();
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect username or password. 1 attempt left.");
    expect(screen.getByRole("alert")).toHaveClass("error-urgent");
  });

  it("shows only the plain message when the backend sends no count", async () => {
    mockBackend(rejected());
    renderLogin();
    await attemptSignIn();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Invalid username or password");
    expect(alert).not.toHaveTextContent(/attempt/i);
    expect(alert).not.toHaveClass("error-urgent");
  });

  it("disables the inputs and button during the lockout countdown, then re-enables them", async () => {
    mockBackend(jsonResponse({ success: false, message: "Too many login attempts." }, 429, { "Retry-After": "2" }));
    renderLogin();
    await attemptSignIn();

    expect(screen.getByLabelText(/^username$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^password$/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /login in 2s/i })).toBeDisabled();

    // The countdown re-arms its timer on every render, so tick one second at a time.
    for (let second = 0; second < 2; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(screen.getByLabelText(/^username$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^password$/i)).toBeEnabled();
    expect(screen.getByRole("button", { name: /^login$/i })).toBeEnabled();
  });

  it("clears the attempts-left message when the next sign-in is submitted", async () => {
    mockBackend(rejected(4), jsonResponse({ success: false, message: "Server error" }, 500));
    renderLogin();
    await attemptSignIn();
    await attemptSignIn();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/attempt/i);
  });
});

describe("Caps Lock warning on login", () => {
  it("warns while the password field is focused and Caps Lock is on", () => {
    mockBackend();
    renderLogin();
    const password = screen.getByLabelText(/^password$/i);
    expect(screen.queryByText(/caps lock is on/i)).toBeNull();

    fireEvent.keyDown(password, { key: "A", modifierCapsLock: true });
    expect(screen.getByRole("status")).toHaveTextContent("Caps Lock is on");

    fireEvent.keyUp(password, { key: "A", modifierCapsLock: false });
    expect(screen.queryByText(/caps lock is on/i)).toBeNull();
  });

  it("hides the warning when the password field loses focus", () => {
    mockBackend();
    renderLogin();
    const password = screen.getByLabelText(/^password$/i);
    fireEvent.keyDown(password, { key: "A", modifierCapsLock: true });
    expect(screen.getByText(/caps lock is on/i)).toBeInTheDocument();

    fireEvent.blur(password);
    expect(screen.queryByText(/caps lock is on/i)).toBeNull();
  });

  it("does not warn for Caps Lock typed in the username field", () => {
    mockBackend();
    renderLogin();
    fireEvent.keyDown(screen.getByLabelText(/^username$/i), { key: "A", modifierCapsLock: true });
    expect(screen.queryByText(/caps lock is on/i)).toBeNull();
  });
});

describe("recovery link placement", () => {
  it("places 'Forgot password?' between the password field and the submit button", () => {
    mockBackend();
    renderLogin();
    const password = screen.getByLabelText(/^password$/i);
    const link = screen.getByRole("link", { name: /forgot password/i });
    const submit = screen.getByRole("button", { name: /^login$/i });

    expect(password.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const textboxesBetween = screen
      .queryAllByRole("textbox")
      .filter(
        (box) =>
          password.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING &&
          box.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    expect(textboxesBetween).toHaveLength(0);
  });
});
