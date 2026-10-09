import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { App } from "../../App";
import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";
import { Login } from "./AuthPages";

const EMAIL = "admin@isu.edu.ph";

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";
const RESET = "/api/recovery/reset-password";

type Reply = Response | Promise<Response>;

/** `/api/me` says signed out; each recovery call consumes the next reply queued for its path. */
const mockBackend = (queues: Partial<Record<string, Reply[]>>) => {
  const sent: Record<string, unknown[]> = {};
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/me")) return jsonResponse({ authenticated: false });
    const path = Object.keys(queues).find((candidate) => url.endsWith(candidate));
    if (!path) throw new Error(`Unexpected request to ${url}`);
    (sent[path] ??= []).push(JSON.parse(String(init?.body)));
    const next = queues[path]?.shift();
    if (!next) throw new Error(`No reply queued for ${path}`);
    return next;
  });
  return { fetchMock, sent };
};

const issued = (timing: { expiresInSeconds?: number; resendAfterSeconds?: number } = {}) =>
  jsonResponse({ success: true, message: "If an account exists, a code has been sent.", ...timing });
const verified = (username = "admin_justine") => jsonResponse({ success: true, username });
const wrongCode = (attemptsRemaining?: number) =>
  jsonResponse(
    { success: false, code: "invalid_code", message: "Invalid verification code", ...(attemptsRemaining === undefined ? {} : { attemptsRemaining }) },
    400,
  );

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const tickSecond = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

const renderForgotPassword = () =>
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <AuthProvider>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const sendCodeTo = async (email = EMAIL) => {
  fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByRole("heading", { name: /verification code/i });
};

const box = (position: number) => screen.getByLabelText(`Digit ${position} of 6`);
const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.change(box(i + 1), { target: { value: digit } }));
const pasteCode = (position: number, text: string) =>
  fireEvent.paste(box(position), { clipboardData: { getData: () => text } });
const expectBoxes = (code: string) => [...code].forEach((digit, i) => expect(box(i + 1)).toHaveValue(digit));

/** Types a valid code and waits for the wrong-code reply to be shown. */
const failVerification = async () => {
  typeCode("111111");
  await settle();
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("forgot-password: email step", () => {
  it("rejects an empty or malformed email before sending anything", () => {
    const { fetchMock } = mockBackend({});
    renderForgotPassword();

    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");

    fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: "admin.isu.edu.ph" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining(REQUEST), expect.anything());
  });

  it("sends the trimmed email with the password purpose and confirms generically on the code step", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()] });
    renderForgotPassword();

    await sendCodeTo(`  ${EMAIL} `);

    expect(sent[REQUEST]).toEqual([{ email: EMAIL, purpose: "password" }]);
    expect(screen.getByText(/if an account exists for/i)).toHaveTextContent(EMAIL);
    expect(box(1)).toHaveValue("");
  });

  it("shows a countdown on the Send code button when the server rate-limits the request", async () => {
    mockBackend({
      [REQUEST]: [jsonResponse({ message: "Too many requests." }, 429, { "Retry-After": "3" })],
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderForgotPassword();

    fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests.");
    expect(screen.getByRole("button", { name: "Send code in 3s" })).toBeDisabled();
    await tickSecond();
    expect(screen.getByRole("button", { name: "Send code in 2s" })).toBeDisabled();
    await tickSecond();
    await tickSecond();
    expect(screen.getByRole("button", { name: /send code/i })).toBeEnabled();
  });

  it("starts over on a refresh and keeps nothing in browser storage", async () => {
    mockBackend({ [REQUEST]: [issued()] });
    const first = renderForgotPassword();
    await sendCodeTo();

    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);

    first.unmount();
    renderForgotPassword();
    expect(screen.getByLabelText("ADMIN EMAIL")).toHaveValue("");
  });

  it("offers Back to login on every step", async () => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [verified()] });
    renderForgotPassword();

    expect(screen.getByRole("link", { name: "Back to login" })).toHaveAttribute("href", "/login");
    await sendCodeTo();
    expect(screen.getByRole("link", { name: "Back to login" })).toHaveAttribute("href", "/login");
    typeCode("000000");
    await screen.findByRole("heading", { name: /create a new password/i });
    expect(screen.getByRole("link", { name: "Back to login" })).toHaveAttribute("href", "/login");
  });
});

describe("forgot-password: code step", () => {
  it("submits once when the sixth digit is typed", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [verified()] });
    renderForgotPassword();
    await sendCodeTo();

    typeCode("123456");
    await settle();

    expect(sent[VERIFY]).toEqual([{ email: EMAIL, purpose: "password", code: "123456" }]);
  });

  it("submits once for a paste into any box, ignoring spaces and dashes", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4)] });
    renderForgotPassword();
    await sendCodeTo();

    pasteCode(4, "123-456");
    expectBoxes("123456");
    await settle();

    expect(sent[VERIFY]).toEqual([{ email: EMAIL, purpose: "password", code: "123456" }]);
  });

  it("submits once for an autofill-style change that fills every box", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [verified()] });
    renderForgotPassword();
    await sendCodeTo();

    fireEvent.change(box(1), { target: { value: "654321" } });
    await settle();

    expect(sent[VERIFY]).toEqual([{ email: EMAIL, purpose: "password", code: "654321" }]);
  });

  it("locks the boxes and the Verify button while the code is being checked", async () => {
    let finish: (response: Response) => void = () => {};
    mockBackend({
      [REQUEST]: [issued()],
      [VERIFY]: [new Promise<Response>((resolve) => { finish = resolve; })],
    });
    renderForgotPassword();
    await sendCodeTo();

    typeCode("123456");
    await settle();
    expect(box(1)).toBeDisabled();
    expect(box(6)).toBeDisabled();
    expect(screen.getByRole("button", { name: /verifying/i })).toBeDisabled();

    await act(async () => finish(wrongCode(4)));
    expect(box(1)).toBeEnabled();
  });

  it("clears and refocuses the boxes on a wrong code and says how many attempts are left", async () => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4)] });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect code. 4 attempts left.");
    expectBoxes("");
    expect(box(1)).toHaveFocus();
    expect(screen.getByRole("heading", { name: /verification code/i })).toBeInTheDocument();
  });

  it("uses the singular for the last attempt", async () => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(1)] });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();

    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 1 attempt left.");
  });

  it("shows the plain server message when the backend sends no attempt count", async () => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode()] });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();

    expect(screen.getByRole("alert")).toHaveTextContent(/^Invalid verification code$/);
    expect(screen.queryByText(/attempt/i)).toBeNull();
  });

  it("never resubmits a wrong code on its own, even when it is typed again, but Verify retries it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    await failVerification();
    await tickSecond();
    await tickSecond();
    expect(sent[VERIFY]).toHaveLength(1);

    // The same rejected code typed or pasted again is not spent a second time on its own.
    await failVerification();
    pasteCode(1, "111111");
    await settle();
    expect(sent[VERIFY]).toHaveLength(1);
    expectBoxes("111111");

    // Pressing Verify is the admin's explicit retry and does count.
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await settle();
    expect(sent[VERIFY]).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 3 attempts left.");
  });

  it("still auto-submits a different code after one was rejected", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), verified()] });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();
    typeCode("222222");
    await settle();

    expect(sent[VERIFY]).toEqual([
      { email: EMAIL, purpose: "password", code: "111111" },
      { email: EMAIL, purpose: "password", code: "222222" },
    ]);
  });

  it("sends only one request when Verify is clicked while the code is already auto-submitting", async () => {
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [pending] });
    renderForgotPassword();
    await sendCodeTo();

    typeCode("123456");
    fireEvent.click(screen.getByRole("button", { name: /verifying/i }));
    await settle();
    expect(sent[VERIFY]).toHaveLength(1);

    await act(async () => release(verified()));
    expect(sent[VERIFY]).toHaveLength(1);
  });

  it.each([
    ["attemptsRemaining is a string", "3"],
    ["attemptsRemaining is negative", -1],
  ])("falls back to the server message when %s", async (_name, attemptsRemaining) => {
    mockBackend({
      [REQUEST]: [issued()],
      [VERIFY]: [jsonResponse({ success: false, code: "invalid_code", message: "Invalid verification code", attemptsRemaining }, 400)],
    });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();

    expect(screen.getByRole("alert")).toHaveTextContent(/^Invalid verification code$/);
  });

  it("ignores malformed timing fields instead of starting a countdown", async () => {
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: "x", resendAfterSeconds: "60" } as never)] });
    renderForgotPassword();
    await sendCodeTo();

    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("keeps a manual Verify button that rejects an incomplete code without a request", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [verified()] });
    renderForgotPassword();
    await sendCodeTo();

    typeCode("123");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the 6-digit verification code.");
    expect(sent[VERIFY]).toBeUndefined();
  });

  it("counts a server rate limit down on the Verify button and keeps the typed code", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sent } = mockBackend({
      [REQUEST]: [issued()],
      [VERIFY]: [jsonResponse({ message: "Too many requests." }, 429, { "Retry-After": "2" }), verified()],
    });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    typeCode("123456");
    await settle();
    expect(screen.getByRole("button", { name: "Verify in 2s" })).toBeDisabled();
    expectBoxes("123456");
    await tickSecond();
    await tickSecond();

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await settle();
    expect(sent[VERIFY]).toHaveLength(2);
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
  });
});

describe("forgot-password: resend", () => {
  it("disables Resend for the cooldown the server reports, then sends another code and clears the boxes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sent } = mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 600, resendAfterSeconds: 3 }), issued({ resendAfterSeconds: 3 })],
      [VERIFY]: [wrongCode(4)],
    });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    expect(screen.getByRole("button", { name: "Resend code in 3s" })).toBeDisabled();
    await tickSecond();
    expect(screen.getByRole("button", { name: "Resend code in 2s" })).toBeDisabled();
    await tickSecond();
    await tickSecond();

    pasteCode(1, "12");
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(sent[REQUEST]).toEqual([
      { email: EMAIL, purpose: "password" },
      { email: EMAIL, purpose: "password" },
    ]);
    expect(screen.getByText("A new code has been sent.")).toBeInTheDocument();
    expectBoxes("");
    expect(screen.getByRole("button", { name: "Resend code in 3s" })).toBeDisabled();
  });

  it("leaves Resend available when the server reports no cooldown", async () => {
    mockBackend({ [REQUEST]: [issued()] });
    renderForgotPassword();
    await sendCodeTo();

    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("counts a rate-limited resend down on the Resend button", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockBackend({
      [REQUEST]: [issued(), jsonResponse({ message: "Too many requests. Please wait 2 seconds." }, 429, { "Retry-After": "2" })],
    });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests. Please wait 2 seconds.");
    expect(screen.getByRole("button", { name: "Resend code in 2s" })).toBeDisabled();
    await tickSecond();
    await tickSecond();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });
});

describe("forgot-password: new password and return to login", () => {
  const reachNewPassword = async () => {
    await sendCodeTo();
    typeCode("000000");
    await screen.findByRole("heading", { name: /create a new password/i });
  };

  it("resets the password, then returns to login with the username prefilled", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [verified()], [RESET]: [verified("admin_justine")] });
    renderForgotPassword();
    await reachNewPassword();

    fireEvent.change(screen.getByLabelText("NEW PASSWORD"), { target: { value: "Passw0rd!x" } });
    fireEvent.change(screen.getByLabelText("CONFIRM NEW PASSWORD"), { target: { value: "Passw0rd!x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

    expect(await screen.findByRole("heading", { name: /password reset successful/i })).toBeInTheDocument();
    expect(sent[RESET]).toEqual([{ email: EMAIL, code: "000000", password: "Passw0rd!x" }]);

    fireEvent.click(screen.getByRole("button", { name: "Return to login" }));
    expect(await screen.findByLabelText(/^username$/i)).toHaveValue("admin_justine");
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("checks the two passwords match before sending", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [verified()] });
    renderForgotPassword();
    await reachNewPassword();

    fireEvent.change(screen.getByLabelText("NEW PASSWORD"), { target: { value: "Passw0rd!x" } });
    fireEvent.change(screen.getByLabelText("CONFIRM NEW PASSWORD"), { target: { value: "Passw0rd!y" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(sent[RESET]).toBeUndefined();
  });

  it("shows the server's reason when the new password is refused", async () => {
    mockBackend({
      [REQUEST]: [issued()],
      [VERIFY]: [verified()],
      [RESET]: [jsonResponse({ success: false, code: "weak_password", message: "Password is too weak." }, 400)],
    });
    renderForgotPassword();
    await reachNewPassword();

    fireEvent.change(screen.getByLabelText("NEW PASSWORD"), { target: { value: "Passw0rd!x" } });
    fireEvent.change(screen.getByLabelText("CONFIRM NEW PASSWORD"), { target: { value: "Passw0rd!x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password is too weak.");
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
  });
});

describe("old reset-password links", () => {
  it("open the forgot-password flow", async () => {
    mockBackend({});
    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /reset your password/i })).toBeInTheDocument();
    expect(within(document.body).getByLabelText("ADMIN EMAIL")).toBeInTheDocument();
  });
});
