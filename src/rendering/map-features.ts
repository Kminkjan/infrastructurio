import type {
  Point,
  RailNetwork,
  RoadNetwork,
  ScenarioGeography,
} from "../shared";

export type MapFeatureKind = "infrastructure" | "resource" | "settlement";

export interface MapSelection {
  readonly id: string;
  readonly name: string;
  readonly kind: MapFeatureKind;
  readonly description: string;
}

export type FeatureGeometry =
  | {
      readonly type: "point";
      readonly position: Point;
      readonly radius: number;
    }
  | {
      readonly type: "rectangle";
      readonly center: Point;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly type: "polygon";
      readonly boundary: readonly Point[];
    }
  | {
      readonly type: "line";
      readonly start: Point;
      readonly end: Point;
    };

export interface SelectableMapFeature extends MapSelection {
  readonly geometry: FeatureGeometry;
}

export function getRoadSnapAnchors(
  geography: ScenarioGeography,
): readonly Point[] {
  const fertileCenter = geography.fertileLand.boundary.reduce(
    (center, position, _index, boundary) => ({
      x: center.x + position.x / boundary.length,
      y: center.y + position.y / boundary.length,
    }),
    { x: 0, y: 0 },
  );

  return [
    geography.quarry.position,
    geography.stoneworks.position,
    geography.externalMarketConnection.position,
    ...geography.settlementSeeds.map(({ position }) => position),
    fertileCenter,
  ];
}

export function getRailSnapAnchors(
  geography: ScenarioGeography,
  railNetwork: RailNetwork,
): readonly Point[] {
  return [
    geography.quarry.position,
    geography.stoneworks.position,
    geography.externalMarketConnection.position,
    ...railNetwork.nodes.map(({ position }) => position),
  ];
}

export function getSelectableMapFeatures(
  geography: ScenarioGeography,
): readonly SelectableMapFeature[] {
  return [
    {
      id: geography.fertileLand.id,
      name: geography.fertileLand.name,
      kind: "resource",
      description: "Fertile land",
      geometry: {
        type: "polygon",
        boundary: geography.fertileLand.boundary,
      },
    },
    {
      id: geography.crossingArea.id,
      name: geography.crossingArea.name,
      kind: "infrastructure",
      description: "Constrained river crossing",
      geometry: {
        type: "rectangle",
        center: geography.crossingArea.center,
        width: geography.crossingArea.width,
        height: geography.crossingArea.height,
      },
    },
    {
      id: geography.externalMarketConnection.id,
      name: geography.externalMarketConnection.name,
      kind: "infrastructure",
      description: "External market connection",
      geometry: {
        type: "point",
        position: geography.externalMarketConnection.position,
        radius: 44,
      },
    },
    {
      id: geography.stoneworks.id,
      name: geography.stoneworks.name,
      kind: "infrastructure",
      description: "Stone-processing industry",
      geometry: {
        type: "point",
        position: geography.stoneworks.position,
        radius: 38,
      },
    },
    {
      id: geography.quarry.id,
      name: geography.quarry.name,
      kind: "resource",
      description: "Granite resource",
      geometry: {
        type: "point",
        position: geography.quarry.position,
        radius: 46,
      },
    },
    ...geography.settlementSeeds.map((settlement) => ({
      id: settlement.id,
      name: settlement.name,
      kind: "settlement" as const,
      description: "Settlement seed",
      geometry: {
        type: "point" as const,
        position: settlement.position,
        radius: 34,
      },
    })),
  ];
}

export function toMapSelection(feature: SelectableMapFeature): MapSelection {
  const { id, name, kind, description } = feature;
  return { id, name, kind, description };
}

export function getSelectableRoadFeatures(
  roadNetwork: RoadNetwork,
): readonly SelectableMapFeature[] {
  return roadNetwork.segments.map((segment) => ({
    id: segment.id,
    name: "Road segment",
    kind: "infrastructure" as const,
    description: `${Math.round(
      Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      ),
    )} map units · ${segment.roadClass} road`,
    geometry: {
      type: "line" as const,
      start: segment.start,
      end: segment.end,
    },
  }));
}

export function getSelectableRailFeatures(
  railNetwork: RailNetwork,
): readonly SelectableMapFeature[] {
  return [
    ...railNetwork.tracks.map((track) => ({
      id: track.id,
      name: "Rail track",
      kind: "infrastructure" as const,
      description: `${Math.round(track.length)} map units · ${track.capacityTonsPerDay} t/day rail corridor`,
      geometry: {
        type: "line" as const,
        start: track.start,
        end: track.end,
      },
    })),
    ...railNetwork.terminals.map((terminal) => ({
      id: terminal.id,
      name: terminal.name,
      kind: "infrastructure" as const,
      description: `${terminal.capacityTonsPerDay} t/day freight rail terminal`,
      geometry: {
        type: "point" as const,
        position: terminal.position,
        radius: 25,
      },
    })),
  ];
}
