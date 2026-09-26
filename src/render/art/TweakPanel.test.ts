import { describe, expect, it } from "vitest";
import { TWEAK_DEFAULTS, tweakExport } from "./TweakPanel";
import { vignetteBackground } from "./vignette";

describe("tweak panel export", () => {
  it("prints nothing but the values that changed", () => {
    expect(JSON.parse(tweakExport(TWEAK_DEFAULTS, {}))).toEqual({ palette: {}, lighting: {} });
  });

  it("prints changed palette keys as hex ready for palette.ts, and changed lighting values", () => {
    const out = JSON.parse(tweakExport({ ...TWEAK_DEFAULTS, exposure: 1.1, sunElevationDeg: 40 }, { grass: 0x8fa66c, sky: 0x00d6e4 }));
    expect(out.palette).toEqual({ grass: "0x8fa66c", sky: "0x00d6e4" });
    expect(out.lighting).toEqual({ exposure: 1.1, sunElevationDeg: 40 });
  });

  it("starts from the committed lighting recipe", () => {
    expect(TWEAK_DEFAULTS.sunElevationDeg).toBeCloseTo(42, 9);
    expect(TWEAK_DEFAULTS.exposure).toBe(1);
    expect(TWEAK_DEFAULTS.shadowIntensity).toBe(0.72);
  });
});

describe("vignette", () => {
  it("darkens only toward the corners, with the strength as corner opacity", () => {
    const css = vignetteBackground(0.3);
    expect(css).toMatch(/^radial-gradient\(/);
    expect(css).toContain("/ 0) 55%");
    expect(css).toContain("/ 0.3) 100%");
    expect(vignetteBackground(2)).toContain("/ 1) 100%");
  });
});
