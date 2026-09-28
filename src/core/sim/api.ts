import { type TerrainParams, generateTerrain } from "../terrain";
import type { Drag, TrackPlan } from "../track/planner";
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
export { GROUND_BAND_MM, PORTAL_ZONE_MM, TUNNEL_COVER_MM, WATER_CLEARANCE_MM } from "../track/structure";
export { HISTORY_DEPTH } from "../track/history";
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
  });
}
