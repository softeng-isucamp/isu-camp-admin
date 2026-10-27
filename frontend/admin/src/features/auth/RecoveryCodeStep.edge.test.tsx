import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";
import { expired, exhausted, issued, jsonResponse, mockBackend, settle, verified, wrongCode } from "./testing/recoveryFetch";

const EMAIL = "admin@isu.edu.ph";
const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";

const tickSeconds = async (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
};

const codeHeading = () => screen.getByRole("heading", { name: /verification code/i });
const box = (position: number) => screen.getByLabelText(`Digit ${position} of 6`);
const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.input(box(i + 1), { target: { value: digit } }));
const expectBoxes = (code: string) => [1, 2, 3, 4, 5, 6].forEach((position) => expect(box(position)).toHaveValue(code[position - 1] ?? ""));

/** Fake timers cover the countdowns only, so promises and testing-library polling keep working. */
const useCountdownTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

/** Opens the code step; settles by hand because waitFor cannot poll under fake timers. */
const openCodeStep = async () => {
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <AuthProvider>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await settle();
  expect(screen.getByRole("heading", { name: /verification code/i })).toBeInTheDocument();
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("code step: exhausted code", () => {
  it("disables the boxes, tells the admin to request a new code and makes Resend the main action", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ resendAfterSeconds: 2 })], [VERIFY]: [exhausted()] });
    await openCodeStep();

    typeCode("111111");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(/used all verification attempts for this code.*request a new code/i);
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^verify/i })).toBeNull();
    // Resend is still held back by the cooldown the server reported.
    expect(screen.getByRole("button", { name: "Resend code in 2s" })).toBeDisabled();
    expect(screen.queryByText(/Resend available in/)).toBeNull();
    await tickSeconds(2);
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("hides the expiry countdown once the code is dead", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600 })], [VERIFY]: [exhausted()] });
    await openCodeStep();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 10:00");

    typeCode("111111");
    await settle();

    expect(screen.queryByRole("timer")).toBeNull();
  });
});

describe("code step: expiry", () => {
  it("states the generic instructions under the heading, and that only the newest code works", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600 })] });
    await openCodeStep();

    // The description joins the bold address with a space, so match around it.
    expect(codeHeading()).toHaveAccessibleDescription(
      /^If an account exists for admin@isu\.edu\.ph ?, a 6-digit verification code has been sent to that address\.$/,
    );
    expect(
      screen.getByText("Only the most recently sent code will work. Requesting a new code will invalidate your previous code."),
    ).toBeInTheDocument();
  });

  it.each([
    [600, "10:00", "09:59"],
    [581, "09:41", "09:40"],
    [65, "01:05", "01:04"],
    [9, "00:09", "00:08"],
  ])("counts a %is lifetime down visibly in MM:SS", async (seconds, first, next) => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: seconds })] });
    await openCodeStep();

    expect(screen.getByRole("timer")).toHaveTextContent(`Code expires in ${first}`);
    await tickSeconds(1);
    expect(screen.getByRole("timer")).toHaveTextContent(`Code expires in ${next}`);
  });

  it("keeps the ticking countdown out of live regions", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600 })] });
    await openCodeStep();

    const timer = screen.getByRole("timer");
    // role="timer" is aria-live off by default; nothing must turn it into an announcing region.
    expect(timer).not.toHaveAttribute("aria-live");
    expect(timer.closest("[role=status],[role=alert],[aria-live]")).toBeNull();
  });

  it("omits the lifetime sentence and never expires when the server reports no lifetime", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()] });
    await openCodeStep();

    expect(codeHeading()).toHaveAccessibleDescription(/has been sent to that address\.$/);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText(/expires in/i)).toBeNull();
    await tickSeconds(5);
    expect(box(1)).toBeEnabled();
  });

  it("silently expires the code: boxes lock with an expired message and Resend becomes the main action", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 3 })] });
    await openCodeStep();

    await tickSeconds(2);
    expect(box(1)).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 00:01");
    await tickSeconds(1);

    expect(screen.getByRole("alert")).toHaveTextContent("This verification code has expired");
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^verify/i })).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("drops a wrong code's attempts count when the code expires, and a resend starts without it", async () => {
    useCountdownTimers();
    mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 3 }), issued({ expiresInSeconds: 3 })],
      [VERIFY]: [wrongCode(1)],
    });
    await openCodeStep();
    typeCode("111111");
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 1 attempt remaining.");

    await tickSeconds(3);
    expect(screen.getByRole("alert")).toHaveTextContent(/^This verification code has expired\. Request a new code to continue\.$/);
    expect(screen.queryByRole("img", { name: "Warning" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/attempts? remaining/i)).toBeNull();

    await tickSeconds(3);
    expect(screen.getByRole("alert")).toHaveTextContent(/^This verification code has expired\. Request a new code to continue\.$/);
  });

  it("shows the expired state when the server answers code_expired, even without a timer", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [expired()] });
    await openCodeStep();

    typeCode("123456");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("This verification code has expired");
    expect(box(1)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("lets an in-flight verification finish when the timer runs out underneath it", async () => {
    useCountdownTimers();
    let finish: (response: Response) => void = () => {};
    const { sent } = mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 1 })],
      [VERIFY]: [new Promise<Response>((resolve) => { finish = resolve; })],
    });
    await openCodeStep();

    typeCode("123456");
    await settle();
    await tickSeconds(1);
    expect(screen.queryByText("This verification code has expired. Request a new code to continue.")).toBeNull();

    await act(async () => finish(jsonResponse({ success: true, username: "admin_justine" })));
    expect(sent[VERIFY]).toHaveLength(1);
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
  });
});

describe("code step: resend recovery", () => {
  it.each([
    ["exhausted", () => exhausted()],
    ["expired", () => expired()],
  ])("a successful resend re-enables a dead (%s) code, clears the boxes, states the new lifetime and confirms", async (_name, reply) => {
    useCountdownTimers();
    const { sent } = mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 600, resendAfterSeconds: 1 }), issued({ expiresInSeconds: 120, resendAfterSeconds: 1 })],
      [VERIFY]: [reply()],
    });
    await openCodeStep();
    typeCode("111111");
    await settle();
    await tickSeconds(1);

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(sent[REQUEST]).toEqual([{ email: EMAIL, purpose: "password" }, { email: EMAIL, purpose: "password" }]);
    expect(screen.getByRole("status")).toHaveTextContent("A new verification code has been sent. Your previous code is no longer valid.");
    expect(screen.queryByRole("alert")).toBeNull();
    expectBoxes("");
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeEnabled();
    expect(box(1)).toHaveFocus();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 02:00");
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });

  it("accepts the same digits again on the new code after a resend", async () => {
    useCountdownTimers();
    const { sent } = mockBackend({
      [REQUEST]: [issued({ resendAfterSeconds: 1 }), issued()],
      [VERIFY]: [exhausted(), wrongCode(4)],
    });
    await openCodeStep();
    typeCode("111111");
    await settle();
    await tickSeconds(1);
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    typeCode("111111");
    await settle();

    expect(sent[VERIFY]).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 4 attempts remaining.");
  });

  it("restates the lifetime and restarts expiry when the admin resends before the code dies", async () => {
    useCountdownTimers();
    mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 10, resendAfterSeconds: 1 }), issued({ expiresInSeconds: 300, resendAfterSeconds: 1 })],
    });
    await openCodeStep();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 00:10");
    await tickSeconds(8);
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 00:02");

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 05:00");

    // The first code's 10 s would have run out here; the new code is still live.
    await tickSeconds(5);
    expect(box(1)).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops the expired message when the code runs out while a resend is pending and the resend succeeds", async () => {
    useCountdownTimers();
    let release: (reply: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 3, resendAfterSeconds: 1 }), pending] });
    await openCodeStep();
    await tickSeconds(1);

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await tickSeconds(2);
    expect(screen.getByRole("alert")).toHaveTextContent("This verification code has expired");

    release(issued({ expiresInSeconds: 600, resendAfterSeconds: 1 }));
    await settle();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("A new verification code has been sent. Your previous code is no longer valid.");
    expect(box(1)).toBeEnabled();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 10:00");
  });

  it("keeps the dead state and shows the failure when the resend itself fails", async () => {
    useCountdownTimers();
    mockBackend({
      [REQUEST]: [issued(), jsonResponse({ message: "Unable to send the code." }, 500)],
      [VERIFY]: [expired()],
    });
    await openCodeStep();
    typeCode("123456");
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't send a new code. Please try again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Unable to send the code.");
    expect(box(1)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });
});

describe("code step: messages stay current", () => {
  it("clears the enter-the-code prompt as soon as the admin types", async () => {
    mockBackend({ [REQUEST]: [issued()] });
    await openCodeStep();

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the 6-digit verification code.");

    typeCode("1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a rejected code's message while the admin types the next attempt", async () => {
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4)] });
    await openCodeStep();
    typeCode("111111");
    await settle();

    typeCode("2");
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 4 attempts remaining.");
  });

  it("drops the new-code confirmation when that code expires", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ resendAfterSeconds: 1 }), issued({ expiresInSeconds: 3 })] });
    await openCodeStep();
    await tickSeconds(1);
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("A new verification code has been sent. Your previous code is no longer valid.");

    await tickSeconds(3);
    expect(screen.getByRole("alert")).toHaveTextContent("This verification code has expired");
    expect(screen.queryByText("A new verification code has been sent. Your previous code is no longer valid.")).toBeNull();
  });
});

describe("code step: change email", () => {
  it("returns to the email step with the address kept for editing, then sends to the corrected address", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued(), issued()] });
    useCountdownTimers();
    await openCodeStep();

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    expect(screen.getByLabelText("Admin email")).toHaveValue(EMAIL);
    expect(screen.queryByLabelText("Digit 1 of 6")).toBeNull();

    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: "other@isu.edu.ph" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();

    expect(sent[REQUEST]).toEqual([
      { email: EMAIL, purpose: "password" },
      { email: "other@isu.edu.ph", purpose: "password" },
    ]);
    expect(screen.getByText(/if an account exists for/i)).toHaveTextContent("other@isu.edu.ph");
    expectBoxes("");
  });

  it("is unavailable while a code is being checked", async () => {
    useCountdownTimers();
    mockBackend({
      [REQUEST]: [issued()],
      [VERIFY]: [new Promise<Response>(() => {})],
    });
    await openCodeStep();

    typeCode("123456");
    await settle();

    expect(screen.getByRole("button", { name: "Change email" })).toBeDisabled();
  });
});

describe("code step: urgent attempts", () => {
  it("keeps the same alert and adds a warning icon at 2 or fewer attempts", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(3), wrongCode(2)] });
    await openCodeStep();

    typeCode("111111");
    await settle();
    expect(within(screen.getByRole("alert")).queryByRole("img", { name: "Warning" })).toBeNull();

    typeCode("222222");
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 2 attempts remaining.");
    expect(within(screen.getByRole("alert")).getByRole("img", { name: "Warning" })).toBeInTheDocument();
  });
});

describe("code step: assistive technology", () => {
  it("moves focus to the heading of each step", async () => {
    mockBackend({
      [REQUEST]: [issued(), issued()],
      [VERIFY]: [jsonResponse({ success: true, username: "admin_justine" })],
    });
    useCountdownTimers();
    await openCodeStep();
    expect(screen.getByRole("heading", { name: /verification code/i })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByRole("heading", { name: /reset your password|forgot/i })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
    expect(screen.getByRole("heading", { name: /verification code/i })).toHaveFocus();

    typeCode("000000");
    await settle();
    expect(screen.getByRole("heading", { name: /create a new password/i })).toHaveFocus();
  });

  it("describes the focused heading with the code-sent confirmation", async () => {
    mockBackend({ [REQUEST]: [issued()] });
    useCountdownTimers();
    await openCodeStep();

    const heading = screen.getByRole("heading", { name: /verification code/i });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription(/has been sent to that address\.$/);
  });

  it("keeps the blurred login preview behind the modal out of reach", async () => {
    mockBackend({ [REQUEST]: [issued()] });
    await openCodeStep();

    // The preview is hidden from assistive technology, so its controls must not take keyboard focus either.
    expect(screen.queryByRole("button", { name: "Login" })).toBeNull();
    expect(screen.getByRole("button", { name: "Login", hidden: true }).closest("[inert]")).not.toBeNull();
  });

  it("focuses the email step heading when the page first loads", () => {
    mockBackend({});
    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <AuthProvider>
          <Routes>
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /reset your password/i })).toHaveFocus();
  });

  it("announces the attempts left and the code-sent confirmation in live regions", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued(), issued()], [VERIFY]: [wrongCode(3)] });
    await openCodeStep();

    // The confirmation region exists before its text does, so screen readers announce the change.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    typeCode("111111");
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 3 attempts remaining.");

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("A new verification code has been sent. Your previous code is no longer valid.");
  });
});

describe("code step: resend safeguards", () => {
  it("sends one request when Resend is clicked twice while the first is in flight", async () => {
    useCountdownTimers();
    let release: (reply: Response) => void = () => {};
    const { sent } = mockBackend({
      [REQUEST]: [issued(), new Promise<Response>((resolve) => { release = resolve; })],
    });
    await openCodeStep();

    const resend = screen.getByRole("button", { name: "Resend code" });
    fireEvent.click(resend);
    fireEvent.click(resend);
    await settle();
    expect(sent[REQUEST]).toHaveLength(2);

    release(issued({ resendAfterSeconds: 60 }));
    await settle();
    expect(sent[REQUEST]).toHaveLength(2);
    expect(screen.getByText("Resend available in 60s.")).toBeInTheDocument();
  });

  it("sends one request when the dead-code Resend is clicked twice", async () => {
    useCountdownTimers();
    let release: (reply: Response) => void = () => {};
    const { sent } = mockBackend({
      [REQUEST]: [issued(), new Promise<Response>((resolve) => { release = resolve; })],
      [VERIFY]: [exhausted()],
    });
    await openCodeStep();
    typeCode("111111");
    await settle();

    const resend = screen.getByRole("button", { name: "Resend code" });
    fireEvent.click(resend);
    fireEvent.click(resend);
    release(issued());
    await settle();

    expect(sent[REQUEST]).toHaveLength(2);
  });

  it("keeps the countdown and the typed digits when a resend fails", async () => {
    useCountdownTimers();
    mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 600 }), jsonResponse({ message: "Unable to send the code." }, 500)],
    });
    await openCodeStep();
    await tickSeconds(2);
    typeCode("123");

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't send a new code. Please try again.");
    expectBoxes("123");
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 09:58");
    await tickSeconds(1);
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 09:57");
    expect(screen.queryByText(/no longer valid/)).toBeNull();
  });

  it("keeps the countdown when a resend is rate-limited", async () => {
    useCountdownTimers();
    mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 600 }), jsonResponse({ message: "Please wait." }, 429, { "Retry-After": "30" })],
    });
    await openCodeStep();
    await tickSeconds(1);

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Please try again when the restriction ends.");
    expect(screen.getByRole("button", { name: "Try again in 30s" })).toBeDisabled();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 09:59");
  });
});

describe("code step: rate limits without a duration", () => {
  it("names no wait and leaves Verify usable when a 429 has no Retry-After", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [jsonResponse({ message: "Too many attempts." }, 429)] });
    await openCodeStep();

    typeCode("123456");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(/^Too many attempts\. Please wait a moment and try again\.$/);
    expect(screen.queryByRole("button", { name: /try again in/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });

  it("names no wait on a resend 429 without Retry-After", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued(), jsonResponse({ message: "Please wait." }, 429)] });
    await openCodeStep();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Please wait a moment and try again.");
    expect(screen.queryByRole("button", { name: /try again in/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it.each(["60abc", "15.5", "Wed, 21 Oct 2026 07:28:00 GMT", "0", "-5"])("treats a Retry-After of %j as no duration", async (header) => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [jsonResponse({ message: "Too many attempts." }, 429, { "Retry-After": header })] });
    await openCodeStep();

    typeCode("123456");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Please wait a moment and try again.");
    expect(screen.queryByRole("button", { name: /try again in/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });
});

const restricted = (retryAfter?: string) =>
  jsonResponse(
    { success: false, code: "recovery_restricted", message: "Too many attempts." },
    429,
    retryAfter === undefined ? {} : { "Retry-After": retryAfter },
  );

describe("code step: recovery restriction", () => {
  it("locks Verify and Resend for the same wait and says recovery is restricted", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600 })], [VERIFY]: [restricted("900")] });
    await openCodeStep();

    typeCode("111111");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Account recovery is temporarily restricted after too many attempts. Please try again when the restriction ends.",
    );
    // Verify and Resend both count the restriction down.
    const locked = screen.getAllByRole("button", { name: "Try again in 900s" });
    expect(locked).toHaveLength(2);
    locked.forEach((button) => expect(button).toBeDisabled());
  });

  it("does not send the held code by itself when the restriction ends", async () => {
    useCountdownTimers();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [restricted("3")] });
    await openCodeStep();

    typeCode("111111");
    await settle();
    await tickSeconds(4);
    await settle();

    expect(sent[VERIFY]).toHaveLength(1);
    expectBoxes("111111");
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("keeps Resend locked when the code expires during the restriction, then offers it once the restriction ends", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 5 })], [VERIFY]: [restricted("10")] });
    await openCodeStep();

    typeCode("111111");
    await settle();
    await tickSeconds(6);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This verification code has expired. You can request a new code when the restriction ends.",
    );
    expect(screen.getByRole("button", { name: /^Try again in \d+s$/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Resend code" })).toBeNull();

    await tickSeconds(5);

    expect(screen.getByRole("alert")).toHaveTextContent("This verification code has expired. Request a new code to continue.");
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("locks only Resend when a resend is refused, so the code already sent can still be verified", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued(), restricted("720")], [VERIFY]: [verified()] });
    await openCodeStep();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

    expect(screen.getByRole("button", { name: "Try again in 720s" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();

    typeCode("000000");
    await settle();

    expect(screen.queryByRole("heading", { name: /verification code/i })).toBeNull();
  });

  it("locks Verify as well once a verify is refused by the restriction after a refused resend", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued(), restricted("720")], [VERIFY]: [restricted("700")] });
    await openCodeStep();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    typeCode("111111");
    await settle();

    const locked = screen.getAllByRole("button", { name: "Try again in 700s" });
    expect(locked).toHaveLength(2);
    locked.forEach((button) => expect(button).toBeDisabled());
  });

  it("names no end and locks nothing when the restriction has no Retry-After", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [restricted()] });
    await openCodeStep();

    typeCode("111111");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Account recovery is temporarily restricted after too many attempts. Please try again later.",
    );
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });
});

describe("code step: expiry follows the clock", () => {
  it("expires a code whose lifetime passed while the computer slept", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600 })], [VERIFY]: [] });
    await openCodeStep();

    // A sleeping tab runs no timers, but the clock still moves.
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await tickSeconds(1);

    expect(screen.getByRole("alert")).toHaveTextContent("This verification code has expired");
    expect(box(1)).toBeDisabled();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("gives a resent code its full lifetime even when it matches the seconds still shown", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 2 }), issued({ expiresInSeconds: 1 })] });
    await openCodeStep();
    await tickSeconds(1);
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 00:01");

    // Most of the old code's last second passes before the new code arrives.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(box(1)).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("This verification code has expired");
  });
});

describe("code step: countdown keeps going when the clock seems to stand still", () => {
  it("rearms a tick that reads the same time as the one before", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 2 })] });
    await openCodeStep();

    // An early tick finds the clock where it was; the countdown must still tick on and expire.
    const frozen = Date.now() + 999;
    const spy = vi.spyOn(Date, "now").mockReturnValue(frozen);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
    spy.mockRestore();
    await tickSeconds(2);

    expect(screen.getByRole("alert")).toHaveTextContent("This verification code has expired");
  });
});

describe("code step: leaving the step", () => {
  it("stops the old code's expiry when the admin changes email, and the new code counts on its own", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 3 }), issued({ expiresInSeconds: 600 })] });
    await openCodeStep();
    await tickSeconds(1);

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    await tickSeconds(5);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 10:00");
    await tickSeconds(3);
    expect(box(1)).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not expire anything on the password step once the code is verified", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 2 })], [VERIFY]: [jsonResponse({ success: true, username: "admin_justine" })] });
    await openCodeStep();

    typeCode("000000");
    await settle();
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
    await tickSeconds(3);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByText(/If your verification code expires before you finish/)).toBeInTheDocument();
  });
});
