import type { Point, SimulationSnapshot } from "../shared";

export type BottleneckOverlayRole = "affected-flow" | "overloaded-link";

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

export function getBottleneckOverlayFeatures(
  snapshot: SimulationSnapshot,
): readonly BottleneckOverlayFeature[] {
  const features: BottleneckOverlayFeature[] = [];
  for (const linkId of snapshot.bottlenecks.affectedRouteLinkIds) {
    const line = lineForLink(snapshot, linkId);
    if (line) {
      features.push({
        id: `affected-flow:${linkId}`,
        role: "affected-flow",
        ...line,
        label: "Granite freight affected by the current route choice",
      });
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
