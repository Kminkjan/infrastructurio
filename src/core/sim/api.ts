import { type TerrainParams, generateTerrain } from "../terrain";
import type { Drag, TrackPlan } from "../track/planner";
import type { GroundView } from "../track/ground";
import { type Command, type NetworkView, type Result, createWorld } from "./world";

/**
 * The public surface of the core (architecture, "Core API"): app, tools,
 * render and ui import only this module and `geometry/sample.ts`. D2:
 * construction commands, preview/execute and the network view. D3:
 * `planTrack` (the full planner: one-bend and shift fits, two-bend fits into
 * ports, magnetism, precision). D4 (additive): the grade and structure rules
 * and their constants, and `Drag.heightMode` / `Drag.structure`. `step`,
 * `frame`, `inspect`, `save` and `loadSim` arrive with their slices.
 */

export type { Command, NetworkView, Result } from "./world";
export type { Counts, Reason, ReasonCode, Ref, RuleFamily, StructureChoice } from "../track/validate";
export { MAX_GRADE_PERMILLE, MAX_PIECES, REASON_CODES, RULE_ORDER } from "../track/validate";
export {
  ABUTMENT_DIP_MM,
  ABUTMENT_ZONE_MM,
  GROUND_BAND_MM,
  PORTAL_ZONE_MM,
  TUNNEL_COVER_MM,
  TUNNEL_MIN_PEAK_COVER_MM,
  WATER_CLEARANCE_MM,
  waterDeckMm,
} from "../track/structure";
export { HISTORY_DEPTH } from "../track/history";
// The earthworks rule and the effective ground (D4 feel-check fixes, 2026-09-28): the renderer meshes what the core
// judges against.
export type { GroundView } from "../track/ground";
export type { ChainAdjacency, ChainStep, ChainTopology, ClipPlane, EarthworkLod, EarthworkPiece, Envelope, EnvelopeMode, PieceInput, PieceReach } from "../track/earthworks";
export {
  BED_BELOW_TRACK_M,
  CAP_FADE_M,
  CREST_ROUND_M,
  DAYLIGHT_ROUND_M,
  EARTHWORK_MIN_M,
  FORMATION_HALF_WIDTH_M,
  HEADWALL_RISE,
  LOD1_SCAN_MARGIN_M,
  MAX_REACH_M,
  NEIGHBOUR_SAMPLE_M,
  NO_PLANES,
  REACH_STEP_M,
  SIDE_SLOPE_RUN,
  bedAt,
  chainPlanes,
  conformRule,
  conformedHeightM,
  conforms,
  cutsUnderDeck,
  earthworkPiece,
  earthworkPieces,
  envelopeAt,
  mayNeighbour,
  naturalHeightAtM,
  networkAdjacency,
  nearestOnPiece,
  pointCutReachM,
  reachAt,
  riseAt,
  settleReaches,
  settledPiece,
  slopeRiseM,
  smoothMin,
  takesEarthworks,
  withPlanes,
  withReach,
} from "../track/earthworks";
// The portal's outline (D4 second feel-check fixes, 2026-09-28): the earthworks rule retains the hill behind a
// tunnel portal up to `portalRetainV`, and the renderer draws its portal and hill plug from the same numbers.
export { PORTAL_HALF_WIDTH_M, PORTAL_RETAIN_ABOVE_TOP_M, PORTAL_TOP_V, PORTAL_WING_RUN, portalRetainV, portalSkylineV } from "../track/portal";
export type { Drag, HeightMode, PlanFit, PlanPointMm, TrackPlan } from "../track/planner";
export { DEFAULT_RADIUS_CAP_M, MAGNET_RANGE_NODES } from "../track/planner";
export type { Diff, PieceRecord } from "../track/authored";
export type { Network, NetworkNode, NetworkPiece, Port, Section } from "../network/derive";
export type { NodeRef, Piece, PieceEnd, PieceKey, PieceKind, PieceSpec, Resolution, Structure } from "../geometry/piece";
export { canonicalKey, formatKey, parseKey, pieceFromKey, resolvePiece } from "../geometry/piece";
export type { ArcPrim, BoundsM, LinePrim, RadiusClassM, RenderPrim, ShiftSide, Turn } from "../geometry/templates";
export { CURVE_TURNS, MAX_SPEED_MMS, RADIUS_CLASSES_M, curveVariantCount } from "../geometry/templates";
export type { Axial, Heading, Vec2 } from "../lattice";
export {
  HEADINGS,
  LATTICE_SPACING_M,
  SQRT3,
  axialKey,
  isPrimary,
  nearestNode,
  opposite,
  rotateHeading,
  stepLengthMm,
  stepOf,
  toWorld,
  unit,
} from "../lattice";
export type { Terrain, TerrainParams } from "../terrain";
export {
  DEFAULT_TERRAIN_SIZE,
  generateTerrain,
  groundMmAt,
  heightDmAt,
  isWaterAt,
  nodeOfOffset,
  offsetOfNode,
  terrainBoundsM,
  terrainHash,
} from "../terrain";
// The static diorama's scenario types (D11a), for the scenery, label and bookmark layers.
export type {
  BuildingLot,
  Crop,
  DioramaScenery,
  FenceRun,
  Field,
  ForestField,
  Haystack,
  Landmark,
  LotKind,
  PointMm,
  SplatPath,
  Surface,
  TelegraphPole,
  Town,
  TownSize,
  TreeInstances,
  TreeSpecies,
} from "../scenarios/baltic-diorama";
export { TREE_BIRCH, TREE_PINE, TREE_SPRUCE } from "../scenarios/baltic-diorama";

export interface Scenario {
  readonly terrain: TerrainParams;
}

export interface Sim {
  /** Simulated ticks so far; always 0 until the step lands (S7/S12). */
  readonly tick: number;
  /** Drag → resolved pieces, counts and a label; reads the track, never changes it. */
  planTrack(drag: Drag): TrackPlan;
  /** `execute`'s code path without the commit: never mutates, consumes no IDs. */
  preview(cmd: Command): Result;
  execute(cmd: Command): Result;
  /** Cached per network revision: the same frozen object until an edit changes the track. */
  network(): NetworkView;
  /**
   * The revision's earthworks (D4 feel-check fixes, 2026-09-28): the settled pieces the renderer meshes, the same
   * object until an edit changes the track. The planner and validation judge against the same surface.
   */
  ground(): GroundView;
  /**
   * The effective ground at lattice node (q, r) in integer mm: the terrain as the track's earthworks shape it, or
   * the water surface over a lower bed; undefined off the map. The track tool starts free nodes there.
   */
  groundMm(q: number, r: number): number | undefined;
}

export function createSim(scenario: Scenario): Sim {
  const world = createWorld(generateTerrain(scenario.terrain));
  return Object.freeze({
    get tick() {
      return 0;
    },
    planTrack: (drag: Drag) => world.plan(drag),
    preview: (cmd: Command) => world.run(cmd, false),
    execute: (cmd: Command) => world.run(cmd, true),
    network: () => world.network(),
    ground: () => world.ground(),
    groundMm: (q: number, r: number) => world.groundMm(q, r),
  });
}
