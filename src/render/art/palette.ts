/**
 * The single colour source for the diorama (docs/art-direction.md).
 * Muted, warm late-summer morning. Original palette derived from public-domain
 * 1900 Baltic photochroms; never sample colours from reference-game captures.
 */
export const palette = {
  grass: 0x8fa66b,
  grassLight: 0xa9ba7e,
  grassShade: 0x6e8752,
  spruce: 0x3f5a3c,
  deciduous: 0x7e9a4f,
  soil: 0xa88f6a,
  ballast: 0x8c8578,
  sleeper: 0x5a4636,
  railTop: 0xb7b3aa,
  stucco: 0xe9dfc8,
  roofTile: 0xc0643f,
  water: 0x6f9aa0,
  haze: 0xdcdccb,
  steam: 0xf4f2ec,
  latticeLine: 0xf2f0e6,
  sky: 0xd6e4ec,
  groundBounce: 0x6b6a4e,
  sun: 0xffe8c2,
} as const;

export type PaletteKey = keyof typeof palette;
