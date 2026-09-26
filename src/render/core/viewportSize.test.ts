import { describe, expect, it } from "vitest";
import { computeViewportSize, sameViewportSize } from "./viewportSize";

describe("viewport sizing", () => {
  it("uses exact device pixels when the browser reports them", () => {
    const size = computeViewportSize({ cssWidth: 800.5, cssHeight: 600, devicePixelRatio: 1.25, devicePixelWidth: 1001, devicePixelHeight: 750 });
    expect(size.pixelWidth).toBe(1001);
    expect(size.pixelHeight).toBe(750);
    expect(size.pixelRatio).toBeCloseTo(1001 / 800.5, 12);
  });

  it("caps the pixel ratio at 2, scaling device pixels down", () => {
    const size = computeViewportSize({ cssWidth: 400, cssHeight: 800, devicePixelRatio: 3, devicePixelWidth: 1200, devicePixelHeight: 2400 });
    expect(size.pixelWidth).toBe(800);
    expect(size.pixelHeight).toBe(1600);
    expect(size.pixelRatio).toBe(2);
  });

  it("falls back to css × dpr without device-pixel sizes", () => {
    const size = computeViewportSize({ cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1.5 });
    expect([size.pixelWidth, size.pixelHeight]).toEqual([1920, 1080]);
    const capped = computeViewportSize({ cssWidth: 1280, cssHeight: 720, devicePixelRatio: 4 });
    expect([capped.pixelWidth, capped.pixelHeight]).toEqual([2560, 1440]);
  });

  it("never returns a zero or invalid size", () => {
    const size = computeViewportSize({ cssWidth: 0, cssHeight: 0, devicePixelRatio: Number.NaN });
    expect(size).toEqual({ cssWidth: 1, cssHeight: 1, pixelWidth: 1, pixelHeight: 1, pixelRatio: 1 });
  });

  it("compares sizes by value", () => {
    const a = computeViewportSize({ cssWidth: 10, cssHeight: 10, devicePixelRatio: 1 });
    expect(sameViewportSize(a, { ...a })).toBe(true);
    expect(sameViewportSize(undefined, a)).toBe(false);
    expect(sameViewportSize(a, { ...a, pixelWidth: 11 })).toBe(false);
  });
});
