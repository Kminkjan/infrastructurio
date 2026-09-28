/**
 * A tunnel portal's outline, which the core's earthworks rule and the renderer's portal share (D4 second feel-check
 * fixes, 2026-09-28). Heights are metres above the track height at the portal node, `across` metres from the
 * centreline along the portal plane (either side).
 *
 * The masonry skyline is the face top over the face's half width, then the wing copings falling at the side
 * slopes' 1 : 1.5 (`portalSkylineV`). Behind the face the hill is retained up to PORTAL_RETAIN_ABOVE_TOP_M over it,
 * under the parapet's coping (`portalRetainV`): the earthworks rule starts a tunnel end's headwall there
 * (`earthworks.ts`, "Portals retain the hill"), and the renderer's hill plug stands at the same line. Until then the
 * constants lived in the renderer (`render/structures/dimensions.ts`) while the core's headwall started at the track
 * bed, so the effective ground behind every face lay 3–5 m under the hill the player saw (the diagnosis of the
 * owner's second feel check, 2026-09-28, "Not yet").
 */

/** Half width of the portal face across the track: the face is 8.4 m wide. */
export const PORTAL_HALF_WIDTH_M = 4.2;
/** The face top (the cornice's top) above the track height. */
export const PORTAL_TOP_V = 7.4;
/** The wing copings fall from the face top at this run per unit fall (1 : 1.5, the earthworks' side slopes). */
export const PORTAL_WING_RUN = 1.5;
/** The hill behind the face is retained up to this far above the face top, behind the parapet and under its coping. */
export const PORTAL_RETAIN_ABOVE_TOP_M = 0.25;

/** The masonry skyline above the track height at `across` metres from the centreline: the face top, then the wing copings. */
export function portalSkylineV(across: number): number {
  const u = across < 0 ? -across : across;
  return u <= PORTAL_HALF_WIDTH_M ? PORTAL_TOP_V : PORTAL_TOP_V - (u - PORTAL_HALF_WIDTH_M) / PORTAL_WING_RUN;
}

/** The retained skyline above the track height at `across`: the masonry skyline plus PORTAL_RETAIN_ABOVE_TOP_M (7.65 m over the face). */
export function portalRetainV(across: number): number {
  return portalSkylineV(across) + PORTAL_RETAIN_ABOVE_TOP_M;
}
