import type { Point } from "./geography";

export interface RoadSegment {
  readonly id: string;
  readonly start: Point;
  readonly end: Point;
}

export interface RoadNode {
  readonly id: string;
  readonly position: Point;
}

export interface RoadLink {
  readonly id: string;
  readonly roadSegmentId: string;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly length: number;
}

export interface RoadNetwork {
  readonly segments: readonly RoadSegment[];
  readonly nodes: readonly RoadNode[];
  readonly links: readonly RoadLink[];
}

export interface RoadRoute {
  readonly nodeIds: readonly string[];
  readonly linkIds: readonly string[];
  readonly length: number;
}
