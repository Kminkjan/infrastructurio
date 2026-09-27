import { describe, expect, it } from "vitest";
import { Color } from "three";
import { palette } from "../palette";
import { EDGE_FADE_WIDTH_M, edgeFadeAt, hazeForToneMapping, neutralToneMap } from "./edgeFade";

const bounds = { minX: 0, minZ: -1494, maxX: 1997.5, maxZ: 0 };

describe("edge fade", () => {
  it("is full haze on the map edge and none from the fade width inward", () => {
    expect(edgeFadeAt(0, -700, bounds)).toBe(1);
    expect(edgeFadeAt(1997.5, -700, bounds)).toBe(1);
    expect(edgeFadeAt(1000, 0, bounds)).toBe(1);
    expect(edgeFadeAt(EDGE_FADE_WIDTH_M, -700, bounds)).toBe(0);
    expect(edgeFadeAt(1000, -700, bounds)).toBe(0);
  });

  it("falls smoothly and monotonically across the band", () => {
    let previous = 1;
    for (let x = 0; x <= EDGE_FADE_WIDTH_M; x += 0.5) {
      const f = edgeFadeAt(x, -700, bounds);
      expect(f).toBeLessThanOrEqual(previous + 1e-12);
      expect(previous - f).toBeLessThan(0.03);
      previous = f;
    }
  });

  it("uses the nearest edge, so corners fade too", () => {
    expect(edgeFadeAt(10, -10, bounds)).toBeCloseTo(edgeFadeAt(10, -700, bounds), 12);
  });

  it("targets the colour that tone mapping turns into the untone-mapped haze background", () => {
    const haze = new Color(palette.haze);
    for (const exposure of [1, 0.8, 1.2]) {
      const pre = hazeForToneMapping(haze, exposure);
      const out = neutralToneMap([pre.r, pre.g, pre.b], exposure);
      expect(out[0]).toBeCloseTo(haze.r, 6);
      expect(out[1]).toBeCloseTo(haze.g, 6);
      expect(out[2]).toBeCloseTo(haze.b, 6);
    }
  });

  it("mirrors three's NeutralToneMapping on both branches", () => {
    // Constant offset for bright-enough colours, below the compression start.
    expect(neutralToneMap([0.5, 0.4, 0.3])).toEqual([0.46, 0.36000000000000004, 0.26]);
    // Quadratic offset for dark colours.
    const dark = neutralToneMap([0.05, 0.05, 0.05]);
    expect(dark[0]).toBeCloseTo(0.05 - (0.05 - 6.25 * 0.0025), 12);
    // Compression keeps highlights below 1.
    expect(Math.max(...neutralToneMap([3, 2, 1]))).toBeLessThan(1);
  });
});
