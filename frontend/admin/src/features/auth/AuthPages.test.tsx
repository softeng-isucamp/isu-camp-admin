import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthContext";
import { Login } from "./AuthPages";
import { RateLimitError, services } from "../../services/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("login screen", () => {
  it("renders the admin login with placeholders and no pre-filled values", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "KUMPAS" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter your username")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter your password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /forgot password/i }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("pre-fills the username a recovery flow hands over in navigation state", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { username: "admin_justine" } }]}>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/^username$/i)).toHaveValue("admin_justine");
    expect(screen.getByLabelText(/^password$/i)).toHaveValue("");
    // Only the password is left to type, so focus waits there.
    await waitFor(() => expect(screen.getByLabelText(/^password$/i)).toHaveFocus());
  });

  it("leaves focus alone when login is opened directly", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/^password$/i)).not.toHaveFocus();
  });
});

describe("rate limiting", () => {
  it("disables Login during a server-provided retry window", async () => {
    vi.useFakeTimers();
    vi.spyOn(services.auth, "login").mockRejectedValue(new RateLimitError(3));
    render(<MemoryRouter><AuthProvider><Login /></AuthProvider></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText("Enter your username"), { target: { value: "admin01" } });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "wrongpass" } });
    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "Try again in 3s" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();
    vi.useRealTimers();
  });
});
