import { act } from "@testing-library/react";
import { vi } from "vitest";

/** Shared fetch fake for the recovery page tests (Seam 1). Scenarios stay in each test file. */

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

export type Reply = Response | Promise<Response>;

/** `/api/me` says signed out; each recovery call consumes the next reply queued for its path. */
export const mockBackend = (queues: Partial<Record<string, Reply[]>>) => {
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

export const issued = (timing: { expiresInSeconds?: number; resendAfterSeconds?: number } = {}) =>
  jsonResponse({ success: true, message: "If an account exists, a code has been sent.", ...timing });
export const verified = (username = "admin_justine") => jsonResponse({ success: true, username });
export const wrongCode = (attemptsRemaining?: number) =>
  jsonResponse(
    { success: false, code: "invalid_code", message: "Invalid verification code", ...(attemptsRemaining === undefined ? {} : { attemptsRemaining }) },
    400,
  );
export const exhausted = () =>
  jsonResponse({ success: false, code: "code_exhausted", message: "Too many incorrect codes.", attemptsRemaining: 0 }, 400);
export const expired = () => jsonResponse({ success: false, code: "code_expired", message: "Code expired." }, 400);

/** Lets pending promises resolve; waitFor cannot poll under fake timers. */
export const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
