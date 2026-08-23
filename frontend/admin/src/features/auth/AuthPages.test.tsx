import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthContext";
import { Login, PasswordReset } from "./AuthPages";
import { services } from "../../services/api";

vi.spyOn(services.auth, "reset").mockResolvedValue(undefined);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockResetRequest = () => {
  vi.spyOn(services.auth, "requestReset").mockResolvedValue(undefined);
  vi.spyOn(services.auth, "reset").mockResolvedValue(undefined);
};

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
      screen.getByRole("heading", { name: "ISU-CAMP" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter your username")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter your password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /forgot password/i }),
    ).toHaveAttribute("href", "/reset-password");
  });
});

describe("password recovery screen", () => {
  it("renders username field with placeholder and rejects empty username", () => {
    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("ADMIN USERNAME")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("admin01")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Username is required/i);
  });

  it("validates the code with empty boxes and displays new password placeholders", async () => {
    mockResetRequest();
    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), {
      target: { value: "admin01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(
      await screen.findByRole("heading", { name: /verification code/i }),
    ).toBeInTheDocument();

    // Verify initial empty boxes state
    expect(screen.getByLabelText("Digit 1")).toHaveValue("");
    expect(screen.getByLabelText("Digit 6")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("VERIFICATION CODE"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/6-digit verification code/i);
    fireEvent.change(screen.getByLabelText("VERIFICATION CODE"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getByPlaceholderText("Enter new password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Confirm new password")).toBeInTheDocument();

    const newPassInput = screen.getByLabelText("NEW PASSWORD");
    const confirmPassInput = screen.getByLabelText("CONFIRM NEW PASSWORD");
    fireEvent.change(newPassInput, { target: { value: "password123" } });
    fireEvent.change(confirmPassInput, { target: { value: "password123" } });
    await fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

    expect(
      await screen.findByRole("heading", {
        name: /password reset successful/i,
      }),
    ).toBeInTheDocument();
  });

  it("supports pasting a 6-digit code into the segmented inputs", async () => {
    mockResetRequest();
    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), {
      target: { value: "admin01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(
      await screen.findByRole("heading", { name: /verification code/i }),
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

  it("supports resending verification code when requested", async () => {
    mockResetRequest();
    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), {
      target: { value: "admin01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(
      await screen.findByRole("heading", { name: /verification code/i }),
    ).toBeInTheDocument();

    const resendButton = screen.getByRole("button", { name: /resend code/i });
    expect(resendButton).toBeInTheDocument();

    fireEvent.click(resendButton);
    expect(
      await screen.findByText(/a new 6-digit verification code has been sent/i),
    ).toBeInTheDocument();
  });
});

describe("rate limiting", () => {
  it("shows rate-limit error on 429 response", async () => {
    vi.spyOn(services.auth, "requestReset").mockRejectedValue(
      new Error("Too many requests. Please wait 45 seconds.")
    );

    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), {
      target: { value: "admin01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    expect(
      await screen.findByText(/too many requests/i),
    ).toBeInTheDocument();
  });
});
