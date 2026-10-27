import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { Users } from "../users/Users";
import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";

// User Management's send and the recipient's Forgot Password over the one fixture backend: the
// code the colleague sends is the one the recipient redeems, without asking for another.
// The fixture lives in module memory, which is why this is its own file.

const PASSWORD = "password123";
const RECIPIENT_EMAIL = "registrar.admin@isu.edu.ph";
// The fixture's every issued code.
const CODE = "000000";

const withProviders = (children: React.ReactNode, path: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
};

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await services.auth.logout();
});

describe("a password reset code sent from User Management", () => {
  it("is redeemed by the recipient on Forgot Password with I already have a code", async () => {
    vi.spyOn(services.users, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    await services.auth.login("admin_justine", PASSWORD);
    withProviders(<Users />, "/users");
    fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
    await screen.findByText("admin_registrar");
    fireEvent.click(screen.getByRole("button", { name: "Actions for admin_registrar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /send password reset code/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send Reset Code" }));
    expect(await screen.findByText(`A password reset code was sent to ${RECIPIENT_EMAIL}.`)).toBeInTheDocument();
    cleanup();
    await services.auth.logout();

    const request = vi.spyOn(services.auth, "requestRecovery");
    withProviders(<ForgotPassword />, "/forgot-password");
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: RECIPIENT_EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: "I already have a code" }));
    await screen.findByRole("heading", { name: /verification code/i });
    [...CODE].forEach((digit, i) => fireEvent.input(screen.getByLabelText(`Digit ${i + 1} of 6`), { target: { value: digit } }));
    await screen.findByRole("heading", { name: /create a new password/i });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Passw0rd!x" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Passw0rd!x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await screen.findByRole("heading", { name: /password reset successful/i });

    expect(request).not.toHaveBeenCalled();
    await expect(services.auth.login("admin_registrar", "Passw0rd!x")).resolves.toMatchObject({ username: "admin_registrar" });
  });

  it("gives Forgot Password nothing to redeem when no code was sent", async () => {
    await expect(services.auth.verifyRecovery("dean.admin@isu.edu.ph", "password", CODE)).rejects.toMatchObject({ kind: "invalid_code" });
  });
});
