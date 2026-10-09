import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotUsername } from "./ForgotUsername";
import { Login } from "./AuthPages";

const EMAIL = "admin@isu.edu.ph";
const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** `/api/me` says signed out; each recovery call consumes the next reply queued for its path. */
const mockBackend = (queues: Partial<Record<string, Response[]>>) => {
  const sent: Record<string, unknown[]> = {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/me")) return jsonResponse({ authenticated: false });
    const path = Object.keys(queues).find((candidate) => url.endsWith(candidate));
    if (!path) throw new Error(`Unexpected request to ${url}`);
    (sent[path] ??= []).push(JSON.parse(String(init?.body)));
    const next = queues[path]?.shift();
    if (!next) throw new Error(`No reply queued for ${path}`);
    return next;
  });
  return { sent };
};

const issued = () => jsonResponse({ success: true, message: "If an account exists, a code has been sent." });
const verified = (username = "admin_justine") => jsonResponse({ success: true, username });

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

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
const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.change(box(i + 1), { target: { value: digit } }));

const reachCodeStep = async () => {
  fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: EMAIL } });
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

    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 4 attempts left.");
    expect(screen.queryByText("admin_justine")).not.toBeInTheDocument();
  });
});
