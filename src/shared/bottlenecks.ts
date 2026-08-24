import type { FreightCommodity } from "./economy";
import type { RoadClass } from "./roads";

export interface BottleneckAffectedFlow {
  readonly id: "stone-supply-inbound" | "stone-supply-outbound";
  readonly commodity: FreightCommodity;
  readonly originName: string;
  readonly destinationName: string;
  readonly demandUnitsPerDay: number;
  readonly assignedUnitsPerDay: number;
}

export interface RoadBottleneckSnapshot {
  readonly id: string;
  readonly name: string;
  readonly roadSegmentId: string;
  readonly linkId: string;
  readonly roadClass: RoadClass;
  readonly isMillfordBridge: boolean;
  readonly demand: {
    readonly assignedUnitsPerDay: number;
    readonly excessUnitsPerDay: number;
  };
  readonly capacity: {
    readonly practicalUnitsPerDay: number;
    readonly volumeCapacityRatio: number;
  };
  readonly routeChoice: {
    readonly routeGeneralizedCostHours: number;
    readonly routeLinkCount: number;
    readonly lastAssignmentTick: number;
    readonly nextAssignmentTick: number;
  };
  readonly freeFlowTravelTimeHours: number;
  readonly congestionDelayHours: number;
  readonly affectedFlows: readonly BottleneckAffectedFlow[];
}

export interface BottleneckAnalysisSnapshot {
  readonly roadBottlenecks: readonly RoadBottleneckSnapshot[];
  readonly affectedRouteLinkIds: readonly string[];
}
