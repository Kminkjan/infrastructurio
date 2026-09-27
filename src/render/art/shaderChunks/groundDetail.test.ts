import { describe, expect, it } from "vitest";
import { palette } from "../palette";
import {
  DETAIL_MIX,
  type GroundDetailSettings,
  NO_GROUND_DETAIL,
  TUFT_CELL_M,
  TUFT_RADIUS_M,
  applyGroundDetailSettings,
  createGroundDetailUniforms,
  gdCut,
  gdHash,
  gdNoise,
  groundDetailAlbedo,
  groundDetailColours,
  syncGroundDetailColors,
  tuftAt,
} from "./groundDetail";

const colours = groundDetailColours();
const grass = colours.grass;
const FULL: GroundDetailSettings = {
  patch: 1,
  patchCellM: 16,
  tufts: 0.35,
  meadow: 1,
  meadowM: [22, 34],
  slopeSoil: 1,
  slopeDeg: [32, 17],
  waterline: 1,
};
const only = (s: Partial<GroundDetailSettings>): GroundDetailSettings => ({ ...NO_GROUND_DETAIL, meadowM: FULL.meadowM, slopeDeg: FULL.slopeDeg, ...s });
const changed = (a: readonly number[], b: readonly number[]) => a.some((v, i) => Math.abs(v - (b[i] ?? 0)) > 1e-12);
/** A deterministic scatter of sim plan points over a few hundred metres. */
const points = Array.from({ length: 4000 }, (_, i) => [((i * 7.31) % 400) + 0.37 * (i % 11), ((i * 3.77) % 300) + 0.53 * (i % 7)] as const);
const FLAT = 1;
const HIGH_AND_DRY = 18;

describe("ground detail noise", () => {
  it("hashes to [0, 1) and interpolates smoothly in [0, 1]", () => {
    for (const [x, y] of points.slice(0, 500)) {
      const h = gdHash(Math.floor(x), Math.floor(y));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      const n = gdNoise(x / 3, y / 3);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      // Continuous: a millimetre moves it by almost nothing.
      expect(Math.abs(gdNoise(x / 3 + 1e-3, y / 3) - n)).toBeLessThan(0.01);
    }
    // Integer lattice points take the hash itself.
    expect(gdNoise(4, 9)).toBeCloseTo(gdHash(4, 9), 12);
  });

  it("cuts hard without a pixel footprint and over ±w with one", () => {
    expect([gdCut(-0.1), gdCut(0), gdCut(0.1)]).toEqual([0, 0.5, 1]);
    expect(gdCut(-0.02, 0.02)).toBe(0);
    expect(gdCut(0, 0.02)).toBe(0.5);
    expect(gdCut(0.02, 0.02)).toBe(1);
  });
});

describe("ground detail layers", () => {
  it("returns the grass unchanged with every amount at zero", () => {
    for (const [x, y] of points.slice(0, 200)) {
      expect(groundDetailAlbedo(grass, x, y, 25, FLAT, NO_GROUND_DETAIL, colours)).toEqual([...grass]);
      expect(groundDetailAlbedo(grass, x, y, 10.1, Math.cos(0.7), NO_GROUND_DETAIL, colours)).toEqual([...grass]);
    }
  });

  it("stays a calm variation of the palette's grass: in [0, 1], within a few tenths of it", () => {
    for (const [x, y] of points) {
      for (const h of [10.1, 18, 30, 38]) {
        for (const up of [1, Math.cos(0.3), Math.cos(0.6)]) {
          const out = groundDetailAlbedo(grass, x, y, h, up, FULL, colours);
          for (let i = 0; i < 3; i++) {
            expect(out[i]).toBeGreaterThanOrEqual(0);
            expect(out[i]).toBeLessThanOrEqual(1);
          }
        }
      }
      // On flat, dry grass the tone patches and tufts move it by at most their mix toward light or shade grass.
      const flat = groundDetailAlbedo(grass, x, y, HIGH_AND_DRY, FLAT, only({ patch: 1, patchCellM: 16, tufts: 1 }), colours);
      for (let i = 0; i < 3; i++) {
        const light = (colours.grassLight[i] ?? 0) / (grass[i] ?? 1);
        expect(flat[i]).toBeLessThanOrEqual((grass[i] ?? 0) * (1 + (light - 1) * DETAIL_MIX.light) + 1e-12);
        expect(flat[i]).toBeGreaterThan((grass[i] ?? 0) * 0.6);
      }
    }
  });

  it("draws both lighter and darker tone patches, and leaves most grass as it is", () => {
    const s = only({ patch: 1, patchCellM: 16 });
    let lighter = 0;
    let darker = 0;
    for (const [x, y] of points) {
      const out = groundDetailAlbedo(grass, x, y, HIGH_AND_DRY, FLAT, s, colours);
      if ((out[1] ?? 0) > (grass[1] ?? 0) + 1e-9) lighter++;
      if ((out[1] ?? 0) < (grass[1] ?? 0) - 1e-9) darker++;
    }
    expect(lighter / points.length).toBeGreaterThan(0.05);
    expect(darker / points.length).toBeGreaterThan(0.05);
    expect((lighter + darker) / points.length).toBeLessThan(0.75);
  });

  it("scatters more meadow flecks uphill", () => {
    const s = only({ meadow: 1 });
    const share = (h: number) => points.filter(([x, y]) => changed(groundDetailAlbedo(grass, x, y, h, FLAT, s, colours), grass)).length / points.length;
    expect(share(15)).toBeLessThan(0.05);
    expect(share(36)).toBeGreaterThan(share(28));
    expect(share(28)).toBeGreaterThan(share(15));
    expect(share(36)).toBeLessThan(0.5);
  });

  it("shows soil on slopes steeper than 32° always, gentler than 17° never, and on some in between", () => {
    const s = only({ slopeSoil: 1 });
    const share = (deg: number) =>
      points.filter(([x, y]) => changed(groundDetailAlbedo(grass, x, y, HIGH_AND_DRY, Math.cos((deg * Math.PI) / 180), s, colours), grass)).length / points.length;
    expect(share(10)).toBe(0);
    expect(share(16)).toBe(0);
    expect(share(33)).toBe(1);
    expect(share(24)).toBeGreaterThan(0.1);
    expect(share(24)).toBeLessThan(0.9);
  });

  it("wets a band just above the water level only", () => {
    const s = only({ waterline: 1 });
    for (const [x, y] of points.slice(0, 300)) {
      const wet = groundDetailAlbedo(grass, x, y, 10.2, FLAT, s, colours);
      expect(wet[0]).toBeCloseTo((colours.soil[0] ?? 0) * DETAIL_MIX.wet, 9);
      expect(groundDetailAlbedo(grass, x, y, 10.5, FLAT, s, colours)).toEqual([...grass]);
      expect(groundDetailAlbedo(grass, x, y, 12, FLAT, s, colours, 11.9)).not.toEqual([...grass]);
    }
  });
});

describe("tufts", () => {
  it("cover about π r² of the cells that hold one, and none at density 0", () => {
    let full = 0;
    let none = 0;
    for (const [x, y] of points) {
      full += tuftAt(x, y, 1);
      none += tuftAt(x, y, 0);
    }
    expect(none).toBe(0);
    const expected = (Math.PI * TUFT_RADIUS_M ** 2) / TUFT_CELL_M ** 2;
    expect(full / points.length).toBeGreaterThan(expected * 0.5);
    expect(full / points.length).toBeLessThan(expected * 1.6);
  });

  it("fade out before a tuft shrinks under two pixels", () => {
    const inside = points.find(([x, y]) => tuftAt(x, y, 1) === 1);
    expect(inside).toBeDefined();
    const [x, y] = inside ?? [0, 0];
    const diameter = 2 * TUFT_RADIUS_M;
    expect(tuftAt(x, y, 1, diameter / 6)).toBeGreaterThan(0.5); // 6 px across
    expect(tuftAt(x, y, 1, diameter / 1.4)).toBe(0); // 1.4 px across
  });
});

describe("ground detail uniforms", () => {
  it("take every colour from the palette and a look's amounts", () => {
    const u = createGroundDetailUniforms(FULL, 10);
    expect(u.uGdGrass.value.getHex()).toBe(palette.grass);
    expect(u.uGdGrassLight.value.getHex()).toBe(palette.grassLight);
    expect(u.uGdGrassShade.value.getHex()).toBe(palette.grassShade);
    expect(u.uGdMeadow.value.getHex()).toBe(palette.meadow);
    expect(u.uGdSoil.value.getHex()).toBe(palette.soil);
    expect(u.uGdSlopeCos.value.x).toBeCloseTo(Math.cos((32 * Math.PI) / 180), 12);
    expect(u.uGdSlopeCos.value.y).toBeCloseTo(Math.cos((17 * Math.PI) / 180), 12);
    applyGroundDetailSettings(u, NO_GROUND_DETAIL);
    expect([u.uGdPatch.value, u.uGdTufts.value, u.uGdMeadowAmount.value, u.uGdSlopeSoil.value, u.uGdWaterline.value]).toEqual([0, 0, 0, 0, 0]);
    u.uGdSoil.value.setHex(0);
    syncGroundDetailColors(u);
    expect(u.uGdSoil.value.getHex()).toBe(palette.soil);
  });
});
