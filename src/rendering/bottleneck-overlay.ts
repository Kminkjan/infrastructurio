import type { Point, SimulationSnapshot } from "../shared";

export type BottleneckOverlayRole =
  | "inbound-freight"
  | "outbound-freight"
  | "overloaded-link";

export interface BottleneckOverlayFeature {
  readonly id: string;
  readonly role: BottleneckOverlayRole;
  readonly start: Point;
  readonly end: Point;
  readonly label: string;
}

function lineForLink(
  snapshot: SimulationSnapshot,
  linkId: string,
): { readonly start: Point; readonly end: Point } | undefined {
  const link = snapshot.roadNetwork.links.find(({ id }) => id === linkId);
  if (!link) {
    return undefined;
  }
  const start = snapshot.roadNetwork.nodes.find(
    ({ id }) => id === link.startNodeId,
  );
  const end = snapshot.roadNetwork.nodes.find(
    ({ id }) => id === link.endNodeId,
  );
  return start && end
    ? { start: start.position, end: end.position }
    : undefined;
}

function lineForRailLink(
  snapshot: SimulationSnapshot,
  linkId: string,
): { readonly start: Point; readonly end: Point } | undefined {
  const link = snapshot.railNetwork.links.find(({ id }) => id === linkId);
  if (!link) return undefined;
  const start = snapshot.railNetwork.nodes.find(({ id }) => id === link.startNodeId);
  const end = snapshot.railNetwork.nodes.find(({ id }) => id === link.endNodeId);
  return start && end ? { start: start.position, end: end.position } : undefined;
}

export function getBottleneckOverlayFeatures(
  snapshot: SimulationSnapshot,
): readonly BottleneckOverlayFeature[] {
  const features: BottleneckOverlayFeature[] = [];
  for (const [index, freight] of snapshot.explanations.freightLegs.entries()) {
    for (const linkId of freight.routeLinkIds) {
      const line = freight.chosenMode === "road"
        ? lineForLink(snapshot, linkId)
        : lineForRailLink(snapshot, linkId);
      if (line) {
        features.push({
          id: `${freight.legId}:${linkId}`,
          role: index === 0 ? "inbound-freight" : "outbound-freight",
          ...line,
          label: `${freight.actorName} moves ${freight.commodityName} from ${freight.origin.name} to ${freight.destination.name} by ${freight.chosenMode}`,
        });
      }
    }
  }
  for (const bottleneck of snapshot.bottlenecks.roadBottlenecks) {
    const line = lineForLink(snapshot, bottleneck.linkId);
    if (line) {
      features.push({
        id: bottleneck.id,
        role: "overloaded-link",
        ...line,
        label: `${bottleneck.name}: ${Math.round(
          bottleneck.capacity.volumeCapacityRatio * 100,
        )}% of practical capacity`,
      });
    }
  }
  return Object.freeze(features.map((feature) => Object.freeze(feature)));
}
