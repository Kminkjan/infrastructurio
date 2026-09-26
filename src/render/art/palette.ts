/**
 * The single colour source for the diorama (docs/art-direction.md).
 * Muted, warm late-summer morning. Original palette derived from public-domain
 * 1900 Baltic photochroms; never sample colours from reference-game captures.
 * Values are sRGB: write them into vertex colours through `THREE.Color` (linear
 * working space), never as raw bytes, or the diorama comes out washed out.
 */
export const palette = {
  // grass
  grass: 0x8fa66b,
  grassLight: 0xa9ba7e,
  grassShade: 0x6e8752,
  meadow: 0xc2be7c,
  // forest
  spruce: 0x3f5a3c,
  deciduous: 0x7e9a4f,
  // ground
  soil: 0xa88f6a,
  // track
  ballast: 0x8c8578,
  sleeper: 0x5a4636,
  railTop: 0xb7b3aa,
  // walls and roofs
  stucco: 0xe9dfc8,
  roofTile: 0xc0643f,
  // water
  water: 0x6f9aa0,
  waterDeep: 0x4d7a84,
  foam: 0xd8e3dc,
  // air
  haze: 0xdcdccb,
  steam: 0xf4f2ec,
  // light and grid
  latticeLine: 0xf2f0e6,
  sky: 0xd6e4ec,
  groundBounce: 0x6b6a4e,
  sun: 0xffe8c2,
  // UI
  uiParchment: 0xf3ede0,
  uiBorder: 0xd8ccb4,
  uiInk: 0x3b3a36,
} as const;

export type PaletteKey = keyof typeof palette;

/** A palette value as a CSS hex string, for DOM overlays and CSS custom properties. */
export function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}
