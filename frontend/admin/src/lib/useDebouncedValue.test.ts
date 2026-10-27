import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("lab", 300));
    expect(result.current).toBe("lab");
  });

  it("settles on the last value only after changes pause", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "" },
    });
    rerender({ value: "l" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: "la" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: "lab" });
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("lab");
  });
});
