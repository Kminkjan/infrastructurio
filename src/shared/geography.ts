export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface MapBounds {
  readonly width: number;
  readonly height: number;
}

export interface RiverGeography {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly path: readonly Point[];
}

export interface CrossingAreaGeography {
  readonly id: string;
  readonly name: string;
  readonly center: Point;
  readonly width: number;
  readonly height: number;
}

export interface QuarryGeography {
  readonly id: string;
  readonly name: string;
  readonly position: Point;
}

export interface StoneworksGeography {
  readonly id: string;
  readonly name: string;
  readonly position: Point;
}

export interface FertileLandGeography {
  readonly id: string;
  readonly name: string;
  readonly boundary: readonly Point[];
}

export interface SettlementSeedGeography {
  readonly id: string;
  readonly name: string;
  readonly position: Point;
}

export interface ExternalMarketConnectionGeography {
  readonly id: string;
  readonly name: string;
  readonly position: Point;
  readonly mapEdge: "north" | "east" | "south" | "west";
}

export interface ScenarioGeography {
  readonly scenarioId: string;
  readonly seed: string;
  readonly bounds: MapBounds;
  readonly river: RiverGeography;
  readonly crossingArea: CrossingAreaGeography;
  readonly quarry: QuarryGeography;
  readonly stoneworks: StoneworksGeography;
  readonly fertileLand: FertileLandGeography;
  readonly settlementSeeds: readonly SettlementSeedGeography[];
  readonly externalMarketConnection: ExternalMarketConnectionGeography;
}
