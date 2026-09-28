/**
 * Structure dimensions (art direction "Structures", D4), metres. Heights are
 * given as `v` above the track height z (the sim node height the track meshes
 * draw from): the rails are drawn up to z + 0.45, the ballast top at z + 0.15 and
 * its base at z − 0.20 (`trackGeometry.ts`), so every deck's top lies at DECK_V
 * under the ballast. Starting values for lookdev, not measured results.
 */

/** Deck top under the ballast base (z − 0.20: TRACK_LIFT_M − BALLAST_DEPTH_M). */
export const DECK_V = -0.2;
/** Half width of a deck to the outer faces of its parapets or trusses. */
export const DECK_HALF_M = 3;
/** Inner face of a masonry parapet: 0.4 m past the 2.2 m ballast base. */
export const PARAPET_INNER_M = 2.6;
/** Parapet top above the track height (0.55 m over the rail tops), and its coping. */
export const PARAPET_TOP_V = 1;
export const COPING_M = 0.12;

/** Pier thickness along the deck (top), and its half width across (0.25 m proud of the deck's faces). */
export const PIER_THICKNESS_M = 1.8;
export const PIER_HALF_WIDTH_M = 3.25;
/** Piers and abutments widen downwards by this run per unit height, each side (1 : 24). */
export const PIER_BATTER = 1 / 24;
/** Cutwater point beyond the pier's end, for piers standing in water. */
export const CUTWATER_M = 1.3;
/** A pier's footprint keeps at least this plan distance from every other track's centreline. */
export const PIER_TRACK_CLEARANCE_M = 3;
/** Piers and abutments reach this far below the lowest ground under them (in water: the bed). */
export const FOOT_SINK_M = 1.2;
export const WATER_FOOT_SINK_M = 0.5;

/** Arch crown (intrados) below the track height: the deck, fill and ring over the crown. */
export const ARCH_CROWN_V = -1.1;
/** Voussoir ring depth around the intrados. */
export const ARCH_RING_M = 0.55;
/** Arch spans: the target, the longest, and the shortest opening drawn as an arch (shorter is solid wall). */
export const ARCH_TARGET_SPAN_M = 12;
export const ARCH_MAX_SPAN_M = 16;
export const ARCH_MIN_OPENING_M = 2.5;
/** The intrados keeps this clear of the ground at its springings; a smaller rise than ARCH_MIN_RISE_M is solid wall. */
export const ARCH_GROUND_CLEARANCE_M = 0.4;
export const ARCH_MIN_RISE_M = 0.6;

/** Steel spans (girders and trusses) sit on bearings at this level: the pier or abutment top. */
export const STEEL_SEAT_V = -1.4;
/** Where a steel span's structure starts and ends beyond a support's centre (the bearing over the pier top). */
export const STEEL_END_M = 0.3;
/** Plate girders: web centre across the deck. */
export const GIRDER_WEB_M = 2.8;
/** Warren truss planes across the deck, and the bottom chord's centre level. */
export const TRUSS_PLANE_M = 2.95;
export const TRUSS_BOTTOM_V = -0.95;

/** Longest truss span before piers go into the water; the target for trusses over land above VIADUCT_MAX_HEIGHT_M. */
export const TRUSS_MAX_SPAN_M = 80;
/** A truss span shorter than this merges into a neighbouring truss while the merged span stays within TRUSS_MAX_SPAN_M. */
export const TRUSS_SHORT_M = 25;
export const TRUSS_LAND_TARGET_M = 40;
/** Rule 2 (art direction "Structures"): a clear span over this is a truss. */
export const GIRDER_MAX_SPAN_M = 30;
/** Stone arch viaducts over land up to this clearance (art direction: 4–20 m); above it, trusses on masonry piers. */
export const VIADUCT_MAX_HEIGHT_M = 20;

/** Abutment: back into the approach behind the run's end, and its face over the end (the first pier's half thickness). */
export const ABUTMENT_BACK_M = 3.5;
export const ABUTMENT_HALF_WIDTH_M = 3.3;

/** Portal face: half width, the bore's half width, its springing and the face top above the track height. */
export const PORTAL_HALF_WIDTH_M = 4.2;
export const BORE_HALF_M = 2.6;
export const BORE_SPRING_V = 3.6;
export const PORTAL_TOP_V = 7.4;
export const PORTAL_PARAPET_M = 0.6;
/** Face and wing wall thickness into the hill. */
export const PORTAL_WALL_M = 1;
/** Portal wings fall at the earthworks' side slope (1 : 1.5) from the face top. */
export const PORTAL_WING_RUN = 1.5;
export const PORTAL_MAX_WING_M = 25;
/** How far the dark bore is drawn into the hill behind the face (enough to read as dark from any yaw). */
export const BORE_DEPTH_M = 4.5;
