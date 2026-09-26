import { describe, expect, it } from "vitest";
import { Color } from "three";
import { palette } from "../palette";
import { FURROW_FADE_CYCLES_PER_PX, FURROW_SPACING_M, createSplatUniforms, furrowNormals, furrowStripe, splatAlbedo, syncSplatColors } from "./splat";

const rgb = (hex: number): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
const colours = {
  grassRef: rgb(palette.grass),
  forestFloor: rgb(palette.forestFloor),
  field: rgb(palette.rye),
  dirt: rgb(palette.dirtRoad),
  cobble: rgb(palette.cobble),
};
const none = { dirt: 0, cobble: 0, field: 0, forestFloor: 0 };

describe("terrain splat", () => {
  it("leaves grass alone where every weight is zero", () => {
    expect(splatAlbedo(colours.grassRef, none, colours)).toEqual(colours.grassRef);
  });

  it("paints the full surface colour at weight one on reference grass", () => {
    const dirt = splatAlbedo(colours.grassRef, { ...none, dirt: 1 }, colours);
    dirt.forEach((v, i) => expect(v).toBeCloseTo(colours.dirt[i]!, 12));
  });

  it("keeps the baked shading: darker grass under a road gives a darker road", () => {
    const shaded = colours.grassRef.map((v) => v * 0.8) as [number, number, number];
    const dirt = splatAlbedo(shaded, { ...none, dirt: 1 }, colours);
    dirt.forEach((v, i) => expect(v).toBeCloseTo(colours.dirt[i]! * 0.8, 12));
  });

  it("lays cobble over dirt over field over forest floor", () => {
    const all = splatAlbedo(colours.grassRef, { dirt: 1, cobble: 1, field: 1, forestFloor: 1 }, colours);
    all.forEach((v, i) => expect(v).toBeCloseTo(colours.cobble[i]!, 12));
  });

  it("draws furrows as stripes across the field heading, 1.4 m apart", () => {
    for (let k = 0; k < 6; k++) {
      const n = furrowNormals()[k]!;
      // Along the furrow the stripe is constant; across it, it repeats every spacing.
      const along = { x: n.y, y: -n.x };
      expect(furrowStripe(3 * along.x, 3 * along.y, k)).toBeCloseTo(furrowStripe(0, 0, k), 9);
      expect(furrowStripe(1.4 * n.x, 1.4 * n.y, k)).toBeCloseTo(furrowStripe(0, 0, k), 9);
      expect(furrowStripe(0.7 * n.x, 0.7 * n.y, k)).toBeCloseTo(1 - furrowStripe(0, 0, k), 9);
    }
  });

  it("fades furrows to their mean at the pixel Nyquist limit, and leaves them sharp when coarse on screen", () => {
    for (const [x, y] of [[0, 0], [0.35, 0.2], [2.1, -3.3]] as const) {
      for (let k = 0; k < 6; k++) {
        expect(furrowStripe(x, y, k, FURROW_SPACING_M, 0.5)).toBeCloseTo(0.5, 12);
        expect(furrowStripe(x, y, k, FURROW_SPACING_M, 0)).toBe(furrowStripe(x, y, k));
        expect(furrowStripe(x, y, k, FURROW_SPACING_M, FURROW_FADE_CYCLES_PER_PX[0])).toBe(furrowStripe(x, y, k));
      }
    }
    // Part-way through the fade the stripe keeps its sign but loses contrast.
    const sharp = furrowStripe(0, 0, 0) - 0.5;
    const half = furrowStripe(0, 0, 0, FURROW_SPACING_M, 0.4) - 0.5;
    expect(half).toBeCloseTo(sharp / 2, 12);
  });

  it("takes every surface colour from the palette", () => {
    const u = createSplatUniforms();
    expect(u.uSplatDirt.value.getHex()).toBe(palette.dirtRoad);
    expect(u.uSplatCrops.value.map((c) => c.getHex())).toEqual([palette.rye, palette.hay, palette.crop, palette.fallow]);
    u.uSplatDirt.value.setHex(0);
    syncSplatColors(u);
    expect(u.uSplatForestFloor.value.getHex()).toBe(palette.forestFloor);
  });
});
