import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";

const EMAIL = "admin@isu.edu.ph";
const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Reply = Response | Promise<Response>;

const mockBackend = (queues: Partial<Record<string, Reply[]>>) => {
  const sent: Record<string, unknown[]> = {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/me")) return jsonResponse({ authenticated: false });
    const path = Object.keys(queues).find((candidate) => url.endsWith(candidate));
    if (!path) throw new Error(`Unexpected request to ${url}`);
    (sent[path] ??= []).push(JSON.parse(String(init?.body)));
    const next = queues[path]?.shift();
    if (!next) throw new Error(`No reply queued for ${path}`);
    return next;
  });
  return { sent };
};

const issued = (timing: { expiresInSeconds?: number; resendAfterSeconds?: number } = {}) =>
  jsonResponse({ success: true, message: "If an account exists, a code has been sent.", ...timing });
const wrongCode = (attemptsRemaining: number) =>
  jsonResponse({ success: false, code: "invalid_code", message: "Invalid verification code", attemptsRemaining }, 400);
const exhausted = () =>
  jsonResponse({ success: false, code: "code_exhausted", message: "Too many incorrect codes.", attemptsRemaining: 0 }, 400);
const expired = () => jsonResponse({ success: false, code: "code_expired", message: "Code expired." }, 400);

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const tickSeconds = async (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
};

const box = (position: number) => screen.getByLabelText(`Digit ${position} of 6`);
const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.change(box(i + 1), { target: { value: digit } }));
const expectBoxes = (code: string) => [...code].forEach((digit, i) => expect(box(i + 1)).toHaveValue(digit));

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
  fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: EMAIL } });
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

  it("shows no expiry timer once the code is dead", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 600 })], [VERIFY]: [exhausted()] });
    await openCodeStep();
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 10:00");

    typeCode("111111");
    await settle();

    expect(screen.queryByRole("timer")).toBeNull();
  });
});

describe("code step: expiry timer", () => {
  it("counts down as m:ss when the server reports the code lifetime", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 581 })] });
    await openCodeStep();

    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 9:41");
    await tickSeconds(1);
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 9:40");
    await tickSeconds(31);
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 9:09");
  });

  it("shows no timer when the server reports no lifetime", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued()] });
    await openCodeStep();

    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText(/expires in/i)).toBeNull();
    await tickSeconds(5);
    expect(box(1)).toBeEnabled();
  });

  it("disables the boxes with an expired message and a Resend prompt when the timer reaches zero", async () => {
    useCountdownTimers();
    mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 3 })] });
    await openCodeStep();

    await tickSeconds(2);
    expect(box(1)).toBeEnabled();
    await tickSeconds(1);

    expect(screen.getByRole("alert")).toHaveTextContent("This code has expired");
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeDisabled();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^verify/i })).toBeNull();
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
  ])("a successful resend re-enables a dead (%s) code, clears the boxes, restarts the timer and confirms", async (_name, reply) => {
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
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 2:00");
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

  it("restarts a running timer when the admin resends before the code dies", async () => {
    useCountdownTimers();
    mockBackend({
      [REQUEST]: [issued({ expiresInSeconds: 600, resendAfterSeconds: 1 }), issued({ expiresInSeconds: 600, resendAfterSeconds: 1 })],
    });
    await openCodeStep();
    await tickSeconds(30);
    expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 9:30");

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();

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

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to send the code.");
    expect(box(1)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });
});

describe("code step: change email", () => {
  it("returns to the email step with the address kept for editing, then sends to the corrected address", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued(), issued()] });
    useCountdownTimers();
    await openCodeStep();

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    expect(screen.getByLabelText("ADMIN EMAIL")).toHaveValue(EMAIL);
    expect(screen.queryByLabelText("Digit 1 of 6")).toBeNull();

    fireEvent.change(screen.getByLabelText("ADMIN EMAIL"), { target: { value: "other@isu.edu.ph" } });
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

  it("does not steal focus when the page first loads", () => {
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

    expect(document.body).toHaveFocus();
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
