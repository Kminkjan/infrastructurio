/**
 * The single colour source for the diorama (docs/art-direction.md "Palette").
 * Muted, warm late-summer morning. Original palette derived from public-domain
 * 1900 Baltic photochroms; never sample colours from reference-game captures.
 * Values are sRGB: write them into vertex colours through `THREE.Color` (linear
 * working space), never as raw bytes, or the diorama comes out washed out.
 *
 * World groups (grass through air) stay muted; information groups (build
 * states, block overlay, signal red and green) are bright on purpose. Paired
 * values (`spruce`/`spruceLight`, the three roof tiles) are the variation
 * sets: code picks or blends among them and never invents a third value.
 * `forestFloor` is the one token not in the design passes' table: in-house
 * tuning for the D11a splat map, recorded in art direction, pending Look Gate A.
 */
const BASE = {
  // grass
  grass: 0x8fa66b,
  grassLight: 0xa9ba7e,
  grassShade: 0x6e8752,
  meadow: 0xc2be7c,
  // forest
  spruce: 0x3f5a3c,
  spruceLight: 0x4f6b45,
  pineCrown: 0x5a7048,
  deciduous: 0x7e9a4f,
  deciduousLight: 0x93a85a,
  birchTrunk: 0xe8e2d0,
  // ground
  soil: 0xa88f6a,
  dirtRoad: 0xb8a07a,
  cobble: 0xa39c90,
  cobbleDark: 0x8e877b,
  rock: 0x9a9486,
  forestFloor: 0x71704f,
  // earthworks-lite (2026-09-27): cut and fill faces, and the formation (bed) beside the ballast
  earthworkFace: 0x9e8a6c,
  earthworkBed: 0x7b705e,
  // structures (D4, 2026-09-28, in-house): stone for viaducts, piers, abutments and portals (masonry near rock,
  // with a darker course for soffits and plinths and a dressed-stone light for coping and voussoirs), painted
  // steel for trusses and girders (near loco, lighter so thin members read), and the dark of a tunnel bore
  masonry: 0xa59d8c,
  masonryDark: 0x857e70,
  masonryLight: 0xc5bda9,
  steel: 0x3b4541,
  tunnelMouth: 0x242520,
  // fields
  rye: 0xc9b26b,
  hay: 0xbfb27a,
  crop: 0x9dae6a,
  fallow: 0xa38b62,
  // track
  ballast: 0x8c8578,
  ballastShoulder: 0x7a7368,
  sleeper: 0x5a4636,
  railTop: 0xb7b3aa,
  railSide: 0x55524d,
  // walls
  stucco: 0xe9dfc8,
  ochre: 0xe3cfa6,
  blush: 0xd9c3b0,
  sage: 0xc9d3c5,
  limeWhite: 0xf1ece0,
  brick: 0x9c5a44,
  timber: 0x8a6e55,
  timberDark: 0x6c5a48,
  // roofs
  roofTile: 0xc0643f,
  roofTileDark: 0xb45a3a,
  roofTileLight: 0xcd7650,
  slate: 0x5e6166,
  shingle: 0x7d6b5a,
  // water
  water: 0x6f9aa0,
  waterDeep: 0x4d7a84,
  foam: 0xd8e3dc,
  // stock (brass is shared with the UI)
  loco: 0x2f3b33,
  brass: 0xb08d57,
  bufferRed: 0x9c3b30,
  coachMaroon: 0x6e3434,
  coachGreen: 0x3f5b4a,
  creamPanel: 0xe6dcc3,
  wagonGrey: 0x6f6a62,
  // air (steam is a ramp from `steam` to `steamEnd` over a puff's life)
  haze: 0xdcdccb,
  steam: 0xf4f2ec,
  steamEnd: 0xcfcac0,
  smoke: 0xb9b4aa,
  // light and grid
  sky: 0xd6e4ec,
  groundBounce: 0x6b6a4e,
  sun: 0xffe8c2,
  latticeLine: 0xf2f0e6,
  // UI
  uiParchment: 0xf3ede0,
  uiBorder: 0xd8ccb4,
  uiInk: 0x3b3a36,
  signalRed: 0xc8453a,
  signalGreen: 0x5e9c5a,
  // D3: the tooltip's middle grade band (green ≤ 1.5 %, amber up to the maximum, red above it)
  signalAmber: 0xd9a13b,
  // build states
  ghostValid: 0xffffff,
  ghostInvalid: 0xe0584c,
  ghostReused: 0x7fd1e8,
  snap: 0x8fd694,
  // D4: the underground x-ray (U) and the outline of hidden decks (H)
  xray: 0x9eb6f2,
  // block overlay (the colour-blind-safe set has no values yet: D7 picks them)
  block1: 0xf2c94c,
  block2: 0x4fc3d9,
  block3: 0xd65db1,
  block4: 0xf08a4b,
  block5: 0x8c7ae6,
  block6: 0xf4f4f4,
} as const;

export type PaletteKey = keyof typeof BASE;

/**
 * The live palette. Read-only to everyone but the dev tweak panel, which may
 * override a value in memory (`setPaletteOverride`) and then rebuild; nothing
 * persists an override, and production builds never call it.
 */
export const palette: { readonly [K in PaletteKey]: number } = { ...BASE };

export const PALETTE_KEYS: readonly PaletteKey[] = Object.freeze(Object.keys(BASE) as PaletteKey[]);

/** The committed value of a key, whatever the tweak panel has done. */
export function basePaletteValue(key: PaletteKey): number {
  return BASE[key];
}

/** Dev tweak panel only: overrides one key in memory (`undefined` restores it). */
export function setPaletteOverride(key: PaletteKey, value: number | undefined): void {
  (palette as Record<PaletteKey, number>)[key] = value ?? BASE[key];
}

/** Keys whose live value differs from the committed one, for the tweak panel's export. */
export function paletteOverrides(): Partial<Record<PaletteKey, number>> {
  const out: Partial<Record<PaletteKey, number>> = {};
  for (const key of PALETTE_KEYS) if (palette[key] !== BASE[key]) out[key] = palette[key];
  return out;
}

/** A palette value as a CSS hex string, for DOM overlays and CSS custom properties. */
export function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

/** A palette value with alpha as a CSS `rgb(r g b / a)` string. */
export function cssRgba(value: number, alpha: number): string {
  return `rgb(${(value >> 16) & 0xff} ${(value >> 8) & 0xff} ${value & 0xff} / ${alpha})`;
}
