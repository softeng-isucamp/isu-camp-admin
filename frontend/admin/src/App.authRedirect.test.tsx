import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { services } from "./services/api";
import type { Session } from "./types";

const SESSION: Session = { id: "1", username: "admin_justine", email: "admin@isu.edu.ph", role: "superadmin" } as Session;

/** The app as main.tsx mounts it: the query client and router around it. */
function renderApp(entries: Parameters<typeof MemoryRouter>[0]["initialEntries"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}><App /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The page title the shell shows in its header, which is the page the router is on. */
const onPage = (title: string) => waitFor(() => expect(document.querySelector(".crumb b")).toHaveTextContent(title));

async function signInThroughLogin() {
  fireEvent.change(await screen.findByPlaceholderText("Enter your username"), { target: { value: "admin_justine" } });
  fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: /login/i }));
}

describe("returning to the requested page after sign-in", () => {
  it("opens the page a signed-out visitor asked for once they sign in", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp(["/system-logs"]);
    await signInThroughLogin();
    await onPage("System Logs");
    expect(screen.queryByPlaceholderText("Enter your username")).not.toBeInTheDocument();
  });

  it("keeps the query string of the page it turned away from", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp(["/system-logs?q=admin_justine&category=Admin"]);
    await signInThroughLogin();
    await onPage("System Logs");
    expect(await screen.findByDisplayValue("admin_justine")).toBeInTheDocument();
  });

  it("returns a signed-out visitor to /users, not the Dashboard", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp(["/users"]);
    await signInThroughLogin();
    await onPage("User Management");
  });

  it("falls back to the Dashboard when the remembered address is not one of the admin pages", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    const external = [{ pathname: "/login", state: { from: { pathname: "https://evil.example/steal", search: "", hash: "" } } }];
    renderApp(external);
    await signInThroughLogin();
    await onPage("Dashboard Overview");
  });

  it("never returns to the sign-in or recovery pages", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    const loop = [{ pathname: "/login", state: { from: { pathname: "/forgot-password", search: "", hash: "" } } }];
    renderApp(loop);
    await signInThroughLogin();
    await onPage("Dashboard Overview");
  });
});

describe("a signed-in administrator opening a sign-in or recovery page", () => {
  it.each(["/login", "/forgot-password"])("is sent from %s to the Dashboard", async (path) => {
    vi.spyOn(services.auth, "me").mockResolvedValue(SESSION);
    renderApp([path]);
    await onPage("Dashboard Overview");
    expect(screen.queryByPlaceholderText("Enter your username")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send|verify|reset/i })).not.toBeInTheDocument();
  });
});
