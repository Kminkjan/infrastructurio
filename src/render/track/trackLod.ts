/**
 * Track level of detail (art direction "Track", "Readability at the named
 * zoom levels"): below 4 ppm the sleeper pitch falls under about 2–3.6 px and
 * would shimmer, so the far LOD hides the sleepers and the ballast carries a
 * stripe instead. 4 ppm sits inside the mid band (2–5 ppm).
 */
export const TRACK_FAR_LOD_BELOW_PPM = 4;

export type TrackLod = "near" | "far";

export function trackLodForPpm(ppm: number): TrackLod {
  return ppm < TRACK_FAR_LOD_BELOW_PPM ? "far" : "near";
}
