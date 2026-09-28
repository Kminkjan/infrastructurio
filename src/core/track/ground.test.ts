import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { diorama, groundPlans } from "../../../tests/support/groundPlans";
import { forAll } from "../../../tests/support/forall";
import { simOn } from "../../../tests/support/simOn";
import type { PieceSpec } from "../geometry/piece";
import { type Drag, type Sim, groundMmAt, nearestNode, toWorld } from "../sim/api";
import { earthworkPieces, naturalHeightAtM, networkAdjacency } from "./earthworks";

/**
 * The effective ground (D4 feel-check fixes, 2026-09-28): the core judges new track against the terrain as the
 * committed track's earthworks shape it, the surface the renderer draws.
 */

function point(q: number, r: number): { xMm: number; yMm: number } {
  const w = toWorld({ q, r });
  return { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) };
}

/** A zero-step Track drag as the tool makes it: from the (effective) ground, "auto", magnetism on. */
function toolDrag(sim: Sim, from: { q: number; r: number }, to: { q: number; r: number }): Drag {
  const zMm = sim.groundMm(from.q, from.r) ?? 0;
  const end = nearestNode({ x: point(to.q, to.r).xMm / 1000, y: point(to.q, to.r).yMm / 1000 });
  return { from: { ...from, zMm }, to: point(to.q, to.r), dzMm: (sim.groundMm(end.q, end.r) ?? zMm) - zMm, magnetism: true, heightMode: "auto" };
}

describe("the effective ground", () => {
  it("makes a drag beside an existing cutting ground in that cutting, not a tunnel under the natural hill (the owner's scene)", () => {
    // The owner's feel check (2026-09-28): the hill curve, then a Track drag beside it. Before the fix, with rule 4
    // on the natural terrain, (234, 114) → (234, 102) built six tunnel pieces under 3.9–7.9 m of drawn cover (9.2 m
    // natural): a portal on the neighbour's cutting floor.
    const { terrain } = diorama();
    const sim = simOn(terrain);
    const first = sim.planTrack(toolDrag(sim, { q: 226, r: 100 }, { q: 233, r: 117 }));
    const built = sim.execute({ type: "build-track", pieces: first.pieces, structure: "auto" });
    expect(built.ok && built.diff.added.map((a) => a.structure)).toEqual(["ground", "ground"]);
    const plan = sim.planTrack(toolDrag(sim, { q: 234, r: 114 }, { q: 234, r: 102 }));
    const verdict = sim.preview({ type: "build-track", pieces: plan.pieces, structure: "auto" });
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.diff.added.filter((a) => a.structure === "tunnel")).toEqual([]);
    // The effective ground there is the curve's cutting: several metres under the natural hill.
    const w = toWorld({ q: 234, r: 108 });
    const natural = naturalHeightAtM(terrain, w.x, w.y) * 1000;
    expect(natural - (sim.groundMm(234, 108) ?? natural)).toBeGreaterThan(2500);
  });

  it("starts a free node on a cutting's floor, where the cutting is drawn", () => {
    const { terrain } = diorama();
    const sim = simOn(terrain);
    const first = sim.planTrack(toolDrag(sim, { q: 226, r: 100 }, { q: 233, r: 117 }));
    expect(sim.execute({ type: "build-track", pieces: first.pieces, structure: "auto" }).ok).toBe(true);
    // (231, 107) lies on the curve's cutting slope, 6.1 m under the natural hill: the tool's ground is the slope.
    const natural = groundMmAt(terrain, { q: 231, r: 107 }) ?? 0;
    const effective = sim.groundMm(231, 107) ?? 0;
    expect(natural - effective).toBeGreaterThan(5000);
    // Undo gives the natural ground back exactly.
    sim.execute({ type: "undo" });
    expect(sim.groundMm(231, 107)).toBe(natural);
  });

  it("keeps the settled pieces equal to a fresh derivation over builds, undos and redos", () => {
    const { terrain } = diorama();
    const plans = groundPlans(60, "effective-ground-incremental");
    forAll(
      { seed: "effective-ground-incremental", runs: 6 },
      (prng) => Array.from({ length: 10 }, () => prng.nextInt(10)),
      (steps, prng) => {
        const sim = simOn(terrain);
        for (const s of steps) {
          if (s < 6) {
            const plan = plans[prng.nextInt(plans.length)];
            if (plan) sim.execute({ type: "build-track", pieces: plan.pieces, structure: "auto" });
          } else if (s < 8) sim.execute({ type: "undo" });
          else sim.execute({ type: "redo" });
          const network = sim.network();
          const fresh = new Map(earthworkPieces(terrain, network.pieces, networkAdjacency(network)).map((p) => [p.key, p]));
          const incremental = sim.ground().pieces;
          expect([...incremental.keys()].sort()).toEqual([...fresh.keys()].sort());
          for (const [key, p] of incremental) {
            const f = fresh.get(key);
            expect(f, key).toBeDefined();
            if (!f) continue;
            expect([p.reachM, p.lod1.reachM, p.capRiseM, p.lod1.capRiseM], key).toEqual([f.reachM, f.lod1.reachM, f.capRiseM, f.lod1.capRiseM]);
            expect(p.planes, key).toEqual(f.planes);
          }
        }
      },
    );
  });

  it("stops a chain's earthworks at a portal: the plane clips every piece of the chain within reach", () => {
    // Flat ground at 0, a 10 m block for q ≥ 19 on rows 16–24: a ground run to (18, 20), then a tunnel into the block.
    const terrain = makeTerrain(120, 40, (q, r) => (r >= 16 && r <= 24 && q >= 19 && q <= 40 ? 100 : 0), -100);
    const sim = simOn(terrain);
    const run = (q0: number, n: number): PieceSpec[] => Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r: 20, zMm: 0 }, heading: 0, z1Mm: 0 }) as const);
    expect(sim.execute({ type: "build-track", pieces: run(10, 8), structure: "ground" }).ok).toBe(true);
    // Before the tunnel, the run's buffer end at (18, 20) is a query plane only: the cone cuts into the block.
    const coneMm = sim.groundMm(20, 20) ?? 0;
    expect(coneMm).toBeLessThan(8000);
    const tunnel = sim.execute({ type: "build-track", pieces: run(18, 8), structure: "auto" });
    expect(tunnel.ok, JSON.stringify(tunnel)).toBe(true);
    if (!tunnel.ok) return;
    // Judged with the end clipped, the first pieces into the block are tunnel, as a single drag would make them.
    expect(tunnel.diff.added.map((a) => a.structure)).toEqual(Array(8).fill("tunnel"));
    // Once the tunnel is built every piece of the run carries the fixed plane at (18, 20), and the block behind the
    // portal is natural again past the 45° headwall: at (21, 20), 15 m past the plane, the headwall stands 15 m up.
    for (const p of sim.ground().pieces.values()) expect(p.planes.some((c) => c.fixed && c.key === "18,20,0"), p.key).toBe(true);
    expect(sim.groundMm(21, 20)).toBe(10_000);

  });

  it("leaves water nodes at the water surface and nodes far from track on the terrain", () => {
    const { terrain } = diorama();
    const sim = simOn(terrain);
    for (const n of [
      { q: 0, r: 290 },
      { q: 100, r: 50 },
      { q: 250, r: 150 },
    ]) {
      expect(sim.groundMm(n.q, n.r)).toBe(groundMmAt(terrain, n));
    }
  });

  it("clips a command's joined buffer end: a chained drag into a hill sees the ground a single drag does", () => {
    const terrain = makeTerrain(120, 40, (q) => (q >= 30 ? Math.min(150, (q - 30) * 20) : 0), -100);
    const single = simOn(terrain);
    const chained = simOn(terrain);
    const straight = (q0: number, n: number): PieceSpec[] =>
      Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r: 20, zMm: 0 }, heading: 0, z1Mm: 0 }) as const);
    const all = single.preview({ type: "build-track", pieces: straight(10, 40), structure: "auto" });
    expect(chained.execute({ type: "build-track", pieces: straight(10, 20), structure: "auto" }).ok).toBe(true);
    const rest = chained.preview({ type: "build-track", pieces: straight(30, 20), structure: "auto" });
    expect(all.ok && rest.ok).toBe(true);
    if (!all.ok || !rest.ok) return;
    const byKey = new Map(all.diff.added.map((a) => [a.key, a.structure]));
    for (const a of rest.diff.added) expect(a.structure, a.key).toBe(byKey.get(a.key));
    expect(rest.diff.added.some((a) => a.structure === "tunnel")).toBe(true);
  });
});
