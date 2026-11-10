import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The HTTP adapter is chosen when the service module loads, so opt in first.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "real"));

import { AuthProvider } from "./AuthContext";
import { ForgotPassword } from "./ForgotPassword";
import { issued, mockBackend, settle, verified, wrongCode } from "./testing/recoveryFetch";

const EMAIL = "admin@isu.edu.ph";
const REQUEST = "/api/recovery/request";
const VERIFY = "/api/recovery/verify";
const WITH_COUNT = "Incorrect verification code.";

const box = (position: number) => screen.getByLabelText(`Digit ${position} of 6`);
const typeCode = (code: string) => [...code].forEach((digit, i) => fireEvent.input(box(i + 1), { target: { value: digit } }));
const verifyButton = () => screen.getByRole("button", { name: "Verify" });
const submitForm = () => fireEvent.submit(verifyButton().closest("form")!);

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
});

describe("a rejected code is not sent again unchanged", () => {
  it("keeps Verify disabled and does not spend an attempt on Enter with the same code", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4)] });
    await openCodeStep();
    typeCode("123456");
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(WITH_COUNT);
    expect(sent[VERIFY]).toHaveLength(1);

    expect(verifyButton()).toBeDisabled();
    submitForm();
    fireEvent.keyDown(box(6), { key: "Enter" });
    await settle();

    expect(sent[VERIFY]).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(WITH_COUNT);
    expect(box(1)).toHaveValue("1");
    expect(box(6)).toHaveValue("6");
  });

  it("checks the code again once the boxes have changed and been typed back, since that is an edit", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), wrongCode(3)] });
    await openCodeStep();
    typeCode("123456");
    await settle();
    fireEvent.input(box(6), { target: { value: "" } });
    expect(verifyButton()).toBeEnabled();
    fireEvent.input(box(6), { target: { value: "6" } });
    await settle();
    expect(sent[VERIFY]).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect verification code. You have 3 attempts remaining.");
  });

  it("enables Verify again as soon as the code changes, and sends the new one", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued()], [VERIFY]: [wrongCode(4), verified()] });
    await openCodeStep();
    typeCode("123456");
    await settle();
    expect(verifyButton()).toBeDisabled();

    fireEvent.input(box(6), { target: { value: "" } });
    expect(verifyButton()).toBeEnabled();
    fireEvent.input(box(6), { target: { value: "7" } });
    await settle();

    expect(sent[VERIFY]).toHaveLength(2);
    expect(sent[VERIFY][1]).toEqual({ email: EMAIL, purpose: "password", code: "123457" });
  });

  it("sends a rejected code again once a new code has been requested", async () => {
    const { sent } = mockBackend({ [REQUEST]: [issued(), issued()], [VERIFY]: [wrongCode(4), wrongCode(4)] });
    await openCodeStep();
    typeCode("123456");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await settle();
    typeCode("123456");
    await settle();
    expect(sent[VERIFY]).toHaveLength(2);
  });
});
