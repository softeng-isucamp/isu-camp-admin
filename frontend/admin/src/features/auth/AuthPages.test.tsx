import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthContext";
import { Login, PasswordReset } from "./AuthPages";
import { OtpInput, type OtpInputHandle } from "./OtpInput";
import { RateLimitError, services } from "../../services/api";

vi.spyOn(services.auth, "reset").mockResolvedValue(undefined);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pasteCode = (box: string, text: string) =>
  fireEvent.paste(screen.getByLabelText(box), {
    clipboardData: { getData: () => text },
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
      screen.getByRole("heading", { name: "KUMPAS" }),
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
    vi.spyOn(services.auth, "verifyReset").mockResolvedValue(undefined);
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
    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("");
    expect(screen.getByLabelText("Digit 6 of 6")).toHaveValue("");

    pasteCode("Digit 1 of 6", "123");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/6-digit verification code/i);
    await act(async () => { await Promise.resolve(); });
    pasteCode("Digit 1 of 6", "000000");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByPlaceholderText("Enter new password")).toBeInTheDocument();
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
    vi.spyOn(services.auth, "verifyReset").mockResolvedValue(undefined);
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

    pasteCode("Digit 1 of 6", "123456");

    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("1");
    expect(screen.getByLabelText("Digit 2 of 6")).toHaveValue("2");
    expect(screen.getByLabelText("Digit 3 of 6")).toHaveValue("3");
    expect(screen.getByLabelText("Digit 4 of 6")).toHaveValue("4");
    expect(screen.getByLabelText("Digit 5 of 6")).toHaveValue("5");
    expect(screen.getByLabelText("Digit 6 of 6")).toHaveValue("6");

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByLabelText("NEW PASSWORD")).toBeInTheDocument();
  });

  it("fills every box from the start when a code with spaces or dashes is pasted into any box", async () => {
    mockResetRequest();
    render(<MemoryRouter><PasswordReset /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), { target: { value: "admin01" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByRole("heading", { name: /verification code/i });

    const expectCode = (code: string) =>
      code.split("").forEach((digit, i) =>
        expect(screen.getByLabelText(`Digit ${i + 1} of 6`)).toHaveValue(digit),
      );

    pasteCode("Digit 4 of 6", "123 456");
    expectCode("123456");
    expect(screen.getByLabelText("Digit 6 of 6")).toHaveFocus();

    pasteCode("Digit 3 of 6", "654-321");
    expectCode("654321");

    fireEvent.change(screen.getByLabelText("Digit 2 of 6"), { target: { value: "98 76-54" } });
    expectCode("987654");
  });

  it("moves focus forward while typing and back on Backspace from an empty box", async () => {
    mockResetRequest();
    render(<MemoryRouter><PasswordReset /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), { target: { value: "admin01" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByRole("heading", { name: /verification code/i });

    expect(screen.getByLabelText("Digit 1 of 6")).toHaveAttribute("autocomplete", "one-time-code");
    expect(screen.getByLabelText("Digit 1 of 6")).toHaveAttribute("inputmode", "numeric");

    fireEvent.change(screen.getByLabelText("Digit 1 of 6"), { target: { value: "4" } });
    expect(screen.getByLabelText("Digit 2 of 6")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Digit 2 of 6"), { target: { value: "7" } });
    expect(screen.getByLabelText("Digit 3 of 6")).toHaveFocus();

    fireEvent.keyDown(screen.getByLabelText("Digit 3 of 6"), { key: "Backspace" });
    expect(screen.getByLabelText("Digit 2 of 6")).toHaveValue("");
    expect(screen.getByLabelText("Digit 2 of 6")).toHaveFocus();
    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("4");
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

    expect(screen.getByRole("button", { name: /resend code in 60s/i })).toBeDisabled();
  });

  it("keeps an incorrect code on the verification step and advances only after server verification", async () => {
    mockResetRequest();
    const verify = vi.spyOn(services.auth, "verifyReset")
      .mockRejectedValueOnce(new Error("Invalid verification code"))
      .mockResolvedValueOnce(undefined);
    render(<MemoryRouter><PasswordReset /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText("ADMIN USERNAME"), { target: { value: "admin01" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByRole("heading", { name: /verification code/i });
    pasteCode("Digit 1 of 6", "111111");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid verification code");
    expect(screen.getByRole("heading", { name: /verification code/i })).toBeInTheDocument();

    pasteCode("Digit 1 of 6", "222222");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByLabelText("NEW PASSWORD")).toBeInTheDocument();
    expect(verify).toHaveBeenNthCalledWith(1, "admin01", "111111");
    expect(verify).toHaveBeenNthCalledWith(2, "admin01", "222222");
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
    expect(screen.getByRole("button", { name: /login in 3s/i })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: /login in 2s/i })).toBeDisabled();
    vi.useRealTimers();
  });

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

// PasswordReset has no auto-submit yet, so the completion contract is checked on OtpInput directly.
describe("one-time code input completion", () => {
  const renderOtp = () => {
    const onComplete = vi.fn();
    const ref = { current: null as OtpInputHandle | null };
    render(<OtpInput ref={ref} onComplete={onComplete} />);
    return { onComplete, ref };
  };
  const type = (box: number, digit: string) =>
    fireEvent.change(screen.getByLabelText(`Digit ${box} of 6`), { target: { value: digit } });
  const typeCode = (code: string) => [...code].forEach((digit, i) => type(i + 1, digit));

  it("completes once for typed, pasted and autofill-style input", () => {
    const { onComplete } = renderOtp();

    typeCode("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenLastCalledWith("123456");

    pasteCode("Digit 1 of 6", "654321");
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith("654321");

    fireEvent.change(screen.getByLabelText("Digit 1 of 6"), { target: { value: "246810" } });
    expect(onComplete).toHaveBeenCalledTimes(3);
    expect(onComplete).toHaveBeenLastCalledWith("246810");
  });

  it("does not resubmit the same code after deleting and retyping a digit", () => {
    const { onComplete } = renderOtp();

    typeCode("123456");
    type(6, "");
    type(6, "6");
    expect(onComplete).toHaveBeenCalledTimes(1);

    pasteCode("Digit 1 of 6", "123456");
    expect(onComplete).toHaveBeenCalledTimes(1);

    type(6, "7");
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith("123457");
  });

  it("completes the same code again only after the parent clears the input", () => {
    const { onComplete, ref } = renderOtp();

    typeCode("123456");
    act(() => ref.current?.clear());
    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("");
    typeCode("123456");
    expect(onComplete).toHaveBeenCalledTimes(2);
  });
});
