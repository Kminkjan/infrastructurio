import { describe, expect, it } from "vitest";
import indexHtml from "../../../index.html?raw";
import { PALETTE_KEYS, basePaletteValue, cssColor, cssRgba, palette, paletteOverrides, setPaletteOverride } from "./palette";

describe("palette", () => {
  it("holds 24-bit sRGB values only", () => {
    for (const key of PALETTE_KEYS) {
      const v = palette[key];
      expect(Number.isInteger(v) && v >= 0 && v <= 0xffffff, key).toBe(true);
    }
  });

  it("carries the full art-direction table, grass through the block overlay", () => {
    const table: Record<string, number> = {
      grass: 0x8fa66b, grassLight: 0xa9ba7e, grassShade: 0x6e8752, meadow: 0xc2be7c,
      spruce: 0x3f5a3c, spruceLight: 0x4f6b45, pineCrown: 0x5a7048, deciduous: 0x7e9a4f, deciduousLight: 0x93a85a, birchTrunk: 0xe8e2d0,
      soil: 0xa88f6a, dirtRoad: 0xb8a07a, cobble: 0xa39c90, cobbleDark: 0x8e877b, rock: 0x9a9486,
      // earthworks-lite (2026-09-27, in-house like forestFloor; recorded in art direction)
      earthworkFace: 0x9e8a6c, earthworkBed: 0x7b705e,
      rye: 0xc9b26b, hay: 0xbfb27a, crop: 0x9dae6a, fallow: 0xa38b62,
      ballast: 0x8c8578, ballastShoulder: 0x7a7368, sleeper: 0x5a4636, railTop: 0xb7b3aa, railSide: 0x55524d,
      stucco: 0xe9dfc8, ochre: 0xe3cfa6, blush: 0xd9c3b0, sage: 0xc9d3c5, limeWhite: 0xf1ece0, brick: 0x9c5a44, timber: 0x8a6e55, timberDark: 0x6c5a48,
      roofTile: 0xc0643f, roofTileDark: 0xb45a3a, roofTileLight: 0xcd7650, slate: 0x5e6166, shingle: 0x7d6b5a,
      water: 0x6f9aa0, waterDeep: 0x4d7a84, foam: 0xd8e3dc,
      loco: 0x2f3b33, brass: 0xb08d57, bufferRed: 0x9c3b30, coachMaroon: 0x6e3434, coachGreen: 0x3f5b4a, creamPanel: 0xe6dcc3, wagonGrey: 0x6f6a62,
      haze: 0xdcdccb, steam: 0xf4f2ec, steamEnd: 0xcfcac0, smoke: 0xb9b4aa,
      sky: 0xd6e4ec, groundBounce: 0x6b6a4e, sun: 0xffe8c2, latticeLine: 0xf2f0e6,
      uiParchment: 0xf3ede0, uiBorder: 0xd8ccb4, uiInk: 0x3b3a36, signalRed: 0xc8453a, signalGreen: 0x5e9c5a, signalAmber: 0xd9a13b,
      ghostValid: 0xffffff, ghostInvalid: 0xe0584c, ghostReused: 0x7fd1e8, snap: 0x8fd694,
      block1: 0xf2c94c, block2: 0x4fc3d9, block3: 0xd65db1, block4: 0xf08a4b, block5: 0x8c7ae6, block6: 0xf4f4f4,
    };
    for (const [key, value] of Object.entries(table)) expect(palette[key as keyof typeof palette], key).toBe(value);
    // The one in-house token beyond the table (art direction records it).
    expect(PALETTE_KEYS.filter((k) => !(k in table))).toEqual(["forestFloor"]);
  });

  it("keeps index.html's first-paint background equal to the haze", () => {
    expect(indexHtml).toContain(`background: ${cssColor(palette.haze)};`);
  });

  it("formats CSS colours", () => {
    expect(cssColor(0x0a0b0c)).toBe("#0a0b0c");
    expect(cssRgba(palette.uiInk, 0.5)).toBe("rgb(59 58 54 / 0.5)");
  });

  it("lets the tweak panel override a key in memory and restore it", () => {
    setPaletteOverride("grass", 0x123456);
    expect(palette.grass).toBe(0x123456);
    expect(paletteOverrides()).toEqual({ grass: 0x123456 });
    setPaletteOverride("grass", undefined);
    expect(palette.grass).toBe(basePaletteValue("grass"));
    expect(paletteOverrides()).toEqual({});
  });
});
