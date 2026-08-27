import type { Point } from "./geography";

export type RailTerminalSite = "quarry" | "stoneworks" | "market";

/** Authoritative authored track geometry retained in saves. */
export interface RailTrackSegment {
  readonly id: string;
  readonly start: Point;
  readonly end: Point;
}

/** A player-placed freight terminal anchored to a compatible scenario site. */
export interface FreightRailTerminalState {
  readonly id: string;
  readonly site: RailTerminalSite;
  readonly siteId: string;
}

export interface RailTrackSnapshot extends RailTrackSegment {
  readonly length: number;
  readonly capacityTonsPerDay: number;
  readonly freeFlowTravelTimeHours: number;
  readonly constructionCost: number;
  readonly maintenanceCostPerDay: number;
}

export interface FreightRailTerminalSnapshot
  extends FreightRailTerminalState {
  readonly name: string;
  readonly position: Point;
  readonly capacityTonsPerDay: number;
  readonly freeFlowTransferTimeHours: number;
  readonly constructionCost: number;
  readonly maintenanceCostPerDay: number;
}

export interface RailNode {
  readonly id: string;
  readonly position: Point;
}

export interface RailLink {
  readonly id: string;
  readonly railTrackId: string;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly length: number;
  readonly capacityTonsPerDay: number;
  readonly freeFlowTravelTimeHours: number;
}

export interface RailNetwork {
  readonly tracks: readonly RailTrackSnapshot[];
  readonly terminals: readonly FreightRailTerminalSnapshot[];
  readonly nodes: readonly RailNode[];
  readonly links: readonly RailLink[];
}

export interface RailRoute {
  readonly originTerminalId: string;
  readonly destinationTerminalId: string;
  readonly nodeIds: readonly string[];
  readonly linkIds: readonly string[];
  readonly length: number;
  readonly trackTravelTimeHours: number;
  readonly terminalTransferTimeHours: number;
  readonly freeFlowTravelTimeHours: number;
  readonly capacityTonsPerDay: number;
}
