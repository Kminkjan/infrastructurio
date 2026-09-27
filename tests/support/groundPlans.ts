import {
  DEFAULT_TERRAIN_SIZE,
  type Drag,
  HEADINGS,
  type Heading,
  type Sim,
  type Terrain,
  type TrackPlan,
  createSim,
  generateTerrain,
  groundMmAt,
  nearestNode,
  nodeOfOffset,
  stepOf,
  toWorld,
} from "../../src/core/sim/api";
import { createPrng } from "../../src/core/util/prng";

/**
 * Ground-level plans on the diorama map, made as the track tool makes them
 * (zero height steps, the end re-planned onto the ground at the plan's actual
 * end): half straight drags of 10–40 steps on all 12 headings, half free
 * drags within ±150 m, a quarter of all drags without a start heading. The
 * same generator as `render/track/trackLift.test.ts` (ADR 0010, D3 ground
 * following), shared here so the earthworks tests measure the same population.
 */

export const DIORAMA_PARAMS = { seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE } as const;

export interface DioramaSetup {
  readonly terrain: Terrain;
  readonly sim: Sim;
}

let cached: DioramaSetup | undefined;

/** The diorama terrain and a sim over it (one copy per test worker). */
export function diorama(): DioramaSetup {
  cached ??= { terrain: generateTerrain(DIORAMA_PARAMS), sim: createSim({ terrain: DIORAMA_PARAMS }) };
  return cached;
}

export function groundPlans(count: number, seed = "render-lift-probe", setup: DioramaSetup = diorama()): TrackPlan[] {
  const { terrain, sim } = setup;
  const ground = (n: { q: number; r: number }) => groundMmAt(terrain, n) ?? Number.NaN;
  const point = (q: number, r: number) => {
    const w = toWorld({ q, r });
    return { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) };
  };
  const prng = createPrng(seed);
  const plans: TrackPlan[] = [];
  while (plans.length < count) {
    const s = nodeOfOffset(60 + prng.nextInt(280), 80 + prng.nextInt(186));
    const heading: Heading = HEADINGS[prng.nextInt(12)] ?? 0;
    let to = point(s.q, s.r);
    let fromHeading: Heading | undefined = heading;
    if (prng.nextInt(2) === 0) {
      const k = 10 + prng.nextInt(31);
      const d = stepOf(heading);
      to = point(s.q + d.q * k, s.r + d.r * k);
    } else {
      to = { xMm: to.xMm + prng.nextInt(300_001) - 150_000, yMm: to.yMm + prng.nextInt(300_001) - 150_000 };
      if (prng.nextInt(2) === 0) fromHeading = undefined;
    }
    const from = { q: s.q, r: s.r, zMm: ground(s) };
    const drag = (end: { q: number; r: number }): Drag => ({
      from,
      ...(fromHeading === undefined ? {} : { fromHeading }),
      to,
      dzMm: ground(end) - from.zMm,
      magnetism: true,
    });
    let plan = sim.planTrack(drag(nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 })));
    if (plan.end && plan.end.node.zMm !== ground(plan.end.node)) plan = sim.planTrack(drag(plan.end.node));
    if (plan.fit !== "none") plans.push(plan);
  }
  return plans;
}
