import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { App } from "../../App";
import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";
import { Login } from "./AuthPages";
import { emailNotFound, issued, jsonResponse, mockBackend, settle, verified, wrongCode } from "./testing/recoveryFetch";

const RECOVERY_RATE_LIMIT_MESSAGE = "Too many attempts. Please try again when the restriction ends.";

const EMAIL = "admin@isu.edu.ph";

const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";
const RESET = "/api/recovery/reset-password";

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
  fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByRole("heading", { name: /verification code/i });
};

const box = (position: number) => screen.getByLabelText(`Digit ${position} of 6`);
const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.input(box(i + 1), { target: { value: digit } }));
const pasteCode = (position: number, text: string) =>
  fireEvent.paste(box(position), { clipboardData: { getData: () => text } });
const expectBoxes = (code: string) => [1, 2, 3, 4, 5, 6].forEach((position) => expect(box(position)).toHaveValue(code[position - 1] ?? ""));

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
  it("refuses an address on no administrator account and stays on the email step", async () => {
    const { sent } = mockBackend({ [REQUEST]: [emailNotFound()] });
    renderForgotPassword();
    // The rule is stated before the address is typed, and again as the refusal if it is wrong.
    expect(screen.getByText(/An email that is not on an administrator account is refused\./)).toBeInTheDocument();
    const email = screen.getByLabelText("Admin email");

    fireEvent.change(email, { target: { value: "nobody@isu.edu.ph" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That email is not registered to an administrator account. Check the address and try again.",
    );
    expect(sent[REQUEST]).toEqual([{ email: "nobody@isu.edu.ph", purpose: "password" }]);
    // No code was sent, so there is no code step to advance to.
    expect(screen.queryByRole("heading", { name: /verification code/i })).toBeNull();
    // The address is the field's own problem, like a malformed one.
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(/not registered to an administrator account/);
  });

  it("clears the refusal once the address is corrected", async () => {
    mockBackend({ [REQUEST]: [emailNotFound()] });
    renderForgotPassword();
    const email = screen.getByLabelText("Admin email");

    fireEvent.change(email, { target: { value: "nobody@isu.edu.ph" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByRole("alert");

    fireEvent.change(email, { target: { value: EMAIL } });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(email).not.toHaveAttribute("aria-invalid");
  });

  it("states what the email step will do with a registered address", () => {
    mockBackend({});
    renderForgotPassword();

    expect(screen.getByText(/primary or alternative email associated with your administrator account/i)).toBeInTheDocument();
    expect(screen.getByText(/We'll send a/)).toBeInTheDocument();
  });

  it("names no wait and keeps Send code usable when a 429 has no Retry-After", async () => {
    mockBackend({ [REQUEST]: [jsonResponse({ message: "Too many recovery requests." }, 429)] });
    renderForgotPassword();

    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/^Too many attempts\. Please wait a moment and try again\.$/);
    expect(screen.queryByRole("button", { name: /try again in/i })).toBeNull();
    expect(screen.getByRole("button", { name: /send code/i })).toBeEnabled();
  });


  it("rejects an empty or malformed email before sending anything", () => {
    const { fetchMock } = mockBackend({});
    renderForgotPassword();

    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");

    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: "admin.isu.edu.ph" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining(REQUEST), expect.anything());
  });

  it("ties a rejected email to the alert and clears both once the admin edits the address", () => {
    mockBackend({});
    renderForgotPassword();
    const email = screen.getByLabelText("Admin email");

    fireEvent.change(email, { target: { value: "admin.isu.edu.ph" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter a valid email address.");

    fireEvent.change(email, { target: { value: "admin@isu.edu.ph" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(email).not.toHaveAttribute("aria-invalid");
  });

  it("sends the trimmed email with the password purpose and confirms generically on the code step", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()] });
    renderForgotPassword();

    await sendCodeTo(`  ${EMAIL} `);

    expect(sent[REQUEST]).toEqual([{ email: EMAIL, purpose: "password" }]);
    expect(screen.getByText(/verification code has been sent to/i)).toHaveTextContent(EMAIL);
    expect(box(1)).toHaveValue("");
  });

  it.each([
    ["an empty body", ""],
    ["an HTML error page", "<html><body>Too Many Requests</body></html>"],
  ])("still counts down from Retry-After when a 429 has %s", async (_name, body) => {
    mockBackend({ [REQUEST]: [new Response(body, { status: 429, headers: { "Retry-After": "5" } })] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    renderForgotPassword();

    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(RECOVERY_RATE_LIMIT_MESSAGE);
    expect(screen.getByRole("button", { name: "Try again in 5s" })).toBeDisabled();
  });

  it("reports an unreachable backend when a non-429 error has no JSON body", async () => {
    mockBackend({ [REQUEST]: [new Response("<html>Bad Gateway</html>", { status: 502 })] });
    renderForgotPassword();

    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the ISU-CAMP server. Check your connection and try again.");
  });

  it("counts a server rate limit down on the Send code button, with a number-free urgent alert", async () => {
    mockBackend({
      [REQUEST]: [jsonResponse({ message: "Too many requests." }, 429, { "Retry-After": "3" })],
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    renderForgotPassword();

    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    const alert = screen.getByRole("alert");
    // The button carries the live count, so the alert names no number that could disagree with it.
    expect(alert).toHaveTextContent(RECOVERY_RATE_LIMIT_MESSAGE);
    expect(alert).not.toHaveTextContent(/\d/);
    expect(within(alert).getByRole("img", { name: "Warning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again in 3s" })).toBeDisabled();
    await tickSecond();
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();
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
    expect(screen.getByLabelText("Admin email")).toHaveValue("");
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

    fireEvent.input(box(1), { target: { value: "654321" } });
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

  it("keeps the rejected digits as invalid values, refocuses box 1 and says how many attempts are left", async () => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4)] });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect verification code. You have 4 attempts remaining.");
    expectBoxes("111111");
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeInvalid();
    // The alert renders before the passive effect that refocuses box 1 has run.
    await waitFor(() => expect(box(1)).toHaveFocus());
    expect(screen.getByRole("heading", { name: /verification code/i })).toBeInTheDocument();
  });

  it("uses the singular for the last attempt", async () => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(1)] });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();

    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 1 attempt remaining.");
  });

  it("says the code is incorrect, with no count, when the backend sends no attempt count", async () => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode()] });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();

    expect(screen.getByRole("alert")).toHaveTextContent(/^The verification code is incorrect\. Please try again\.$/);
    expect(screen.queryByText(/attempt/i)).toBeNull();
  });

  it("does not resend rejected digits on its own; the same code entered again is checked, and so is Verify on the unedited boxes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3), wrongCode(2), wrongCode(1)] });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    await failVerification();
    await tickSecond();
    await tickSecond();
    expect(sent[VERIFY]).toHaveLength(1);
    expectBoxes("111111");

    // Pasting the same code again is a new entry: the server answers again.
    pasteCode(1, "111111");
    await settle();
    expect(sent[VERIFY]).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 3 attempts remaining.");

    // Typing it again is just as good.
    typeCode("111111");
    await settle();
    expect(sent[VERIFY]).toHaveLength(3);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 2 attempts remaining.");

    // An explicit retry of the unedited rejected code is fine.
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await settle();
    expect(sent[VERIFY]).toHaveLength(4);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 1 attempt remaining.");
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
  ])("says the code is incorrect, with no count, when %s", async (_name, attemptsRemaining) => {
    mockBackend({
      [REQUEST]: [issued()],
      [VERIFY]: [jsonResponse({ success: false, code: "invalid_code", message: "Invalid verification code", attemptsRemaining }, 400)],
    });
    renderForgotPassword();
    await sendCodeTo();

    await failVerification();

    expect(screen.getByRole("alert")).toHaveTextContent(/^The verification code is incorrect\. Please try again\.$/);
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

  it("counts a server rate limit down on the Verify button, keeps the typed code and sends it when the wait ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { sent } = mockBackend({
      [REQUEST]: [issued()],
      [VERIFY]: [jsonResponse({ message: "Too many requests." }, 429, { "Retry-After": "2" }), verified()],
    });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    typeCode("123456");
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(RECOVERY_RATE_LIMIT_MESSAGE);
    expect(within(screen.getByRole("alert")).getByRole("img", { name: "Warning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();
    expectBoxes("123456");
    await tickSecond();
    expect(sent[VERIFY]).toHaveLength(1);
    await tickSecond();
    await settle();

    expect(sent[VERIFY]).toHaveLength(2);
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
  });
});

describe("forgot-password: resend", () => {
  it("disables Resend for the cooldown the server reports, then sends another code and clears the boxes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { sent } = mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 600, resendAfterSeconds: 3 }), issued({ resendAfterSeconds: 3 })],
      [VERIFY]: [wrongCode(4)],
    });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    // The cooldown reads as a sentence, with no button to press until it ends.
    expect(screen.getByText("Resend available in 3s.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resend/i })).toBeNull();
    await tickSecond();
    expect(screen.getByText("Resend available in 2s.")).toBeInTheDocument();
    await tickSecond();
    await tickSecond();

    pasteCode(1, "12");
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(sent[REQUEST]).toEqual([
      { email: EMAIL, purpose: "password" },
      { email: EMAIL, purpose: "password" },
    ]);
    expect(screen.getByText("A new verification code has been sent. Your previous code is no longer valid.")).toBeInTheDocument();
    expectBoxes("");
    expect(screen.getByText("Resend available in 3s.")).toBeInTheDocument();
  });

  it("leaves Resend available when the server reports no cooldown", async () => {
    mockBackend({ [REQUEST]: [issued()] });
    renderForgotPassword();
    await sendCodeTo();

    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("counts a rate-limited resend down on the Resend button", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mockBackend({
      [REQUEST]: [issued(), jsonResponse({ message: "Too many requests. Please wait 2 seconds." }, 429, { "Retry-After": "2" })],
    });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    // The server's own wording names a number; the alert replaces it so only the button counts.
    expect(screen.getByRole("alert")).toHaveTextContent(RECOVERY_RATE_LIMIT_MESSAGE);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/\d/);
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();
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
    expect(screen.getByText(/^Create a new password for your administrator account\./)).toBeInTheDocument();
    expect(screen.getByText(/If your verification code expires before you finish, you'll need to request a new one\./)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Passw0rd!x" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Passw0rd!x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("heading", { name: /password reset successful/i })).toBeInTheDocument();
    expect(screen.getByText("Your password has been reset successfully. You can now sign in with your new password.")).toBeInTheDocument();
    expect(sent[RESET]).toEqual([{ email: EMAIL, code: "000000", password: "Passw0rd!x" }]);

    fireEvent.click(screen.getByRole("button", { name: "Continue to login" }));
    expect(await screen.findByLabelText(/^username$/i)).toHaveValue("admin_justine");
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("checks the two passwords match before sending", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [verified()] });
    renderForgotPassword();
    await reachNewPassword();

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Passw0rd!x" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Passw0rd!y" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

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

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Passw0rd!x" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Passw0rd!x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password is too weak.");
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
  });
});

describe("forgot-password: a code already received", () => {
  const haveCodeFor = (email = EMAIL) => {
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: email } });
    fireEvent.click(screen.getByRole("button", { name: "I already have a code" }));
  };

  const resetWith = async (code: string) => {
    typeCode(code);
    await screen.findByRole("heading", { name: /create a new password/i });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Passw0rd!x" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Passw0rd!x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await screen.findByRole("heading", { name: /password reset successful/i });
  };

  // A code a colleague sent from User Management: asking for another would replace it, so nothing is requested.
  it("goes to code entry without requesting, then verifies and resets with the code already received", async () => {
    const { sent } = mockBackend({ [VERIFY]: [verified()], [RESET]: [verified()] });
    renderForgotPassword();

    haveCodeFor(` ${EMAIL} `);

    expect(await screen.findByRole("heading", { name: /verification code/i })).toHaveAccessibleDescription(
      /^Enter the 6-digit verification code that was sent to admin@isu\.edu\.ph/,
    );
    // Nothing was issued here, so there is no expiry to count and Resend is open at once.
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    await resetWith("123456");
    expect(sent[REQUEST]).toBeUndefined();
    expect(sent[VERIFY]).toEqual([{ email: EMAIL, purpose: "password", code: "123456" }]);
    expect(sent[RESET]).toEqual([{ email: EMAIL, code: "123456", password: "Passw0rd!x" }]);
  });

  it("still reaches code entry once the account's request budget is spent", async () => {
    const { sent } = mockBackend({
      [REQUEST]: [
        jsonResponse(
          { success: false, code: "recovery_restricted", message: "Too many codes have been requested for this email." },
          429,
          { "Retry-After": "900" },
        ),
      ],
      [VERIFY]: [verified()],
      [RESET]: [verified()],
    });
    renderForgotPassword();

    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(await screen.findByRole("button", { name: /try again in/i })).toBeDisabled();

    // The refusal is about new codes; the one already in the inbox is still good.
    fireEvent.click(screen.getByRole("button", { name: "I already have a code" }));
    await screen.findByRole("heading", { name: /verification code/i });
    await resetWith("654321");
    expect(sent[REQUEST]).toHaveLength(1);
    expect(sent[RESET]).toEqual([{ email: EMAIL, code: "654321", password: "Passw0rd!x" }]);
  });

  it("checks the address first and requests nothing for a malformed one", () => {
    const { sent } = mockBackend({});
    renderForgotPassword();

    haveCodeFor("not-an-email");

    expect(screen.getByLabelText("Admin email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("heading", { name: /verification code/i })).toBeNull();
    expect(sent).toEqual({});
  });

  it("says a code was sent, not received, once the admin asks for a new one from code entry", async () => {
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600, resendAfterSeconds: 60 })] });
    renderForgotPassword();
    haveCodeFor();
    await screen.findByRole("heading", { name: /verification code/i });

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));

    expect(await screen.findByRole("status")).toHaveTextContent("A new verification code has been sent.");
    expect(screen.getByRole("heading", { name: /verification code/i })).toHaveAccessibleDescription(
      /^A 6-digit verification code has been sent to admin@isu\.edu\.ph/,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 10:00");
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
    expect(within(document.body).getByLabelText("Admin email")).toBeInTheDocument();
  });
});

describe("recovery by alternative email", () => {
  it("names both addresses in the copy and sends the code only to the one typed", async () => {
    const ALTERNATIVE = "dean.backup@gmail.com";
    const { sent } = mockBackend({ [REQUEST]: [issued()] });
    renderForgotPassword();
    expect(screen.getByText(/primary or alternative email associated with your administrator account/i)).toBeInTheDocument();

    await sendCodeTo(ALTERNATIVE);

    expect(sent[REQUEST]).toEqual([{ email: ALTERNATIVE, purpose: "password" }]);
    expect(screen.getByText(/verification code has been sent to/i)).toHaveTextContent(ALTERNATIVE);
  });
});
