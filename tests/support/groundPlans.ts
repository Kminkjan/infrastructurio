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
 * Zero-step plans on the diorama map, made as the track tool makes them: half
 * straight drags of 10–40 steps on all 12 headings, half free drags within
 * ±150 m, a quarter of all drags without a start heading. The one copy of the
 * generator: `render/track/trackLift.test.ts` (ADR 0010, D3 ground following)
 * and the earthworks tests both call it, so they measure the same population.
 *
 * Since D4 (2026-09-28) the tool plans a zero-step drag in "auto" height mode
 * (35‰ auto-grade: the planner chooses the end height and the nodes leave the
 * ground where the ground is steeper than 35‰), so these plans do too. Until
 * D4 they lay on the ground at every node, the end re-planned onto the ground
 * at the plan's actual end.
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
    const end = nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
    const drag: Drag = {
      from,
      ...(fromHeading === undefined ? {} : { fromHeading }),
      to,
      dzMm: (groundMmAt(terrain, end) ?? from.zMm) - from.zMm,
      magnetism: true,
      heightMode: "auto",
    };
    const plan = sim.planTrack(drag);
    if (plan.fit !== "none") plans.push(plan);
  }
  return plans;
}
