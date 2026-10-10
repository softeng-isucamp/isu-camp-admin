import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";
import { expired, exhausted, issued, jsonResponse, mockBackend, settle, wrongCode } from "./testing/recoveryFetch";

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
const useCountdownTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

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

    expect(screen.getByRole("alert")).toHaveTextContent(/used all your attempts.*request a new code/i);
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^verify/i })).toBeNull();
    // Resend is still held back by the cooldown the server reported.
    expect(screen.getByRole("button", { name: "Resend code in 2s" })).toBeDisabled();
    await tickSeconds(2);
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("drops the lifetime sentence once the code is dead", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600 })], [VERIFY]: [exhausted()] });
    await openCodeStep();
    expect(codeHeading()).toHaveAccessibleDescription(/The code expires in 10 minutes\.$/);

    typeCode("111111");
    await settle();

    expect(codeHeading()).not.toHaveAccessibleDescription(/expires/);
  });
});

describe("code step: expiry", () => {
  it.each([
    [600, "The code expires in 10 minutes."],
    [581, "The code expires in 10 minutes."],
    [60, "The code expires in 1 minute."],
    [20, "The code expires in 1 minute."],
  ])("states a %is lifetime in whole minutes under the heading", async (seconds, sentence) => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: seconds })] });
    await openCodeStep();

    expect(codeHeading()).toHaveAccessibleDescription(expect.stringMatching(/^If an account exists for /));
    expect(codeHeading()).toHaveAccessibleDescription(expect.stringContaining(`we sent a 6-digit code to it. ${sentence}`));
  });

  it("shows no visible countdown", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 581 })] });
    await openCodeStep();
    await tickSeconds(1);

    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText(/\d+:\d\d/)).toBeNull();
  });

  it("omits the lifetime sentence and never expires when the server reports no lifetime", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()] });
    await openCodeStep();

    expect(codeHeading()).toHaveAccessibleDescription(/we sent a 6-digit code to it\.$/);
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
    await tickSeconds(1);

    expect(screen.getByRole("alert")).toHaveTextContent("This code has expired");
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^verify/i })).toBeNull();
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
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 1 attempt left.");

    await tickSeconds(3);
    expect(screen.getByRole("alert")).toHaveTextContent(/^This code has expired\. Request a new code to continue\.$/);
    expect(screen.queryByRole("img", { name: "Warning" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/attempts? left/i)).toBeNull();

    await tickSeconds(3);
    expect(screen.getByRole("alert")).toHaveTextContent(/^This code has expired\. Request a new code to continue\.$/);
  });

  it("shows the expired state when the server answers code_expired, even without a timer", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [expired()] });
    await openCodeStep();

    typeCode("123456");
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("This code has expired");
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
    expect(screen.queryByText("This code has expired. Request a new code to continue.")).toBeNull();

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
    expect(screen.getByRole("status")).toHaveTextContent("A new code has been sent");
    expect(screen.queryByRole("alert")).toBeNull();
    expectBoxes("");
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeEnabled();
    expect(box(1)).toHaveFocus();
    expect(codeHeading()).toHaveAccessibleDescription(/The code expires in 2 minutes\.$/);
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
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 4 attempts left.");
  });

  it("restates the lifetime and restarts expiry when the admin resends before the code dies", async () => {
    useCountdownTimers();
    mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 10, resendAfterSeconds: 1 }), issued({ expiresInSeconds: 300, resendAfterSeconds: 1 })],
    });
    await openCodeStep();
    expect(codeHeading()).toHaveAccessibleDescription(/The code expires in 1 minute\.$/);
    await tickSeconds(8);

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    expect(codeHeading()).toHaveAccessibleDescription(/The code expires in 5 minutes\.$/);

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
    expect(screen.getByRole("alert")).toHaveTextContent("This code has expired");

    release(issued({ expiresInSeconds: 600, resendAfterSeconds: 1 }));
    await settle();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("A new code has been sent");
    expect(box(1)).toBeEnabled();
    expect(codeHeading()).toHaveAccessibleDescription(/The code expires in 10 minutes\.$/);
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

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to send the code.");
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
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 4 attempts left.");
  });

  it("drops the new-code confirmation when that code expires", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ resendAfterSeconds: 1 }), issued({ expiresInSeconds: 3 })] });
    await openCodeStep();
    await tickSeconds(1);
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("A new code has been sent.");

    await tickSeconds(3);
    expect(screen.getByRole("alert")).toHaveTextContent("This code has expired");
    expect(screen.queryByText("A new code has been sent.")).toBeNull();
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
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 2 attempts left.");
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
    expect(heading).toHaveAccessibleDescription(/we sent a 6-digit code to it\.$/);
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
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 3 attempts left.");

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("A new code has been sent");
  });
});
