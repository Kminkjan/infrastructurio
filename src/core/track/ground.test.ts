import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { diorama, groundPlans } from "../../../tests/support/groundPlans";
import { forAll } from "../../../tests/support/forall";
import { simOn } from "../../../tests/support/simOn";
import type { PieceSpec } from "../geometry/piece";
import { type Drag, type Sim, groundMmAt, nearestNode, resolvePiece, toWorld } from "../sim/api";
import { DAYLIGHT_ROUND_M, conformedHeightM, earthworkPieces, naturalHeightAtM, networkAdjacency } from "./earthworks";

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

  it("gives the same ground round a portal built in steps, undone and redone, as built at once (D4 portal wedges)", () => {
    // The approach, then the tunnel, then a second approach beyond it, one command each, with an undo and a redo; the
    // ground at every node round both portals equals a fresh sim's that built the same pieces in one command.
    const terrain = makeTerrain(120, 40, (_q, _r, col) => (col === 29 ? 60 : col >= 30 && col <= 45 ? 140 : 0), -100);
    const run = (q0: number, n: number): PieceSpec[] => Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r: 20, zMm: 0 }, heading: 0, z1Mm: 0 }) as const);
    const steps = [run(10, 9), run(19, 8), run(27, 16)];
    const stepped = simOn(terrain);
    for (const pieces of steps) expect(stepped.execute({ type: "build-track", pieces, structure: "auto" }).ok).toBe(true);
    // Read the ground once (filling the node cache), undo and redo the last step, then compare.
    for (let q = 5; q < 50; q++) for (let r = 10; r < 31; r++) stepped.groundMm(q, r);
    expect(stepped.execute({ type: "undo" }).ok).toBe(true);
    for (let q = 5; q < 50; q++) for (let r = 10; r < 31; r++) stepped.groundMm(q, r);
    expect(stepped.execute({ type: "redo" }).ok).toBe(true);
    const fresh = simOn(terrain);
    expect(fresh.execute({ type: "build-track", pieces: steps.flat(), structure: "auto" }).ok).toBe(true);
    expect(stepped.network().pieces.map((p) => `${p.key}:${p.structure}`).sort()).toEqual(fresh.network().pieces.map((p) => `${p.key}:${p.structure}`).sort());
    let differs = 0;
    for (let q = 5; q < 50; q++) {
      for (let r = 10; r < 31; r++) {
        if (stepped.groundMm(q, r) !== fresh.groundMm(q, r)) differs += 1;
      }
    }
    expect(differs).toBe(0);
    // And the portals are there: the tunnel runs between two planes.
    const planes = new Set([...fresh.ground().pieces.values()].flatMap((p) => p.planes.filter((c) => c.tunnel).map((c) => c.key)));
    expect(planes.size).toBe(2);
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

  it("keeps the hill behind a portal: the natural ground within the retained skyline, no pit (D4 second feel check)", () => {
    // Flat at 0 m; by column (x ≈ 5 · col) a 6 m step at column 29 and a 14 m hill from column 30. Ground from (10, 20)
    // to the portal at (19, 20) (col 29), a tunnel on to (27, 20). Until the fix the headwall behind the face started at
    // the track bed: 5 m past the plane the effective ground stood at 5 m under a 14 m hill, 2.5 m past it one row
    // north at 2.8 m on a 6 m step.
    const terrain = makeTerrain(120, 40, (_q, _r, col) => (col === 29 ? 60 : col >= 30 && col <= 45 ? 140 : 0), -100);
    const sim = simOn(terrain);
    const run = (q0: number, n: number): PieceSpec[] => Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r: 20, zMm: 0 }, heading: 0, z1Mm: 0 }) as const);
    const built = sim.execute({ type: "build-track", pieces: [...run(10, 9), ...run(19, 8)], structure: "auto" });
    expect(built.ok && built.diff.added.filter((a) => a.structure === "tunnel").length).toBe(8);
    // Where the hill lies under the retained skyline (7.65 m + t over the face), the effective ground is the hill.
    expect(sim.groundMm(19, 21)).toBe(6000);
    const portal = toWorld({ q: 19, r: 20 });
    for (let q = 20; q <= 26; q++) {
      for (const r of [19, 20, 21]) {
        // Nodes 2.5 m or more past the plane: the hill, or the skyline rising at 45° where the hill stands over it.
        const w = toWorld({ q, r });
        const t = w.x - portal.x;
        const natural = (groundMmAt(terrain, { q, r }) ?? 0) / 1000;
        const trimmed = Math.min(natural, 7.65 - Math.max(0, Math.abs(w.y - portal.y) - 4.2) / 1.5 + t);
        const got = (sim.groundMm(q, r) ?? 0) / 1000;
        // The smooth clamp at the daylight line rounds within DAYLIGHT_ROUND_M / 4 (0.15 m).
        expect(got, `${q},${r}`).toBeGreaterThanOrEqual(trimmed - DAYLIGHT_ROUND_M / 4 - 1e-3);
        expect(got, `${q},${r}`).toBeLessThanOrEqual(natural);
      }
    }
    // 5 m past the face the hill (14 m) stands over the headwall (12.65 m): trimmed there, not dug to 5 m.
    expect(sim.groundMm(20, 20)).toBe(12_650);
    expect(sim.groundMm(21, 20)).toBe(14_000);
    // Along the centreline behind the face: never under min(hill, skyline + t) by more than the smooth clamp's rounding,
    // and exactly the hill where it lies clear under the skyline.
    const pieces = [...sim.ground().pieces.values()];
    for (let t = 0.05; t <= 12; t += 0.05) {
      const natural = naturalHeightAtM(terrain, portal.x + t, portal.y);
      const h = conformedHeightM(pieces, portal.x + t, portal.y, natural, 0, null, "ground");
      expect(h, `t ${t}`).toBeGreaterThanOrEqual(Math.min(natural, 7.65 + t) - DAYLIGHT_ROUND_M / 4 - 1e-9);
      if (natural < 7.65 + t - DAYLIGHT_ROUND_M) expect(h, `t ${t}`).toBe(natural);
      // The renderer's underlay keeps the earlier headwall from the bed.
      expect(conformedHeightM(pieces, portal.x + t, portal.y, natural), `t ${t}`).toBeLessThanOrEqual(t + 1e-9);
    }
  });

  it("keeps the hill behind a diorama portal of the diagnosis scenes, (220, 140) → (236, 140)", () => {
    // A Straight line on the diorama: nine ground pieces, then seven tunnel pieces into the hill (11.2 m of natural cover
    // at its end). Before the fix the node 5 m behind the portal had 4.82 m of effective cover under 8.05 m of hill.
    const { terrain } = diorama();
    const sim = simOn(terrain);
    const from = { q: 220, r: 140, zMm: sim.groundMm(220, 140) ?? 0 };
    const drag: Drag = { from, to: point(236, 140), dzMm: (sim.groundMm(236, 140) ?? 0) - from.zMm, magnetism: true, heightMode: "straight" };
    const plan = sim.planTrack(drag);
    const built = sim.execute({ type: "build-track", pieces: plan.pieces, structure: "auto" });
    const structures = new Map(built.ok ? built.diff.added.map((a) => [a.key, a.structure[0]]) : []);
    expect(plan.pieces.map((spec) => { const res = resolvePiece(spec); return res.ok ? structures.get(res.piece.key) : "?"; }).join("")).toBe("gggggggggttttttt");
    for (let q = 230; q <= 236; q++) expect(sim.groundMm(q, 140), `${q}`).toBe(groundMmAt(terrain, { q, r: 140 }));
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
