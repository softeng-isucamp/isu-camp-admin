import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordReset } from "./AuthPages";
import { services } from "../../services/api";

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("forgot-password and rate-limit integration", () => {
  it("walks username step → code entry → resend countdown → rate-limited resend", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ success: true }));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(
      <MemoryRouter>
        <PasswordReset />
      </MemoryRouter>,
    );

    const usernameInput = screen.getByLabelText("ADMIN USERNAME");
    expect(usernameInput).toHaveAttribute("type", "text");
    expect(screen.getByPlaceholderText("admin01")).toBe(usernameInput);

    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Username is required.",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(usernameInput, { target: { value: "admin01" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reset/request",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "admin01" }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: /verification code/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend code in 60s/i }),
    ).toBeDisabled();
    expect(screen.queryByText(/a new 6-digit verification code/i)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(
      screen.getByRole("button", { name: /resend code in 59s/i }),
    ).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(
      screen.getByRole("button", { name: /resend code in 58s/i }),
    ).toBeDisabled();

    const tickSecond = async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    };
    for (let i = 0; i < 58; i++) {
      await tickSecond();
    }
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    await flushAsync();

  });

  it("maps a second requestReset within the window to the friendly 429 message", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "Too many requests. Please wait 37 seconds." },
          429,
          { "Retry-After": "37" },
        ),
      );

    await expect(
      services.auth.requestReset("admin01"),
    ).resolves.toBeUndefined();
    const error = await services.auth.requestReset("admin01").then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      message: "Too many requests. Please wait 37 seconds.",
      retryAfterSeconds: 37,
    });
  });
});
