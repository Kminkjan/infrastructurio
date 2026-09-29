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

/**
 * Beyond the wing ends (D4 portal wedges, owner decision 2026-09-29 "Round it off": "Continue the retained hill's gentle
 * 1:1.5 fall past the wing-wall ends and round the crease smoothly (core ground rule + plug), so the cutting blends into
 * the hill with no lit wedge or teeth") the earthworks rule meets the retained hill with a smooth maximum over a height
 * band of up to PORTAL_ROUND_M (`earthworks.ts`, "Portals retain the hill"): about 9 m wide in plan across the valley
 * where the two meet, whose slopes differ by 2/3 there, so the terrain's 1.25 m sub-triangles draw a rounded valley,
 * not a crease in steps. The band is 0 at the portal plane, where the ground in front is the approach's own section and
 * a rounded maximum would stand over it in a step, and grows 1 : 1 behind it.
 */
export const PORTAL_ROUND_M = 3;

/** The smooth maximum's band `t` metres behind the portal plane (see PORTAL_ROUND_M). */
export function portalRoundBandM(t: number): number {
  return t <= 0 ? 0 : t < PORTAL_ROUND_M ? t : PORTAL_ROUND_M;
}

/**
 * Past a tunnel plane beyond the wing ends, where the cutting's rounded end (`earthworks.ts`, "Portal wedges rounded")
 * meets the natural hill, the smooth clamp there (`conformRule`) takes a band up to this wide, not the earthworks'
 * DAYLIGHT_ROUND_M (0.6 m): the end rises at up to 45°, and a 0.6 m band rounded its upper edge over about a metre, less
 * than one 1.25 m sub-triangle. The clamp lies under the natural ground by up to a quarter of its band (0.63 m) along
 * that edge only. Behind the face and the wings the band stays 0.6 m, so the hill the portal retains stays the natural
 * hill within the retained skyline (widened there too, it put the ground up to 0.49 m under that hill at the retained
 * trim's upper edge, over the committed population's tunnel planes; measured 2026-09-29).
 */
export const PORTAL_DAYLIGHT_ROUND_M = 2.5;

function smooth01(e0: number, e1: number, v: number): number {
  const f = v <= e0 ? 0 : v >= e1 ? 1 : (v - e0) / (e1 - e0);
  return f * f * (3 - 2 * f);
}

/**
 * How much of the wider band (PORTAL_DAYLIGHT_ROUND_M) applies `t` metres behind the portal plane and `across` it
 * (0..1), for a portal whose retained skyline meets the approach's section `valleyAcross` from the centreline at the
 * plane (just past the wing ends): none at the plane, nor inside that valley; rising smoothly over 3 m behind the plane
 * and over 3.5 m outward from half a metre inside the valley; fading out from 12 m behind and 16 m across, inside a
 * portal approach's reach.
 */
export function portalDaylightWeight(t: number, across: number, valleyAcross: number): number {
  const a = across < 0 ? -across : across;
  return smooth01(0, 3, t) * (1 - smooth01(12, 15, t)) * smooth01(valleyAcross - 0.5, valleyAcross + 3, a) * (1 - smooth01(16, 20, a));
}
