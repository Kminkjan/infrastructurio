// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AccessibilityFactor, Point, RoadSegment } from "../../shared";
import { createRoadNetwork } from "../transport/road-network";
import {
  createAccessibilityScorer,
  type AccessibilityCandidate,
  type AccessibilityModel,
  type AccessibilityOpportunity,
} from "./accessibility";

function segment(id: string, start: Point, end: Point): RoadSegment {
  return { id, start, end };
}

function candidate(id: string, position: Point): AccessibilityCandidate {
  return { id, name: id, position };
}

function opportunity(
  id: string,
  factor: AccessibilityFactor,
  position: Point,
  weight = 100,
): AccessibilityOpportunity {
  return { id, factor, position, weight };
}

function model(
  candidates: readonly AccessibilityCandidate[],
  opportunities: readonly AccessibilityOpportunity[],
  decayCost = 100,
): AccessibilityModel {
  return { candidates, opportunities, decayCost };
}

describe("generalized accessibility scoring", () => {
  it("assigns all four access measures from reachable network opportunities", () => {
    const scorer = createAccessibilityScorer(
      model(
        [candidate("site", { x: 0, y: 0 })],
        [
          opportunity("market", "market", { x: 100, y: 0 }),
          opportunity("workers", "labor", { x: 0, y: 100 }),
          opportunity("materials", "resource", { x: 100, y: 100 }),
          opportunity("clinic", "service", { x: 50, y: 0 }),
        ],
      ),
      createRoadNetwork([
        segment("market-road", { x: 0, y: 0 }, { x: 100, y: 0 }),
        segment("labor-road", { x: 0, y: 0 }, { x: 0, y: 100 }),
        segment("resource-road", { x: 100, y: 0 }, { x: 100, y: 100 }),
        segment("service-spur", { x: 50, y: 0 }, { x: 50, y: -10 }),
      ]),
    );

    expect(scorer.getSnapshot().locations).toEqual([
      {
        locationId: "site",
        name: "site",
        position: { x: 0, y: 0 },
        market: {
          score: 36.788,
          nearestNetworkCost: 100,
          reachableOpportunityCount: 1,
        },
        labor: {
          score: 36.788,
          nearestNetworkCost: 100,
          reachableOpportunityCount: 1,
        },
        resource: {
          score: 13.534,
          nearestNetworkCost: 200,
          reachableOpportunityCount: 1,
        },
        service: {
          score: 60.653,
          nearestNetworkCost: 50,
          reachableOpportunityCount: 1,
        },
      },
    ]);
  });

  it("distinguishes equal straight-line proximity using network travel cost", () => {
    const market = { x: 100, y: 10 };
    const slowSite = { x: 0, y: 0 };
    const fastSite = { x: 0, y: 20 };
    expect(Math.hypot(market.x - slowSite.x, market.y - slowSite.y)).toBe(
      Math.hypot(market.x - fastSite.x, market.y - fastSite.y),
    );

    const scorer = createAccessibilityScorer(
      model(
        [candidate("slow", slowSite), candidate("fast", fastSite)],
        [opportunity("market", "market", market)],
      ),
      createRoadNetwork([
        segment("slow-access", slowSite, { x: 0, y: 100 }),
        segment("slow-corridor", { x: 0, y: 100 }, market),
        segment("fast-access", fastSite, market),
      ]),
    );

    const [slow, fast] = scorer.getSnapshot().locations;
    expect(slow?.market.nearestNetworkCost).toBeGreaterThan(
      fast?.market.nearestNetworkCost ?? Number.POSITIVE_INFINITY,
    );
    expect(slow?.market.score).toBeLessThan(fast?.market.score ?? 0);
  });

  it("invalidates only candidates whose opportunity costs change", () => {
    const candidates = [
      candidate("west-one", { x: 0, y: 0 }),
      candidate("west-two", { x: 100, y: 0 }),
      candidate("east", { x: 1_000, y: 0 }),
    ];
    const accessibilityModel = model(candidates, [
      opportunity("market", "market", { x: 100, y: 0 }),
    ]);
    const unchangedSegments = [
      segment("west-one", { x: 0, y: 0 }, { x: 0, y: 100 }),
      segment("west-two", { x: 0, y: 100 }, { x: 100, y: 0 }),
      segment("east", { x: 1_000, y: 0 }, { x: 1_100, y: 0 }),
    ];
    const scorer = createAccessibilityScorer(
      accessibilityModel,
      createRoadNetwork(unchangedSegments),
    );
    const before = scorer.getSnapshot();

    expect(before.lastNetworkUpdateInvalidatedLocationIds).toEqual([
      "west-one",
      "west-two",
      "east",
    ]);

    const afterWestEdit = scorer.updateNetwork(
      createRoadNetwork([
        ...unchangedSegments,
        segment("west-shortcut", { x: 0, y: 0 }, { x: 100, y: 0 }),
      ]),
    );
    expect(afterWestEdit.lastNetworkUpdateInvalidatedLocationIds).toEqual([
      "west-one",
    ]);
    expect(afterWestEdit.locations[1]).toBe(before.locations[1]);
    expect(afterWestEdit.locations[2]).toBe(before.locations[2]);

    const afterHarmlessSpur = scorer.updateNetwork(
      createRoadNetwork([
        ...unchangedSegments,
        segment("west-shortcut", { x: 0, y: 0 }, { x: 100, y: 0 }),
        segment("west-spur", { x: 50, y: 0 }, { x: 50, y: 50 }),
      ]),
    );
    expect(afterHarmlessSpur.lastNetworkUpdateInvalidatedLocationIds).toEqual(
      [],
    );
    expect(afterHarmlessSpur.locations).toEqual(afterWestEdit.locations);

    const afterUnrelatedEdit = scorer.updateNetwork(
      createRoadNetwork([
        ...unchangedSegments,
        segment("west-shortcut", { x: 0, y: 0 }, { x: 100, y: 0 }),
        segment("west-spur", { x: 50, y: 0 }, { x: 50, y: 50 }),
        segment("isolated", { x: 500, y: 0 }, { x: 600, y: 0 }),
      ]),
    );
    expect(
      afterUnrelatedEdit.lastNetworkUpdateInvalidatedLocationIds,
    ).toEqual([]);
    expect(afterUnrelatedEdit.locations).toEqual(afterWestEdit.locations);

    const afterShortcutRemoval = scorer.updateNetwork(
      createRoadNetwork(unchangedSegments),
    );
    expect(
      afterShortcutRemoval.lastNetworkUpdateInvalidatedLocationIds,
    ).toEqual(["west-one"]);
  });

  it("reports zero access for opportunities without a network route", () => {
    const scorer = createAccessibilityScorer(
      model(
        [candidate("site", { x: 0, y: 0 })],
        [opportunity("market", "market", { x: 10, y: 0 })],
      ),
      createRoadNetwork(),
    );

    expect(scorer.getSnapshot().locations[0]?.market).toEqual({
      score: 0,
      nearestNetworkCost: null,
      reachableOpportunityCount: 0,
    });
  });

  it("rejects ambiguous or invalid model inputs", () => {
    expect(() =>
      createAccessibilityScorer(
        model(
          [
            candidate("duplicate", { x: 0, y: 0 }),
            candidate("duplicate", { x: 1, y: 0 }),
          ],
          [],
        ),
        createRoadNetwork(),
      ),
    ).toThrow("accessibility candidate ids must be non-empty and unique");
    expect(() =>
      createAccessibilityScorer(
        model(
          [],
          [opportunity("invalid", "market", { x: 0, y: 0 }, 0)],
        ),
        createRoadNetwork(),
      ),
    ).toThrow("accessibility opportunity weights must be positive and finite");
  });
});
