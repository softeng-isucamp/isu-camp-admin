import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

/** Submits without filling anything in, so only the client-side checks run. */
const submitLogin = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^login$/i }));
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
    expect(within(alert).queryByRole("img", { name: "Warning" })).toBeNull();
  });

  it("turns urgent at 2 attempts left and says 'attempt' for the last one", async () => {
    mockBackend(rejected(3), rejected(2), rejected(1));
    renderLogin();

    await attemptSignIn();
    expect(within(screen.getByRole("alert")).queryByRole("img", { name: "Warning" })).toBeNull();

    await attemptSignIn();
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect username or password. 2 attempts left.");
    expect(within(screen.getByRole("alert")).getByRole("img", { name: "Warning" })).toBeInTheDocument();

    await attemptSignIn();
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect username or password. 1 attempt left.");
    expect(within(screen.getByRole("alert")).getByRole("img", { name: "Warning" })).toBeInTheDocument();
  });

  it("shows only the plain message when the backend sends no count", async () => {
    mockBackend(rejected());
    renderLogin();
    await attemptSignIn();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Invalid username or password");
    expect(alert).not.toHaveTextContent(/attempt/i);
    expect(within(alert).queryByRole("img", { name: "Warning" })).toBeNull();
  });

  it("disables the inputs and button during the lockout countdown, then re-enables them", async () => {
    mockBackend(jsonResponse({ success: false, message: "Too many login attempts." }, 429, { "Retry-After": "2" }));
    renderLogin();
    await attemptSignIn();

    expect(screen.getByLabelText(/^username$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^password$/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();
    // The button carries the live count; the alert names no number and takes the urgent icon.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Too many attempts. Try again when the button unlocks.");
    expect(alert).not.toHaveTextContent(/\d/);
    expect(within(alert).getByRole("img", { name: "Warning" })).toBeInTheDocument();

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

describe("login field errors", () => {
  it("marks the empty field invalid, ties it to the alert, and clears both once the field is edited", async () => {
    mockBackend();
    renderLogin();
    const username = screen.getByLabelText(/^username$/i);
    await submitLogin();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Username is required.");
    expect(username).toHaveAttribute("aria-invalid", "true");
    expect(username).toHaveAccessibleDescription("Username is required.");
    expect(screen.getByLabelText(/^password$/i)).not.toHaveAttribute("aria-invalid");

    fireEvent.change(username, { target: { value: "admin01" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(username).not.toHaveAttribute("aria-invalid");
  });

  it("points at the password field when only the password is missing", async () => {
    mockBackend();
    renderLogin();
    fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: "admin01" } });
    await submitLogin();

    const password = screen.getByLabelText(/^password$/i);
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription("Password is required.");
    expect(screen.getByLabelText(/^username$/i)).not.toHaveAttribute("aria-invalid");
  });

  it("keeps a server error on screen while the admin edits", async () => {
    mockBackend(rejected(4));
    renderLogin();
    await attemptSignIn();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "another" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect username or password.");
  });
});

describe("show password on login", () => {
  it("names the toggle 'Show password' and reports whether the password is shown", () => {
    mockBackend();
    renderLogin();
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "password");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "text");
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
