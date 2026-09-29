/**
 * Pick layers (architecture "Picking", step 2): the channels of the
 * never-rendered pick scene's proxies, as three.js layer numbers. The active
 * tool masks them (the track tools ask for TRACK and DECK, and TUNNEL only
 * under the underground x-ray); H drops DECK from the mask, U adds TUNNEL.
 * Channel 0, which every three object starts on, is left out so a proxy never
 * matches by default. D4 fills DECK and TUNNEL; the others arrive with their
 * slices.
 */
export const PICK_LAYER = {
  TERRAIN: 1,
  TRACK: 2,
  DECK: 3,
  TUNNEL: 4,
  SIGNAL: 5,
  STATION: 6,
  DEPOT: 7,
  TRAIN: 8,
} as const;

export type PickLayer = (typeof PICK_LAYER)[keyof typeof PICK_LAYER];

/** A three.js layer mask of the given channels. */
export function pickMask(...layers: readonly PickLayer[]): number {
  let mask = 0;
  for (const l of layers) mask |= 1 << l;
  return mask;
}

/** What the occlusion aids let the track tools pick: decks unless H hides them, tunnels only under U. */
export interface PickVisibility {
  readonly decks: boolean;
  readonly tunnels: boolean;
}

export const DEFAULT_PICK_VISIBILITY: PickVisibility = Object.freeze({ decks: true, tunnels: false });

/** The proxy mask for the track tools under the given aids. */
export function trackToolMask(v: PickVisibility): number {
  return pickMask(PICK_LAYER.TRACK, ...(v.decks ? [PICK_LAYER.DECK] : []), ...(v.tunnels ? [PICK_LAYER.TUNNEL] : []));
}
