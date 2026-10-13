import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stepProgress, useSmoothedProgress } from "./useSmoothedProgress";

const STAGE = 0.2;

/** Runs `steps` frames of `dtMs` against a fixed target. */
const run = (start: number, target: number, steps: number, dtMs = 16) => {
  const values = [start];
  for (let index = 0; index < steps; index += 1) {
    values.push(stepProgress(values[values.length - 1], target, STAGE, dtMs));
  }
  return values;
};

describe("stepProgress", () => {
  it("never moves backwards while the target holds or rises", () => {
    let value = 0;
    for (const target of [0, 0, 0.2, 0.2, 0.4, 0.4, 0.6, 0.8, 0.8, 1]) {
      for (let frame = 0; frame < 60; frame += 1) {
        const next = stepProgress(value, target, STAGE, 16);
        expect(next).toBeGreaterThanOrEqual(value);
        value = next;
      }
    }
  });

  it("creeps forward while a stage is in flight but never past the trickle ceiling", () => {
    const values = run(0.2, 0.2, 20_000, 50);

    expect(values[1]).toBeGreaterThan(0.2);
    expect(Math.max(...values)).toBeLessThanOrEqual(0.2 + 0.9 * STAGE);
    expect(values[values.length - 1]).toBeGreaterThan(0.2 + 0.85 * STAGE);
  });

  it("eases up to a raised target instead of jumping to it", () => {
    const [start, first, , , ...rest] = run(0.2, 0.4, 200);

    expect(first).toBeGreaterThan(start);
    expect(first).toBeLessThan(0.4);
    expect(rest[rest.length - 1]).toBeGreaterThanOrEqual(0.4);
  });

  it("reaches exactly 1 on completion, easing rather than snapping", () => {
    const values = run(0.5, 1, 400);

    expect(values[1]).toBeLessThan(1);
    expect(values[values.length - 1]).toBe(1);
    expect(stepProgress(1, 1, STAGE, 16)).toBe(1);
  });

  it("resets when the target drops below what was shown", () => {
    expect(stepProgress(0.9, 0.2, STAGE, 16)).toBe(0.2);
    expect(stepProgress(0.5, 0, STAGE, 16)).toBe(0);
  });

  it("holds still without elapsed time and clamps absurd frame gaps", () => {
    expect(stepProgress(0.3, 0.4, STAGE, 0)).toBe(0.3);
    expect(stepProgress(0.3, 0.4, STAGE, 60_000)).toBeLessThanOrEqual(0.4 + 0.9 * STAGE);
  });
});

describe("useSmoothedProgress", () => {
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  let clock = 0;

  beforeEach(() => {
    frames = new Map();
    clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const advance = (ms: number, count = 1) => {
    for (let index = 0; index < count; index += 1) {
      clock += ms;
      const pending = [...frames.values()];
      frames = new Map();
      act(() => pending.forEach((callback) => callback(clock)));
    }
  };

  it("animates toward the target and keeps climbing to 1 on completion", () => {
    const { result, rerender } = renderHook((props) => useSmoothedProgress(props), {
      initialProps: { target: 0.2, stageSize: STAGE, frozen: false, reduced: false },
    });
    expect(result.current).toBe(0.2);

    advance(500, 4);
    expect(result.current).toBeGreaterThan(0.2);
    expect(result.current).toBeLessThanOrEqual(0.2 + 0.9 * STAGE);

    rerender({ target: 1, stageSize: STAGE, frozen: false, reduced: false });
    advance(100, 80);
    expect(result.current).toBe(1);
  });

  it("follows the target directly under reduced motion", () => {
    const { result, rerender } = renderHook((props) => useSmoothedProgress(props), {
      initialProps: { target: 0.2, stageSize: STAGE, frozen: false, reduced: true },
    });
    rerender({ target: 0.6, stageSize: STAGE, frozen: false, reduced: true });

    expect(result.current).toBe(0.6);
    expect(frames.size).toBe(0);
  });

  it("stands still while frozen on a failure", () => {
    const { result } = renderHook((props) => useSmoothedProgress(props), {
      initialProps: { target: 0.4, stageSize: STAGE, frozen: true, reduced: false },
    });
    advance(500, 4);

    expect(result.current).toBe(0.4);
  });
});
