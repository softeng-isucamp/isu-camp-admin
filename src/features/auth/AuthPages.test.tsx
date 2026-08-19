import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "./AuthContext";
import { Login, PasswordReset } from "./AuthPages";

describe("login screen", () => {
  it("renders the Figma-authored admin login affordances", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "ISU-CAMP" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("admin_justine")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /forgot password/i }),
    ).toHaveAttribute("href", "/reset-password");
  });
});

describe("password recovery screen", () => {
  it("validates the code and reaches the success state", async () => {
    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(
      screen.getByRole("heading", { name: /verification code/i }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("VERIFICATION CODE"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText(/6-digit verification code/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("VERIFICATION CODE"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText("NEW PASSWORD"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));
    expect(
      await screen.findByRole("heading", {
        name: /password reset successful/i,
      }),
    ).toBeInTheDocument();
  });
});
