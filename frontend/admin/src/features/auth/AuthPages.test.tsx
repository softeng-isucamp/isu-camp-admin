import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "./AuthContext";
import { Login, PasswordReset } from "./AuthPages";

afterEach(() => cleanup());

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
  it("rejects an invalid recovery email", () => {
    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/admin username/i);
  });

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
    expect(screen.getByRole("alert")).toHaveTextContent(/6-digit verification code/i);
    fireEvent.change(screen.getByLabelText("VERIFICATION CODE"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText("NEW PASSWORD"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByLabelText("CONFIRM NEW PASSWORD"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password|save password/i }));
    expect(
      await screen.findByRole("heading", {
        name: /password reset successful/i,
      }),
    ).toBeInTheDocument();
  });

  it("supports pasting a 6-digit code into the segmented inputs", () => {
    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(
      screen.getByRole("heading", { name: /verification code/i }),
    ).toBeInTheDocument();

    const firstDigitInput = screen.getByLabelText("Digit 1");
    fireEvent.paste(firstDigitInput, {
      clipboardData: {
        getData: () => "123456",
      },
    });

    expect(screen.getByLabelText("Digit 1")).toHaveValue("1");
    expect(screen.getByLabelText("Digit 2")).toHaveValue("2");
    expect(screen.getByLabelText("Digit 3")).toHaveValue("3");
    expect(screen.getByLabelText("Digit 4")).toHaveValue("4");
    expect(screen.getByLabelText("Digit 5")).toHaveValue("5");
    expect(screen.getByLabelText("Digit 6")).toHaveValue("6");

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByLabelText("NEW PASSWORD")).toBeInTheDocument();
  });
});
