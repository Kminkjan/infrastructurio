import { describe, expect, it } from "vitest";
import { createPrng } from "../../core/util/prng";
import {
  DEFAULT_TERRAIN_SIZE,
  type Drag,
  HEADINGS,
  type PieceSpec,
  type TrackPlan,
  createSim,
  generateTerrain,
  groundMmAt,
  nearestNode,
  nodeOfOffset,
  resolvePiece,
  stepOf,
  toWorld,
} from "../../core/sim/api";
import { sampleTerrainHeightM } from "../terrain/heightfieldRay";
import { BALLAST_DEPTH_M, BALLAST_TOP_HALF_M, RAIL_HEIGHT_M, RAIL_OFFSET_M, SLEEPER_HEIGHT_M, TRACK_LIFT_M, type TrackCentreline, sampleCentreline } from "./trackGeometry";

/**
 * A dev measurement, not a gate (ADR 0010, "Findings (2026-09-27, D3 ground following)"):
 * how far the rendered terrain rises above ground-following track between its nodes on the
 * diorama map, and how much of the track each render lift leaves buried. The ADR's table
 * came from this code with PLANS = 3000 (about 5 s); the suite runs 300.
 */
const PLANS = 300;
const PARAMS = { seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE } as const;
/** Across the track: the rails, the ballast top's edges and the shoulders' base. */
const RAILS_M = [RAIL_OFFSET_M, -RAIL_OFFSET_M];
const BALLAST_EDGES_M = [BALLAST_TOP_HALF_M, -BALLAST_TOP_HALF_M];
const SHOULDER_BASE_M = [2.2, -2.2];
const RAIL_TOP_ABOVE_LIFT_M = SLEEPER_HEIGHT_M + RAIL_HEIGHT_M;

describe("track render lift over ground-following track (a dev measurement)", () => {
  it("keeps the rails of ground-level straights above the rendered terrain", async ({ annotate }) => {
    const terrain = generateTerrain(PARAMS);
    const sim = createSim({ terrain: PARAMS });
    const levelM = terrain.waterLevelDm / 10;
    /** The visible surface: the terrain mesh, or the water plane over it. */
    const surfaceM = (x: number, y: number) => {
      const t = sampleTerrainHeightM(terrain, x, y);
      return t === undefined ? undefined : Math.max(t, levelM);
    };
    const ground = (n: { q: number; r: number }) => groundMmAt(terrain, n) ?? Number.NaN;
    const point = (q: number, r: number) => {
      const w = toWorld({ q, r });
      return { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) };
    };

    // Plans with zero height steps, as the tool makes them: half straight drags of 10–40 steps, half free
    // drags within ±150 m, the end re-planned onto the ground at the plan's actual end.
    const prng = createPrng("render-lift-probe");
    const plans: TrackPlan[] = [];
    while (plans.length < PLANS) {
      const s = nodeOfOffset(60 + prng.nextInt(280), 80 + prng.nextInt(186));
      const heading = HEADINGS[prng.nextInt(12)] ?? 0;
      let to = point(s.q, s.r);
      let fromHeading: typeof heading | undefined = heading;
      if (prng.nextInt(2) === 0) {
        const k = 10 + prng.nextInt(31);
        const d = stepOf(heading);
        to = point(s.q + d.q * k, s.r + d.r * k);
      } else {
        to = { xMm: to.xMm + prng.nextInt(300_001) - 150_000, yMm: to.yMm + prng.nextInt(300_001) - 150_000 };
        if (prng.nextInt(2) === 0) fromHeading = undefined;
      }
      const from = { q: s.q, r: s.r, zMm: ground(s) };
      const drag = (end: { q: number; r: number }): Drag => ({ from, ...(fromHeading === undefined ? {} : { fromHeading }), to, dzMm: ground(end) - from.zMm, magnetism: true });
      let plan = sim.planTrack(drag(nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 })));
      if (plan.end && plan.end.node.zMm !== ground(plan.end.node)) plan = sim.planTrack(drag(plan.end.node));
      if (plan.fit !== "none") plans.push(plan);
    }

    // Terrain minus track height (m), every 0.25 m along each piece's rendered centreline, by piece class.
    type Samples = { centre: number[]; rails: number[]; ballast: number[]; shoulder: number[] };
    const classes = new Map<string, Samples>();
    for (const plan of plans) {
      for (const spec of plan.pieces) {
        const res = resolvePiece(spec);
        if (!res.ok) throw new Error(res.failure.message);
        const c: TrackCentreline = { prims: res.piece.prims, z0M: res.piece.ends[0].node.zMm / 1000, z1M: res.piece.ends[1].node.zMm / 1000 };
        const cls = classOf(spec);
        const out = classes.get(cls) ?? { centre: [], rails: [], ballast: [], shoulder: [] };
        classes.set(cls, out);
        const frames = sampleCentreline(c);
        for (let i = 1; i < frames.length; i++) {
          const a = frames[i - 1];
          const b = frames[i];
          if (!a || !b) continue;
          const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25));
          for (let j = i === 1 ? 0 : 1; j <= n; j++) {
            const f = j / n;
            const x = a.x + (b.x - a.x) * f;
            const y = a.y + (b.y - a.y) * f;
            const z = a.z + (b.z - a.z) * f;
            const tx = a.tx + (b.tx - a.tx) * f;
            const ty = a.ty + (b.ty - a.ty) * f;
            const l = Math.hypot(tx, ty) || 1;
            const at = (u: number, into: number[]) => {
              const t = surfaceM(x - (ty / l) * u, y + (tx / l) * u);
              if (t !== undefined) into.push(t - z);
            };
            at(0, out.centre);
            for (const u of RAILS_M) at(u, out.rails);
            for (const u of BALLAST_EDGES_M) at(u, out.ballast);
            for (const u of SHOULDER_BASE_M) at(u, out.shoulder);
          }
        }
      }
    }

    const pct = (xs: readonly number[], pred: (d: number) => boolean) => (100 * xs.filter(pred).length) / Math.max(1, xs.length);
    const fmt = (v: number) => `${v.toFixed(3)}%`;
    const lines: string[] = [];
    for (const [cls, s] of [...classes].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const cells = [0.05, TRACK_LIFT_M, 0.2].map(
        (lift) =>
          `lift ${lift.toFixed(2)} m: rail tops buried ${fmt(pct(s.rails, (d) => d > lift + RAIL_TOP_ABOVE_LIFT_M))}, ballast-top edges ${fmt(pct(s.ballast, (d) => d > lift))}, shoulder gap > 5 cm ${fmt(pct(s.shoulder, (d) => d < lift - BALLAST_DEPTH_M - 0.05))}`,
      );
      lines.push(`${cls} (${s.centre.length} samples, centre > 1 m under ${fmt(pct(s.centre, (d) => d > 1))}): ${cells.join("; ")}`);
    }
    for (const line of lines) await annotate(line);

    // Guards (set after the 2026-09-27 measurement; not gates). On straights the planner lays both ends on
    // the ground, so the centreline stays within a few decimetres of it (0.29 m at worst in 3,000 plans) …
    for (const cls of ["straight-primary", "straight-secondary"]) {
      const s = classes.get(cls);
      if (!s) throw new Error(`no ${cls} samples`);
      expect(s.centre.reduce((m, d) => Math.max(m, d), -Infinity)).toBeLessThan(0.5);
      // … and the lift keeps their rail tops above the terrain in all but a sliver of samples (0.007% and
      // 0.055% at 3,000 plans; 0.27% and 0.26% with the former 0.05 m lift).
      expect(pct(s.rails, (d) => d > TRACK_LIFT_M + RAIL_TOP_ABOVE_LIFT_M)).toBeLessThan(0.2);
    }
  });
});

function classOf(spec: PieceSpec): string {
  if (spec.kind !== "straight") return spec.kind;
  return spec.heading % 2 === 0 ? "straight-primary" : "straight-secondary";
}
