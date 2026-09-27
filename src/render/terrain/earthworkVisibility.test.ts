import { describe, expect, it } from "vitest";
import { type PieceSpec, resolvePiece } from "../../core/sim/api";
import { diorama, groundPlans } from "../../../tests/support/groundPlans";
import { RIBBON_HALF_WIDTH_M, RIBBON_LIFT_M } from "../track/ghostGeometry";
import { BALLAST_TOP_HALF_M, RAIL_OFFSET_M, TRACK_LIFT_M, TRACK_RAIL_TOP_M, type TrackCentreline, sampleCentreline } from "../track/trackGeometry";
import { generateDiorama } from "../../core/scenarios/baltic-diorama";
import { SCENERY_CLEARANCE_M, SCENERY_MOVED_M } from "./EarthworksView";
import { ChunkPass, type DrawnHeightfield, type PieceInput, conformTerrain, conformedHeightM, earthworkPiece, nearestOnPiece } from "./earthworks";

/**
 * The earthworks-lite visibility guarantee (ADR 0010, "Findings (2026-09-27,
 * earthworks-lite)"): on the diorama map, after conforming, the drawn terrain
 * never rises over the drawn rail tops along any track piece, curves included,
 * at either terrain LOD. Plans are the ground-level population of the D3
 * render-lift measurement (`tests/support/groundPlans.ts`), each conformed on
 * its own as the tool would build it. The finding's numbers came from this code
 * with PLANS = 3000; the suite runs 300. It also measures the state before
 * (the natural terrain) and the cut and fill depths, as annotations.
 */
const PLANS = 300;
const STEP_M = 0.25;

interface Samples {
  /** Drawn terrain minus rail top at the centreline and both rails (m); ≤ 0 means visible. */
  rails: number[];
  /** Natural terrain minus rail top at the same places. */
  railsBefore: number[];
  /** Drawn terrain minus ballast top at the ballast top's edges (±1.6 m). */
  ballastEdge: number[];
  ballastEdgeBefore: number[];
  /** Natural terrain minus track height at the centreline: + is cut depth, − is fill height. */
  depth: number[];
  /** Natural terrain minus the ghost ribbon at its edges and centre (> 0: only the see-through pass shows it). */
  ghost: number[];
}

function centreline(spec: PieceSpec): { input: PieceInput; line: TrackCentreline } {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(res.failure.message);
  const input = { key: res.piece.key, prims: res.piece.prims, z0Mm: res.piece.ends[0].node.zMm, z1Mm: res.piece.ends[1].node.zMm };
  return { input, line: { prims: res.piece.prims, z0M: input.z0Mm / 1000, z1M: input.z1Mm / 1000 } };
}

/** Walks a piece's rendered centreline every STEP_M, with the unit left normal. */
function walk(line: TrackCentreline, visit: (x: number, y: number, z: number, lx: number, ly: number) => void): void {
  const frames = sampleCentreline(line);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!a || !b) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP_M));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) {
      const f = j / n;
      const tx = a.tx + (b.tx - a.tx) * f;
      const ty = a.ty + (b.ty - a.ty) * f;
      const l = Math.hypot(tx, ty) || 1;
      visit(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f, -ty / l, tx / l);
    }
  }
}

function measure(field: DrawnHeightfield, line: TrackCentreline, out: Samples, withBefore: boolean): void {
  walk(line, (x, y, z, lx, ly) => {
    for (const u of [0, RAIL_OFFSET_M, -RAIL_OFFSET_M]) {
      const px = x + lx * u;
      const py = y + ly * u;
      out.rails.push(field.heightAtM(px, py) - (z + TRACK_RAIL_TOP_M));
      if (withBefore) out.railsBefore.push(field.naturalAtM(px, py) - (z + TRACK_RAIL_TOP_M));
    }
    for (const u of [BALLAST_TOP_HALF_M, -BALLAST_TOP_HALF_M]) {
      out.ballastEdge.push(field.heightAtM(x + lx * u, y + ly * u) - (z + TRACK_LIFT_M));
      if (withBefore) out.ballastEdgeBefore.push(field.naturalAtM(x + lx * u, y + ly * u) - (z + TRACK_LIFT_M));
    }
    if (!withBefore) return;
    out.depth.push(field.naturalAtM(x, y) - z);
    for (const u of [0, RIBBON_HALF_WIDTH_M, -RIBBON_HALF_WIDTH_M]) out.ghost.push(field.naturalAtM(x + lx * u, y + ly * u) - (z + RIBBON_LIFT_M));
  });
}

const pct = (xs: readonly number[], pred: (d: number) => boolean) => (100 * xs.filter(pred).length) / Math.max(1, xs.length);
const fmt = (v: number) => `${v.toFixed(3)}%`;
const maxOf = (xs: readonly number[]) => xs.reduce((m, v) => (v > m ? v : m), -Infinity);

describe("earthworks-lite visibility guarantee on the diorama map", () => {
  it("keeps the drawn terrain under the rail tops (and the ballast top clear) along every piece, curves included", async ({ annotate }) => {
    const { terrain } = diorama();
    const plans = groundPlans(PLANS);
    const pass = new ChunkPass();
    const byLod = [0, 1].map(() => new Map<string, Samples>());
    const empty = (): Samples => ({ rails: [], railsBefore: [], ballastEdge: [], ballastEdgeBefore: [], depth: [], ghost: [] });
    let refined = 0;
    // Buildings are never moved: count the plans whose earthworks claim a building lot (centre or corner).
    const lots = generateDiorama(terrain).lots.map((lot) => {
      const a = (lot.heading * Math.PI) / 6;
      const [c, sn] = [Math.cos(a), Math.sin(a)];
      const [hl, hw] = [lot.lengthMm / 2000, lot.widthMm / 2000];
      const x = lot.xMm / 1000;
      const y = lot.yMm / 1000;
      return [[x, y], ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => [x + c * hl * (u ?? 0) - sn * hw * (v ?? 0), y + sn * hl * (u ?? 0) + c * hw * (v ?? 0)])] as [number, number][];
    });
    let plansOverBuildings = 0;
    let lotsClaimed = 0;
    for (const plan of plans) {
      const lines = plan.pieces.map((spec) => ({ kind: spec.kind === "straight" ? "straight" : spec.kind, ...centreline(spec) }));
      const network = { pieces: lines.map((l) => l.input) };
      for (const lod of [0, 1] as const) {
        const field = conformTerrain(terrain, network, lod, pass);
        if (lod === 0) {
          refined += field.triangles.size;
          const pieces = network.pieces.map((p) => earthworkPiece(terrain, p));
          const claims = (x: number, y: number) =>
            pieces.some((p) => x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY && nearestOnPiece(p, x, y).d <= SCENERY_CLEARANCE_M) ||
            Math.abs(field.heightAtM(x, y) - field.naturalAtM(x, y)) > SCENERY_MOVED_M;
          const claimed = lots.filter((corners) => corners.some(([x, y]) => claims(x, y))).length;
          if (claimed > 0) plansOverBuildings += 1;
          lotsClaimed += claimed;
        }
        for (const l of lines) {
          const map = byLod[lod] ?? new Map<string, Samples>();
          const s = map.get(l.kind) ?? empty();
          map.set(l.kind, s);
          measure(field, l.line, s, lod === 0);
        }
      }
    }

    const lines: string[] = [
      `${plans.length} plans, ${plans.reduce((n, p) => n + p.pieces.length, 0)} pieces; LOD0 refined triangles per plan: ${(refined / plans.length).toFixed(1)}; plans whose earthworks claim a building lot: ${plansOverBuildings} (${lotsClaimed} lots)`,
    ];
    for (const [lod, map] of byLod.entries()) {
      for (const [kind, s] of [...map].sort(([a], [b]) => (a < b ? -1 : 1))) {
        let line = `LOD${lod} ${kind} (${s.rails.length / 3} samples): rail tops buried ${fmt(pct(s.rails, (d) => d > 0))} (worst ${maxOf(s.rails).toFixed(3)} m), ballast-top edges buried ${fmt(pct(s.ballastEdge, (d) => d > 0))}`;
        if (lod === 0) {
          line += `; before: rail tops buried ${fmt(pct(s.railsBefore, (d) => d > 0))} (worst ${maxOf(s.railsBefore).toFixed(2)} m), ballast-top edges ${fmt(pct(s.ballastEdgeBefore, (d) => d > 0))}`;
          line += `; ghost ribbon under natural ground ${fmt(pct(s.ghost, (d) => d > 0))}`;
        }
        lines.push(line);
      }
    }
    // Cut and fill at the centreline, all piece kinds: how deep the earthworks go.
    const depth = [...(byLod[0]?.values() ?? [])].flatMap((s) => s.depth);
    const bins: [string, (d: number) => boolean][] = [
      ["cut > 8 m", (d) => d > 8],
      ["cut 4–8 m", (d) => d > 4 && d <= 8],
      ["cut 2–4 m", (d) => d > 2 && d <= 4],
      ["cut 1–2 m", (d) => d > 1 && d <= 2],
      ["cut 0.05–1 m", (d) => d > 0.05 && d <= 1],
      ["within ±5 cm", (d) => Math.abs(d) <= 0.05],
      ["fill 0.05–1 m", (d) => d < -0.05 && d >= -1],
      ["fill 1–2 m", (d) => d < -1 && d >= -2],
      ["fill 2–4 m", (d) => d < -2 && d >= -4],
      ["fill 4–8 m", (d) => d < -4 && d >= -8],
      ["fill > 8 m", (d) => d < -8],
    ];
    lines.push(`centreline depth (${depth.length} samples): ${bins.map(([name, p]) => `${name} ${fmt(pct(depth, p))}`).join(", ")}; deepest cut ${maxOf(depth).toFixed(2)} m, highest fill ${(-depth.reduce((m, v) => (v < m ? v : m), Infinity)).toFixed(2)} m`);
    for (const line of lines) await annotate(line);

    // The guarantee: no drawn terrain over a rail top anywhere, at either LOD, on any piece kind.
    for (const map of byLod) {
      for (const [kind, s] of map) {
        expect(maxOf(s.rails), `${kind} rail tops`).toBeLessThanOrEqual(1e-4);
        // Stronger at LOD0 (1.25 m sub-lattice inside the 3 m bed): the ballast top stays clear too.
        if (map === byLod[0]) expect(maxOf(s.ballastEdge), `${kind} ballast-top edges`).toBeLessThanOrEqual(1e-4);
      }
    }
    // And it was needed: before, curves were buried by metres.
    expect(maxOf(byLod[0]?.get("curve")?.railsBefore ?? [])).toBeGreaterThan(3);
  });

  it("compares the mesh options on the same plans: lattice nodes only, nodes clamped conservatively, refined (a dev measurement)", async ({ annotate }) => {
    const { terrain } = diorama();
    const plans = groundPlans(PLANS);
    const pass = new ChunkPass();
    const waterM = terrain.waterLevelDm / 10;
    const rowM = 2.5 * Math.sqrt(3);
    const nodeXY = (col: number, row: number) => ({ x: 5 * (col + (row & 1) / 2), y: row * rowM });
    const stats = {
      nodes: { buried: 0, samples: 0, worst: -Infinity, moved: 0, edge: 0, edges: 0 },
      clamped: { buried: 0, samples: 0, worst: -Infinity, moved: 0, edge: 0, edges: 0 },
      refined: { buried: 0, samples: 0, worst: -Infinity, moved: 0, edge: 0, edges: 0, triangles: 0 },
    };
    for (const plan of plans) {
      const lines = plan.pieces.map((spec) => centreline(spec));
      const pieces = lines.map((l) => earthworkPiece(terrain, l.input));
      // Option A: the same rule evaluated at LOD0 lattice nodes only, the plain 5 m triangles in between.
      const nodes = new Map<number, number>();
      for (const p of pieces) {
        const r0 = Math.max(0, Math.floor(p.minY / rowM));
        const r1 = Math.min(terrain.rows - 1, Math.ceil(p.maxY / rowM));
        for (let row = r0; row <= r1; row++) {
          for (let col = Math.max(0, Math.floor(p.minX / 5) - 1); col <= Math.min(terrain.columns - 1, Math.ceil(p.maxX / 5)); col++) {
            const index = row * terrain.columns + col;
            if (nodes.has(index)) continue;
            const { x, y } = nodeXY(col, row);
            const natural = (terrain.heightsDm[index] ?? 0) / 10;
            const c = conformedHeightM(pieces, x, y, natural, waterM);
            if (c !== natural) nodes.set(index, c);
          }
        }
      }
      // Option B: option A, then every node of a triangle under the ballast top (|u| ≤ 1.6 m) clamped to the bed.
      const clamped = new Map(nodes);
      const nodeOf = (x: number, y: number): number[] => {
        const rf = y / rowM;
        const qf = x / 5 - rf / 2;
        const q = Math.floor(qf);
        const r = Math.floor(rf);
        const corners = qf - q + (rf - r) <= 1 ? [[q, r], [q + 1, r], [q, r + 1]] : [[q + 1, r], [q, r + 1], [q + 1, r + 1]];
        return corners.map(([cq, cr]) => (cr ?? 0) * terrain.columns + (cq ?? 0) + Math.floor((cr ?? 0) / 2));
      };
      const heightOf = (map: Map<number, number>, x: number, y: number): number => {
        const rf = y / rowM;
        const qf = x / 5 - rf / 2;
        const q = Math.floor(qf);
        const r = Math.floor(rf);
        const fq = qf - q;
        const fr = rf - r;
        const h = (cq: number, cr: number) => {
          const i = cr * terrain.columns + cq + Math.floor(cr / 2);
          return map.get(i) ?? (terrain.heightsDm[i] ?? 0) / 10;
        };
        return fq + fr <= 1 ? (1 - fq - fr) * h(q, r) + fq * h(q + 1, r) + fr * h(q, r + 1) : (1 - fr) * h(q + 1, r) + (1 - fq) * h(q, r + 1) + (fq + fr - 1) * h(q + 1, r + 1);
      };
      for (const l of lines) {
        walk(l.line, (x, y, z, lx, ly) => {
          for (let u = -BALLAST_TOP_HALF_M; u <= BALLAST_TOP_HALF_M + 1e-9; u += 0.4) {
            for (const i of nodeOf(x + lx * u, y + ly * u)) {
              const natural = (terrain.heightsDm[i] ?? 0) / 10;
              const cap = Math.min(clamped.get(i) ?? natural, z);
              if (cap < (clamped.get(i) ?? natural) - 1e-9) clamped.set(i, cap);
            }
          }
        });
      }
      // Option C (chosen): the refined chunk pass.
      const field = conformTerrain(terrain, { pieces: lines.map((l) => l.input) }, 0, pass);
      stats.refined.triangles += field.triangles.size;
      for (const l of lines) {
        walk(l.line, (x, y, z, lx, ly) => {
          for (const u of [0, RAIL_OFFSET_M, -RAIL_OFFSET_M]) {
            const px = x + lx * u;
            const py = y + ly * u;
            const top = z + TRACK_RAIL_TOP_M;
            for (const [key, h] of [["nodes", heightOf(nodes, px, py)], ["clamped", heightOf(clamped, px, py)], ["refined", field.heightAtM(px, py)]] as const) {
              const st = stats[key];
              st.samples += 1;
              if (h > top) st.buried += 1;
              st.worst = Math.max(st.worst, h - top);
            }
          }
          for (const u of [BALLAST_TOP_HALF_M, -BALLAST_TOP_HALF_M]) {
            const px = x + lx * u;
            const py = y + ly * u;
            for (const [key, h] of [["nodes", heightOf(nodes, px, py)], ["clamped", heightOf(clamped, px, py)], ["refined", field.heightAtM(px, py)]] as const) {
              stats[key].edges += 1;
              if (h > z + TRACK_LIFT_M) stats[key].edge += 1;
            }
          }
        });
      }
      stats.nodes.moved += nodes.size;
      stats.clamped.moved += clamped.size;
      let movedSub = 0;
      for (const heights of field.triangles.values()) movedSub += heights.length;
      stats.refined.moved += movedSub;
    }
    const line = (name: string, st: { buried: number; samples: number; worst: number; edge: number; edges: number }) =>
      `${name}: rail-top samples buried ${fmt((100 * st.buried) / st.samples)} (worst ${st.worst.toFixed(2)} m), ballast-top edges buried ${fmt((100 * st.edge) / st.edges)}`;
    await annotate(`${line("A lattice nodes only", stats.nodes)}, ${(stats.nodes.moved / plans.length).toFixed(1)} nodes moved per plan (about ${((stats.nodes.moved / plans.length) * 21.65).toFixed(0)} m²), no extra triangles`);
    await annotate(`${line("B nodes clamped under the ballast top", stats.clamped)}, ${(stats.clamped.moved / plans.length).toFixed(1)} nodes moved per plan (about ${((stats.clamped.moved / plans.length) * 21.65).toFixed(0)} m²), no extra triangles`);
    await annotate(`${line("C refined 4 × 4 (chosen)", stats.refined)}, ${(stats.refined.triangles / plans.length).toFixed(1)} triangles refined per plan (+${((stats.refined.triangles / plans.length) * 15).toFixed(0)} triangles drawn, before fans)`);
    expect(stats.refined.buried).toBe(0);
  });
});
