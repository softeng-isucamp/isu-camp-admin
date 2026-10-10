import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";
import { Login } from "./AuthPages";
import { expired, issued, jsonResponse, mockBackend, settle, verified, wrongCode } from "./testing/recoveryFetch";

const EMAIL = "admin@isu.edu.ph";
const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";
const RATE_LIMITED = () => jsonResponse({ message: "Too many requests." }, 429, { "Retry-After": "2" });

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

const sendCode = async () => {
  fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByRole("heading", { name: /verification code/i });
};

const positions = [1, 2, 3, 4, 5, 6];
const box = (position: number) => screen.getByLabelText(`Digit ${position} of 6`);
const boxValues = () => positions.map((n) => (box(n) as HTMLInputElement).value).join("");
/** The rejected digits shown in the empty boxes, read from the boxes found by their labels. */
const ghostDigits = () => positions.map((n) => box(n).getAttribute("placeholder") ?? "").join("");
const expectAllInvalid = () => positions.forEach((n) => expect(box(n)).toBeInvalid());
const expectNoneInvalid = () => positions.forEach((n) => expect(box(n)).toBeValid());
const sentCodes = (sent: Record<string, unknown[]>) => (sent[VERIFY] ?? []).map((body) => (body as { code: string }).code);

/** Pastes into box 1 with real clipboard events and waits for the reply to land. */
const pasteIntoFirstBox = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.click(box(1));
  await user.paste(text);
  await settle();
};

const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.change(box(i + 1), { target: { value: digit } }));
const pasteCode = (position: number, text: string) => fireEvent.paste(box(position), { clipboardData: { getData: () => text } });
const tickSecond = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("code step: a rejected code is shown as ghost digits", () => {
  const rejectFirst = async (user: ReturnType<typeof userEvent.setup>, queue = [wrongCode(4), wrongCode(3)]) => {
    const backend = mockBackend({ [REQUEST]: [issued()], [VERIFY]: queue });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "123456");
    return backend;
  };

  it("empties the boxes, shows the rejected digits marked invalid next to the error, and returns focus to box 1", async () => {
    const user = userEvent.setup();
    mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4)] });
    renderForgotPassword();
    await sendCode();
    expectNoneInvalid();
    expect(ghostDigits()).toBe("");

    await pasteIntoFirstBox(user, "123456");

    expect(screen.getByRole("alert")).toHaveTextContent(/^Incorrect code\. 4 attempts left\.$/);
    expect(boxValues()).toBe("");
    expect(ghostDigits()).toBe("123456");
    expectAllInvalid();
    expect(box(1)).toHaveFocus();
  });

  it("keeps the boxes named Digit N of 6, so the ghost digits are not announced as their names", async () => {
    const user = userEvent.setup();
    await rejectFirst(user);

    positions.forEach((n) => expect(screen.getByRole("textbox", { name: `Digit ${n} of 6` })).toBe(box(n)));
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 4 attempts left.");
  });

  it("changes nothing while the admin only moves between the boxes or presses Backspace or Delete", async () => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    await user.keyboard("{ArrowRight}{ArrowLeft}{ArrowRight}{Backspace}{Delete}");
    await user.click(box(4));
    await user.tab();
    await user.tab({ shift: true });
    await settle();

    expect(boxValues()).toBe("");
    expect(ghostDigits()).toBe("123456");
    expectAllInvalid();
    expect(sentCodes(sent)).toEqual(["123456"]);
  });

  it("starts a fresh entry with one typed digit, removes the ghost from every box and sends nothing", async () => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    await user.keyboard("7");
    await settle();

    expect(boxValues()).toBe("7");
    expect(box(2)).toHaveFocus();
    expect(ghostDigits()).toBe("");
    expectNoneInvalid();
    expect(sentCodes(sent)).toEqual(["123456"]);
  });

  it("removes the ghost when a digit is typed in a later box, which then fills like any fresh box", async () => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    await user.click(box(3));
    await user.keyboard("6543");
    await settle();

    expect(boxValues()).toBe("6543");
    expect(ghostDigits()).toBe("");
    expectNoneInvalid();
    expect(sentCodes(sent)).toEqual(["123456"]);
  });

  it("submits only the new digits when a whole new code is typed after a rejection", async () => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    await user.keyboard("654321");
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", "654321"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 3 attempts left.");
  });

  it.each(["365432", "654323"])("submits exactly %s when it is inserted into box 3 by one input event with no keystroke", async (inserted) => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    // Autofill, an IME or insertText: several digits at once, into a box that is empty.
    fireEvent.change(box(3), { target: { value: inserted } });
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", inserted]);
  });

  it("takes a digit equal to the ghost digit as a real value, without a keystroke", async () => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    // A touch keyboard reports only the resulting value; the digit equals the one shown as ghost in this box.
    fireEvent.change(box(3), { target: { value: "3" } });
    await settle();

    expect(box(3)).toHaveValue("3");
    expect(boxValues()).toBe("3");
    expect(ghostDigits()).toBe("");
    expectNoneInvalid();
    expect(sentCodes(sent)).toEqual(["123456"]);
  });

  it("checks the same code again when it is pasted again, and shows it as ghost digits again", async () => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    await pasteIntoFirstBox(user, "123456");

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 3 attempts left.");
    expect(boxValues()).toBe("");
    expect(ghostDigits()).toBe("123456");
    expectAllInvalid();
  });

  it("checks the same code again when it is typed again", async () => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    await user.keyboard("123456");
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
  });

  it("checks a different pasted code, even when the paste starts in a later box or has separators", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3), wrongCode(2)] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "111111");

    await pasteIntoFirstBox(user, "222-222");
    await user.click(box(4));
    await user.paste("333 333");
    await settle();

    expect(sentCodes(sent)).toEqual(["111111", "222222", "333333"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 2 attempts left.");
  });

  it("treats Verify like empty boxes: it asks for the code and sends nothing, leaving the ghost in place", async () => {
    const user = userEvent.setup();
    const { sent } = await rejectFirst(user);

    await user.click(screen.getByRole("button", { name: "Verify" }));
    await settle();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the 6-digit verification code.");
    expect(ghostDigits()).toBe("123456");
  });

  it("sends nothing on its own after a rejection: not on blur, refocus or the passing of time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
    pasteCode(1, "123456");
    await settle();
    expect(sentCodes(sent)).toEqual(["123456"]);

    fireEvent.blur(box(1));
    fireEvent.focus(box(4));
    fireEvent.blur(box(4));
    fireEvent.focus(box(1));
    await tickSecond();
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(boxValues()).toBe("");
    expect(ghostDigits()).toBe("123456");
  });

  it("sends nothing for the old digits on a resend; the boxes come back empty and ready, with no ghost", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sent } = mockBackend({
      [REQUEST]: [issued({ resendAfterSeconds: 1 }), issued()],
      [VERIFY]: [wrongCode(4), wrongCode(3)],
    });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
    pasteCode(1, "123456");
    await settle();
    expect(ghostDigits()).toBe("123456");
    await tickSecond();

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    await tickSecond();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(boxValues()).toBe("");
    expect(ghostDigits()).toBe("");
    expectNoneInvalid();
    expect(box(1)).toHaveFocus();

    // The new code starts fresh, so the same digits are checked against it.
    pasteCode(1, "123456");
    await settle();
    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
  });

  it("sends a code pasted without a click after a rejection, because focus is already in box 1", async () => {
    const user = userEvent.setup();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), verified()] });
    renderForgotPassword();
    await sendCode();
    await pasteIntoFirstBox(user, "111111");

    await user.paste("222222");
    await settle();

    expect(sentCodes(sent)).toEqual(["111111", "222222"]);
  });
});

describe("code step: boxes that are disabled", () => {
  /** A verify reply the test settles by hand, so the boxes stay disabled while the request is pending. */
  const pendingReply = () => {
    let resolve!: (response: Response) => void;
    const reply = new Promise<Response>((done) => {
      resolve = done;
    });
    return { reply, resolve };
  };

  it("ignore a paste while the code is being verified, so the ghost shows the code the server rejected", async () => {
    const { reply, resolve } = pendingReply();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [reply] });
    renderForgotPassword();
    await sendCode();
    pasteCode(1, "123456");
    await settle();
    positions.forEach((n) => expect(box(n)).toBeDisabled());

    pasteCode(1, "654321");
    await settle();
    expect(boxValues()).toBe("123456");

    resolve(wrongCode(4));
    await settle();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(boxValues()).toBe("");
    expect(ghostDigits()).toBe("123456");
    expectAllInvalid();
  });

  it("ignore typed digits, several digits at once and Backspace while the code is being verified", async () => {
    const { reply, resolve } = pendingReply();
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [reply] });
    renderForgotPassword();
    await sendCode();
    pasteCode(1, "123456");
    await settle();

    fireEvent.change(box(3), { target: { value: "9" } });
    fireEvent.change(box(2), { target: { value: "654321" } });
    fireEvent.keyDown(box(6), { key: "Backspace" });
    fireEvent.change(box(6), { target: { value: "" } });
    await settle();
    expect(boxValues()).toBe("123456");

    resolve(wrongCode(4));
    await settle();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(ghostDigits()).toBe("123456");
  });

  it("ignore a paste once the attempts are used up, leaving the boxes empty and sending nothing", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(0), wrongCode(3)] });
    renderForgotPassword();
    await sendCode();
    pasteCode(1, "123456");
    await settle();
    positions.forEach((n) => expect(box(n)).toBeDisabled());

    pasteCode(1, "654321");
    fireEvent.change(box(1), { target: { value: "7" } });
    await settle();

    expect(boxValues()).toBe("");
    expect(ghostDigits()).toBe("");
    expect(sentCodes(sent)).toEqual(["123456"]);
  });

  it("ignore a paste once the code has expired, leaving the boxes empty and sending nothing", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [expired(), wrongCode(3)] });
    renderForgotPassword();
    await sendCode();
    pasteCode(1, "123456");
    await settle();
    positions.forEach((n) => expect(box(n)).toBeDisabled());

    pasteCode(1, "654321");
    await settle();

    expect(boxValues()).toBe("");
    expect(sentCodes(sent)).toEqual(["123456"]);
  });
});

describe("code step: a code entered during a rate-limit wait", () => {
  const openCodeStep = async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
  };

  const endWait = async () => {
    await tickSecond();
    await tickSecond();
    await settle();
  };

  it("is submitted once, automatically, when the wait ends", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "111111");
    await settle();
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();

    // Replace the rate-limited code with a new one while the wait runs.
    pasteCode(1, "222222");
    await settle();
    expect(sentCodes(sent)).toEqual(["111111"]);
    await tickSecond();
    expect(sentCodes(sent)).toEqual(["111111"]);
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["111111", "222222"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect code. 4 attempts left.");

    await tickSecond();
    await tickSecond();
    expect(sentCodes(sent)).toHaveLength(2);
  });

  it("submits the code that was itself rate limited when the wait ends", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), verified()] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();
    await endWait();

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
    expect(screen.getByRole("heading", { name: /create a new password/i })).toBeInTheDocument();
  });

  it("is not submitted by a wait that ends with an incomplete code in the boxes", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();
    fireEvent.keyDown(box(6), { key: "Backspace" });
    fireEvent.change(box(6), { target: { value: "" } });

    await endWait();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });

  it("submits a code retyped box by box during the wait, once, when the wait ends", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "111111");
    await settle();

    typeCode("222222");
    await settle();
    expect(sentCodes(sent)).toEqual(["111111"]);
    await endWait();

    expect(sentCodes(sent)).toEqual(["111111", "222222"]);
  });

  it("leaves only the digit of a one-digit paste into a complete code, and sends nothing when the wait ends", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();
    expect(boxValues()).toBe("123456");

    pasteCode(3, "7");
    expect(boxValues()).toBe("7");
    await endWait();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });

  it("replaces a complete code with a multi-digit paste into any box, keeping at most six digits", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();

    pasteCode(5, "98 7654321");
    expect(boxValues()).toBe("987654");
    await endWait();

    expect(sentCodes(sent)).toEqual(["123456", "987654"]);
  });

  it("ignores a paste with no digits", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();

    pasteCode(3, "abc - ");
    expect(boxValues()).toBe("123456");
    await endWait();

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
  });

  it("treats one typed digit in a complete code as an ordinary edit, and submits the edited code when the wait ends", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    await openCodeStep();
    pasteCode(1, "123456");
    await settle();

    fireEvent.change(box(3), { target: { value: "7" } });
    expect(boxValues()).toBe("127456");
    await endWait();

    expect(sentCodes(sent)).toEqual(["123456", "127456"]);
  });
});

describe("code step: a code that stops being valid", () => {
  const openExpiring = async (queues: Parameters<typeof mockBackend>[0]) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const backend = mockBackend({ [REQUEST]: [issued({ expiresInSeconds: 2 })], ...queues });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
    return backend;
  };

  it("never sends a code that expired during a rate-limit wait, even when the wait ends at the same moment", async () => {
    const { sent } = await openExpiring({ [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    pasteCode(1, "123456");
    await settle();
    await tickSecond();
    await tickSecond();
    await settle();

    expect(sentCodes(sent)).toEqual(["123456"]);
    expect(screen.getByRole("alert")).toHaveTextContent(/code has expired/i);
    expect(box(1)).toBeDisabled();
  });

  it("locks the boxes when the server reports no attempts left on a wrong code", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(0), wrongCode(3)] });
    const user = userEvent.setup();
    renderForgotPassword();
    await sendCode();

    await pasteIntoFirstBox(user, "123456");

    expect(screen.getByRole("alert")).toHaveTextContent(/^You have used all your attempts\. Request a new code to continue\.$/);
    positions.forEach((n) => expect(box(n)).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeInTheDocument();
    expect(sentCodes(sent)).toEqual(["123456"]);
  });
});

describe("code step: completing a code again", () => {
  it("submits the same code when it is completed again by a keystroke after an incomplete wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [RATE_LIMITED(), wrongCode(4)] });
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await settle();
    pasteCode(1, "123456");
    await settle();
    fireEvent.keyDown(box(6), { key: "Backspace" });
    fireEvent.change(box(6), { target: { value: "" } });
    await tickSecond();
    await tickSecond();
    await settle();
    expect(sentCodes(sent)).toEqual(["123456"]);

    fireEvent.change(box(6), { target: { value: "6" } });
    await settle();

    expect(sentCodes(sent)).toEqual(["123456", "123456"]);
  });
});

describe("code step: a failure that is not a wrong code", () => {
  it("still clears the boxes and does not mark them invalid", async () => {
    const user = userEvent.setup();
    const { fetchMock } = mockBackend({ [REQUEST]: [issued()] });
    renderForgotPassword();
    await sendCode();
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });

    await pasteIntoFirstBox(user, "123456");

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(boxValues()).toBe("");
    expectNoneInvalid();
    expect(box(1)).toHaveFocus();
  });
});
