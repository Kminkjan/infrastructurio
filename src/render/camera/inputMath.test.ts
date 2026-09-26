import { describe, expect, it } from "vitest";
import { KEY_PAN_SPEED_PX_S, type PanKeys, stepKeyPan, wheelZoomFactor } from "./inputMath";

const NONE: PanKeys = { left: false, right: false, up: false, down: false };

describe("wheel zoom factor", () => {
  it("zooms by 1.15 per mouse notch, out when scrolling down", () => {
    expect(wheelZoomFactor(100, 0, false)).toBeCloseTo(1 / 1.15, 12);
    expect(wheelZoomFactor(-100, 0, false)).toBeCloseTo(1.15, 12);
    expect(wheelZoomFactor(3, 1, false)).toBeCloseTo(1 / 1.15, 12);
  });

  it("treats a trackpad pinch (ctrl-wheel) with its own rate", () => {
    expect(wheelZoomFactor(-10, 0, true)).toBeCloseTo(Math.exp(0.1), 12);
    expect(wheelZoomFactor(10, 0, true)).toBeLessThan(1);
  });

  it("caps one event at three notches and ignores empty deltas", () => {
    expect(wheelZoomFactor(10_000, 0, false)).toBeCloseTo(1 / 1.15 ** 3, 12);
    expect(wheelZoomFactor(0, 0, false)).toBe(1);
    expect(wheelZoomFactor(Number.NaN, 0, false)).toBe(1);
  });
});

describe("keyboard pan", () => {
  it("moves at 700 CSS px/s at once, with diagonals no faster", () => {
    const v = { vx: 0, vy: 0 };
    expect(stepKeyPan(v, { ...NONE, up: true }, 16, false)).toBe(true);
    expect(v).toEqual({ vx: 0, vy: KEY_PAN_SPEED_PX_S });
    stepKeyPan(v, { ...NONE, up: true, right: true }, 16, false);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(KEY_PAN_SPEED_PX_S, 9);
    expect(v.vx).toBeGreaterThan(0);
    // Opposite keys cancel, so the view glides out as if released.
    const before = Math.hypot(v.vx, v.vy);
    stepKeyPan(v, { ...NONE, left: true, right: true }, 16, false);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(before * 0.9, 9);
  });

  it("glides out at 0.9 per 16 ms after release, then stops", () => {
    const v = { vx: KEY_PAN_SPEED_PX_S, vy: 0 };
    expect(stepKeyPan(v, NONE, 16, false)).toBe(true);
    expect(v.vx).toBeCloseTo(630, 9);
    expect(stepKeyPan(v, NONE, 32, false)).toBe(true);
    expect(v.vx).toBeCloseTo(630 * 0.81, 9);
    let frames = 0;
    while (stepKeyPan(v, NONE, 16, false)) frames++;
    expect(v).toEqual({ vx: 0, vy: 0 });
    expect(frames).toBeLessThan(60);
  });

  it("has no glide under reduced motion", () => {
    const v = { vx: KEY_PAN_SPEED_PX_S, vy: 0 };
    expect(stepKeyPan(v, NONE, 16, true)).toBe(false);
    expect(v).toEqual({ vx: 0, vy: 0 });
  });
});
