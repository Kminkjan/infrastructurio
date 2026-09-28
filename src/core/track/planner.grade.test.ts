import { describe, expect, it } from "vitest";
import { autoGradeSamples, describeAutoGrade, measureAutoGrade } from "../../../tests/support/autoGrade";
import { forAll, pick } from "../../../tests/support/forall";
import { diorama } from "../../../tests/support/groundPlans";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { type NodeRef, type PieceSpec, resolvePiece } from "../geometry/piece";
import { type Heading, HEADINGS, SQRT3, stepLengthMm, stepOf } from "../lattice";
import type { Command, Result } from "../sim/api";
import { type World, createWorld } from "../sim/world";
import { type Terrain, groundMmAt, heightDmAt, isWaterAt, nodeOfOffset } from "../terrain";
import { createPrng } from "../util/prng";
import type { Drag, TrackPlan } from "./planner";
import { GROUND_BAND_MM } from "./structure";

/**
 * D4 auto-grade (owner decision 2026-09-28, "Auto-grade": "Track follows the
 * ground wherever it can within 35‰; the rest is absorbed by
 * cuttings/embankments (±4 m) and, beyond that, automatic bridges and tunnels.
 * The end may sit above or below the ground; the tooltip shows by how much."),
 * with the thresholds of the owner decision 2026-09-28 "M2": cuttings and
 * embankments up to 8 m.
 *
 * Drag cases on shaped 200 × 174-node maps (row 60 runs east; col = q + 30),
 * then properties, the simulation model's open point 4 (do ordinary seeded
 * hills still admit a tunnel?) and a measurement on the diorama.
 */

const SIZE = { columns: 200, rows: 174 } as const;
const ROW = 60;

/** A map whose height (dm) depends on the column only, with its water level (dm). */
function profileTerrain(heightDm: (col: number) => number, waterDm = -100): Terrain {
  return makeTerrain(SIZE.columns, SIZE.rows, (_q, _r, col) => heightDm(col), waterDm);
}

function at(q: number, r: number): { xMm: number; yMm: number } {
  return { xMm: 2500 * (2 * q + r), yMm: 2500 * SQRT3 * r };
}

function ground(t: Terrain, n: { q: number; r: number }): number {
  return groundMmAt(t, n) ?? Number.NaN;
}

/** An auto drag east along row 60 from col `c0` to col `c1`, starting on the ground, as the tool makes it. */
function eastDrag(t: Terrain, c0: number, c1: number): Drag {
  const q0 = c0 - ROW / 2;
  const q1 = c1 - ROW / 2;
  const from = { q: q0, r: ROW, zMm: ground(t, { q: q0, r: ROW }) };
  return { from, fromHeading: 0, to: at(q1, ROW), dzMm: ground(t, { q: q1, r: ROW }) - from.zMm, magnetism: true, heightMode: "auto" };
}

function build(pieces: readonly PieceSpec[]): Command {
  return { type: "build-track", pieces, structure: "auto" };
}

function nodesOf(plan: TrackPlan): NodeRef[] {
  const first = plan.pieces[0];
  if (!first) return [];
  const out: NodeRef[] = [first.from];
  for (const spec of plan.pieces) {
    const res = resolvePiece(spec);
    if (!res.ok) throw new Error(res.failure.message);
    const [a, b] = res.piece.ends;
    out.push(a.node.q === spec.from.q && a.node.r === spec.from.r && a.node.zMm === spec.from.zMm ? b.node : a.node);
  }
  return out;
}

function within35(pieces: readonly PieceSpec[]): boolean {
  return pieces.every((p) => {
    const res = resolvePiece(p);
    return res.ok && Math.abs(p.z1Mm - p.from.zMm) * 1000 <= 35 * res.piece.lengthMm;
  });
}

function ok(result: Result): Extract<Result, { ok: true }> {
  if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
  return result;
}

describe("auto-grade drag cases", () => {
  it("up a hill too steep for 35‰: climbs at 35‰ and ends in a cutting, below the ground by what the grade leaves", () => {
    // From col 80 the ground climbs 0.3 m per 5 m column (60‰) from 20 m.
    const t = profileTerrain((col) => 200 + Math.max(0, 3 * (col - 80)));
    const w = createWorld(t);
    const plan = w.plan(eastDrag(t, 80, 100));
    expect(plan.pieces).toHaveLength(20);
    // The end is free: the nearest height to the ground (26 m) that 35‰ reaches from 20 m, 23.5 m.
    expect(plan.end?.node.zMm).toBe(23_500);
    expect(nodesOf(plan).map((n) => n.zMm - ground(t, n))).toEqual(Array.from({ length: 21 }, (_, i) => 0 - 125 * i));
    expect(plan.pieces.every((p) => p.z1Mm - p.from.zMm === 175)).toBe(true);
    expect(ok(w.run(build(plan.pieces), false)).diff.added.every((r) => r.structure === "ground")).toBe(true);
  });

  it("into a valley: follows the ground to its rims, then crosses on a bridge where it runs more than 8 m up", () => {
    // A valley 16 m deep with 100‰ sides around col 100, in 20 m land; no water. (12 m deep until the ±8 m band,
    // owner decision 2026-09-28 "M2": its 7.8 m crossing is an embankment now.)
    const t = profileTerrain((col) => 200 - Math.max(0, 160 - 5 * Math.abs(col - 100)));
    const w = createWorld(t);
    const plan = w.plan(eastDrag(t, 60, 140));
    expect(within35(plan.pieces)).toBe(true);
    const d = nodesOf(plan).map((n) => n.zMm - ground(t, n));
    // On the ground to the rims (col 68 and 132), then 35‰ down from each: 10.4 m up at the middle.
    expect(d.slice(0, 9)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(d[40]).toBe(10_400);
    expect(Math.min(...d)).toBe(0);
    const structures = ok(w.run(build(plan.pieces), false)).diff.added.map((r) => r.structure);
    // More than 8 m up from col 93 to col 107: 16 bridge pieces, embankments up to 8 m either side.
    expect(structures.filter((s) => s === "bridge")).toHaveLength(16);
    expect(structures.filter((s) => s === "tunnel")).toHaveLength(0);
  });

  it("over water: climbs to the water level + 4 m before the water and bridges it", () => {
    // Land at 11 m; a river 30 m wide (cols 98–103) with its bed at 7 m under water at 10 m.
    const t = profileTerrain((col) => (col >= 98 && col <= 103 ? 70 : 110), 100);
    const w = createWorld(t);
    const plan = w.plan(eastDrag(t, 60, 140));
    expect(within35(plan.pieces)).toBe(true);
    const nodes = nodesOf(plan);
    // Every node beside or over the water (cols 97–104) carries the deck at 14 m or more.
    for (const n of nodes) if (Math.abs(n.q + ROW / 2 - 100.5) <= 4) expect(n.zMm).toBeGreaterThanOrEqual(14_000);
    const result = ok(w.run(build(plan.pieces), false));
    const wetKeys = plan.pieces.filter((p) => isWaterAt(t, p.from) || isWaterAt(t, { q: p.from.q + 1, r: p.from.r })).map((p) => resolvePiece(p));
    for (const res of wetKeys) expect(res.ok && result.diff.added.find((r) => r.key === res.piece.key)?.structure).toBe("bridge");
    // Both ends on the ground: the approaches ramp up at 35‰ and down again.
    expect(plan.end?.node.zMm).toBe(11_000);
  });

  it("through a steep-faced hill: stays level and tunnels under it, with the portals on its faces", () => {
    // A plateau 15 m above 20 m land from col 95 to 115, its faces rising 5 m per column (100%).
    const t = profileTerrain((col) => 200 + Math.max(0, Math.min(150, 50 * Math.min(col - 92, 118 - col))));
    const w = createWorld(t);
    const plan = w.plan(eastDrag(t, 70, 140));
    expect(within35(plan.pieces)).toBe(true);
    const structures = ok(w.run(build(plan.pieces), false)).diff.added.map((r) => r.structure);
    expect(structures.filter((s) => s === "tunnel").length).toBeGreaterThanOrEqual(20);
    expect(structures.filter((s) => s === "bridge")).toHaveLength(0);
  });

  it("with fixed heights 35‰ cannot join, returns a uniform ramp that preview rejects with the length it needs", () => {
    const t = profileTerrain(() => 200);
    const w = createWorld(t);
    // 3 m up in 50 m (60‰), as height steps would ask.
    const plan = w.plan({ ...eastDrag(t, 80, 90), heightMode: "fixed", dzMm: 3000 });
    expect(plan.pieces.map((p) => p.z1Mm - p.from.zMm)).toEqual(Array<number>(10).fill(300));
    expect(plan.label).toBe("Straight · 60 km/h · 6.0%");
    expect(w.run(build(plan.pieces), false)).toMatchObject({
      ok: false,
      reason: {
        code: "grade-too-steep",
        message: "The track climbs 3 m over 50 m (6.00 %), steeper than the 3.5 % maximum; it needs 85.8 m to climb 3 m, so lengthen the drag or change the end height.",
      },
    });
    // The same height over 90 m fits: exactly the D3 ramp, 175 mm a piece is within 35‰.
    const longer = w.plan({ ...eastDrag(t, 80, 98), heightMode: "fixed", dzMm: 3000 });
    expect(within35(longer.pieces)).toBe(true);
    expect(w.run(build(longer.pieces), false).ok).toBe(true);
  });

  it("still pins existing node heights in auto mode, so a drag over sloped track reuses it", () => {
    const t = profileTerrain(() => 200);
    // A sloped run on row 40, q 40–48, as in the D3 pinning tests (20.0 → 21.08 m).
    const zs = [20_000, 20_100, 20_200, 20_300, 20_400, 20_570, 20_740, 20_910, 21_080];
    const slope: PieceSpec[] = zs.slice(0, -1).map((z, i) => ({ kind: "straight", from: { q: 40 + i, r: 40, zMm: z }, heading: 0, z1Mm: zs[i + 1] ?? z }));
    const w = createWorld(t);
    ok(w.run(build(slope), true));
    const plan = w.plan({ from: { q: 40, r: 40, zMm: 20_000 }, fromHeading: 0, to: at(51, 40), dzMm: 0, magnetism: true, heightMode: "auto" });
    expect(plan.pieces.slice(0, 8)).toEqual(slope);
    expect(plan.counts).toEqual({ new: 3, reused: 8 });
    // Past the last pin the free end descends at 35‰ towards the ground: 21.08 − 3 × 0.175 m.
    expect(plan.end?.node.zMm).toBe(20_555);
    expect(ok(w.run(build(plan.pieces), true)).counts).toEqual(plan.counts);
    // A free end on existing track within reach takes that node's height: back to (44, 40) at 20.4 m, reused.
    const back = w.plan({ from: { q: 40, r: 40, zMm: 20_000 }, fromHeading: 0, to: at(44, 40), dzMm: 0, magnetism: true, heightMode: "auto" });
    expect(back.end?.node.zMm).toBe(20_400);
    expect(back.counts).toEqual({ new: 0, reused: 4 });
  });
});

// ---------------------------------------------------------------------------
// Properties

/** Rolling hills of ±6 m around 20 m with a lake (bed 12 m under water at 16 m) on a 120 × 104 map. */
const PROP = { columns: 120, rows: 104 } as const;
const HILLS = makeTerrain(
  PROP.columns,
  PROP.rows,
  (_q, _r, col, row) => {
    const lake = (col - 80) * (col - 80) + (row - 30) * (row - 30) < 144;
    return lake ? 120 : 200 + 60 * Math.sin(col / 9) * Math.cos(row / 7);
  },
  160,
);

function randomAutoDrag(prng: ReturnType<typeof createPrng>, from: NodeRef, terrain: Terrain): Drag {
  const heading: Heading = pick(prng, HEADINGS);
  const straight = prng.nextInt(2) === 0;
  const k = 5 + prng.nextInt(30);
  const d = stepOf(heading);
  const to = straight ? at(from.q + d.q * k, from.r + d.r * k) : { xMm: at(from.q, from.r).xMm + prng.nextInt(300_001) - 150_000, yMm: at(from.q, from.r).yMm + prng.nextInt(300_001) - 150_000 };
  const end = { q: Math.round(to.xMm / 5000 - (to.yMm / (2500 * SQRT3)) / 2), r: Math.round(to.yMm / (2500 * SQRT3)) };
  const fromHeading = prng.nextInt(4) === 0 ? undefined : heading;
  return {
    from,
    ...(fromHeading === undefined ? {} : { fromHeading }),
    to,
    dzMm: (groundMmAt(terrain, end) ?? from.zMm) - from.zMm,
    magnetism: prng.nextInt(4) !== 0,
    heightMode: "auto",
  };
}

function innerStart(prng: ReturnType<typeof createPrng>, terrain: Terrain): NodeRef {
  const n = nodeOfOffset(20 + prng.nextInt(PROP.columns - 40), 20 + prng.nextInt(PROP.rows - 40));
  return { q: n.q, r: n.r, zMm: ground(terrain, n) };
}

describe("auto-grade properties", () => {
  it("keeps every piece of every auto plan on empty track within 35‰, plans deterministically, and previews what executes", () => {
    let pieces = 0;
    let structured = 0;
    forAll(
      { seed: "auto-grade-empty", runs: 200 },
      (prng) => randomAutoDrag(prng, innerStart(prng, HILLS), HILLS),
      (drag) => {
        const a = createWorld(HILLS);
        const b = createWorld(HILLS);
        const plan = a.plan(drag);
        expect(a.plan(drag)).toEqual(plan);
        expect(b.plan(drag)).toEqual(plan);
        if (plan.fit === "none") return;
        expect(within35(plan.pieces)).toBe(true);
        pieces += plan.pieces.length;
        const cmd = build(plan.pieces);
        const previewed = a.run(cmd, false);
        expect(b.run(cmd, true)).toEqual(previewed);
        expect(a.run(cmd, true)).toEqual(previewed);
        if (previewed.ok) structured += previewed.diff.added.filter((r) => r.structure !== "ground").length;
      },
    );
    expect(pieces).toBeGreaterThan(2000);
    expect(structured).toBeGreaterThan(0);
  });

  it("chains auto drags from each accepted end: within 35‰ unless an existing node's height forces a steeper span, which preview rejects", () => {
    let chained = 0;
    forAll(
      { seed: "auto-grade-chains", runs: 40 },
      (prng) => ({ seed: prng.nextUint32(), start: innerStart(prng, HILLS) }),
      ({ seed, start }) => {
        const prng = createPrng(`chain-${seed}`);
        const w: World = createWorld(HILLS);
        const twin: World = createWorld(HILLS);
        let from = start;
        let heading: Heading | undefined;
        for (let k = 0; k < 5; k++) {
          const drag = { ...randomAutoDrag(prng, from, HILLS), ...(heading === undefined ? {} : { fromHeading: heading }) };
          const plan = w.plan(drag);
          expect(twin.plan(drag)).toEqual(plan);
          if (plan.fit === "none" || !plan.end) continue;
          const verdict = w.run(build(plan.pieces), false);
          if (!within35(plan.pieces)) expect(!verdict.ok && verdict.reason.code).toBe("grade-too-steep");
          expect(twin.run(build(plan.pieces), true)).toEqual(verdict);
          if (!verdict.ok) continue;
          w.run(build(plan.pieces), true);
          if (k > 0) chained += 1;
          from = plan.end.node;
          heading = plan.end.heading;
        }
      },
    );
    expect(chained).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Open point 4 and the diorama

describe("the diorama under auto-grade (dev measurements, not gates)", () => {
  it("admits a tunnel through ordinary seeded hills under the ±8 m band: open point 4", async ({ annotate }) => {
    // Straight lines of 10–60 pieces over dry diorama land, both ends on the ground, where even the highest 35‰
    // profile between the ends lies more than 8 m (the band) under the ground: no cutting can take them, a tunnel
    // must. Until the owner decision 2026-09-28 "M2" the band was 4 m: then 300 such lines were found in 20,000
    // tries, the planner built 10 (3.3%) and the deepest profile 5 (1.7%), the rest failing tunnel-too-shallow (4–6 m
    // of cover more than 10 m from a portal). At 8 m, a node with less than 6 m of cover is itself a portal.
    const { terrain } = diorama();
    const w = createWorld(terrain);
    const prng = createPrng("tunnel-admission");
    let needTunnel = 0;
    let planned = 0;
    let deepest = 0;
    let tries = 0;
    let example: { from: NodeRef; heading: Heading; pieces: number } | null = null;
    for (; tries < 40_000 && needTunnel < 300; tries++) {
      const s = nodeOfOffset(40 + prng.nextInt(320), 40 + prng.nextInt(266));
      const h: Heading = HEADINGS[prng.nextInt(12)] ?? 0;
      const n = 10 + prng.nextInt(51);
      const d = stepOf(h);
      const nodes = Array.from({ length: n + 1 }, (_, i) => ({ q: s.q + d.q * i, r: s.r + d.r * i }));
      const g = nodes.map((x) => groundMmAt(terrain, x));
      if (g.some((x) => x === undefined) || nodes.some((x) => isWaterAt(terrain, x))) continue;
      const rise = Math.floor((35 * stepLengthMm(h)) / 1000);
      const z0 = g[0] ?? 0;
      const zn = g[n] ?? 0;
      if (Math.abs(zn - z0) > n * rise) continue;
      const highest = nodes.map((_, i) => Math.min(z0 + i * rise, zn + (n - i) * rise));
      if (!highest.some((z, i) => (heightDmAt(terrain, nodes[i] ?? { q: 0, r: 0 }) ?? 0) * 100 - z > GROUND_BAND_MM)) continue;
      needTunnel += 1;
      // The deepest 35‰ profile has the most cover everywhere.
      const lowest = nodes.map((_, i) => Math.max(z0 - i * rise, zn - (n - i) * rise));
      const specs = (zs: readonly number[]): PieceSpec[] =>
        nodes.slice(0, -1).map((x, i) => ({ kind: "straight", from: { q: x.q, r: x.r, zMm: zs[i] ?? 0 }, heading: h, z1Mm: zs[i + 1] ?? 0 }));
      if (w.run(build(specs(lowest)), false).ok) deepest += 1;
      const plan = w.plan({ from: { q: s.q, r: s.r, zMm: z0 }, fromHeading: h, to: at(nodes[n]?.q ?? 0, nodes[n]?.r ?? 0), dzMm: zn - z0, magnetism: false });
      const verdict = w.run(build(plan.pieces), false);
      if (plan.pieces.length === n && verdict.ok) {
        planned += 1;
        if (!example && verdict.diff.added.some((r) => r.structure === "tunnel")) example = { from: { q: s.q, r: s.r, zMm: z0 }, heading: h, pieces: n };
      }
    }
    const pct = (x: number) => `${((100 * x) / needTunnel).toFixed(1)}%`;
    await annotate(
      `${needTunnel} straight lines that need a tunnel in ${tries} tries: the planner's profile builds ${planned} (${pct(planned)}), the deepest 35‰ profile ${deepest} (${pct(deepest)})`,
    );
    expect(needTunnel).toBeGreaterThanOrEqual(200);
    if (!example) throw new Error("no tunnel example found");
    await annotate(`example: ${example.pieces} pieces from (${example.from.q}, ${example.from.r}) on heading ${example.heading}`);
    // Ordinary hills now admit them: measured at 100% on both profiles when written (2026-09-28).
    expect(planned / needTunnel).toBeGreaterThanOrEqual(0.95);
    expect(deepest / needTunnel).toBeGreaterThanOrEqual(0.95);
  });

  it("accepts most auto-graded free and chained drags; reports reasons, structures, deviations and grades", async ({ annotate }) => {
    const samples = autoGradeSamples(600, 80);
    const stats = measureAutoGrade(samples);
    for (const line of describeAutoGrade(stats)) await annotate(line);
    const chained = measureAutoGrade(samples.filter((s) => s.chained));
    for (const line of describeAutoGrade(chained)) await annotate(`chained: ${line}`);
    // Loose guards against a degenerate planner (when written, at 1,000 + 150 chains: 72.9% accepted, no piece
    // over 35‰ outside a pinned span, 86.6% ground pieces; under the owner decision 2026-09-28 "M2": 88.7%
    // accepted, 95.3% of the 1,000 free drags, 88.3% ground pieces).
    expect(stats.accepted / stats.drags).toBeGreaterThan(0.6);
    expect(stats.steepPlans / stats.drags).toBeLessThan(0.01);
    expect(stats.structures.get("bridge") ?? 0).toBeGreaterThan(0);
    expect(stats.structures.get("tunnel") ?? 0).toBeGreaterThan(0);
  });
});

describe('straight height mode (owner decision 2026-09-28, "One \'Straight line\' tool")', () => {
  /** A straight drag east along row 60 from col c0 to col c1: from the ground there, the end wanted `liftMm` above the ground at c1. */
  function straightDrag(t: Terrain, c0: number, c1: number, liftMm = 0): Drag {
    const auto = eastDrag(t, c0, c1);
    return { ...auto, dzMm: auto.dzMm + liftMm, heightMode: "straight" };
  }

  it("lays one steady grade to the end, whatever the ground between does", () => {
    // A 6 m ridge between flats at 20 m: auto-grade climbs over it; a straight line runs level through it.
    const t = profileTerrain((col) => 200 + Math.max(0, 60 - Math.abs(col - 100) * 3));
    const w = createWorld(t);
    const plan = w.plan(straightDrag(t, 80, 120));
    expect(plan.pieces).toHaveLength(40);
    expect(plan.pieces.every((p) => p.from.zMm === 20_000 && p.z1Mm === 20_000)).toBe(true);
    // Two metres up at the far end: 2,000 mm apportioned by length over the 40 pieces, 50 mm each.
    const lifted = w.plan(straightDrag(t, 80, 120, 2000));
    expect(lifted.pieces.map((p) => p.z1Mm - p.from.zMm)).toEqual(Array(40).fill(50));
    expect(lifted.end?.node.zMm).toBe(22_000);
  });

  it("moves an end 35‰ cannot reach to the nearest height it can, so a straight line is never too steep", () => {
    // From a plain at 0 m to a plateau at 30 m over 20 pieces (100 m): 35‰ reaches 3.5 m, so the end sits at 3.5 m.
    const t = profileTerrain((col) => (col >= 110 ? 300 : 0));
    const w = createWorld(t);
    const plan = w.plan(straightDrag(t, 90, 110));
    expect(plan.end?.node.zMm).toBe(3500);
    expect(plan.pieces.every((p) => p.z1Mm - p.from.zMm === 175)).toBe(true);
    expect(within35(plan.pieces)).toBe(true);
    const down = w.plan({ ...straightDrag(t, 90, 110), dzMm: -50_000 });
    expect(down.end?.node.zMm).toBe(-3500);
  });

  it("keeps a snapped port's height, and a port out of 35‰ reach gives a ramp preview rejects as too steep", () => {
    const t = profileTerrain(() => 200);
    const w = createWorld(t);
    // An existing buffer end 4 m up at col 110, row 60 (q 80), facing west.
    const stub: PieceSpec[] = [{ kind: "straight", from: { q: 80, r: ROW, zMm: 24_000 }, heading: 0, z1Mm: 24_000 }];
    ok(w.run(build(stub), true));
    const near = w.plan(straightDrag(t, 100, 110));
    expect(near.snapped).toEqual({ q: 80, r: ROW, zMm: 24_000 });
    expect(near.end?.node.zMm).toBe(24_000);
    const verdict = w.run(build(near.pieces), false);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason.code).toBe("grade-too-steep");
  });

  it("gives the structures from inference: a bridge over a valley, a tunnel through a hill, ground on the flat", () => {
    const valley = profileTerrain((col) => (col >= 95 && col <= 115 ? 80 : 200));
    const hill = profileTerrain((col) => (col >= 95 && col <= 125 ? 350 : 200));
    const flat = profileTerrain(() => 200);
    const kinds = (t: Terrain, c0: number, c1: number): string[] => {
      const w = createWorld(t);
      const plan = w.plan(straightDrag(t, c0, c1));
      return ok(w.run(build(plan.pieces), false)).diff.added.map((a) => a.structure);
    };
    expect(kinds(valley, 80, 130)).toContain("bridge");
    expect(kinds(valley, 80, 130)).not.toContain("tunnel");
    expect(kinds(hill, 80, 140)).toContain("tunnel");
    expect(kinds(hill, 80, 140)).not.toContain("bridge");
    expect(new Set(kinds(flat, 80, 130))).toEqual(new Set(["ground"]));
  });
});
