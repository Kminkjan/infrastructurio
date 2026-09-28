import { describe, expect, it } from "vitest";
import type { PieceSpec } from "../geometry/piece";
import { DEFAULT_TERRAIN_SIZE, generateTerrain, groundMmAt, nearestNode } from "./api";
import { type Drag, MAX_PIECES, type Sim, SQRT3, createSim } from "./api";

/**
 * Soft performance smoke, not a gate: the real bench with committed budgets
 * is D12 (acceptance gates B3/B4). A failure here means "look", on any
 * machine, and says nothing about the gate hardware.
 *
 * Since D4 the terrain decides structures: the 4,900 existing straights at
 * z = 0 lie 10–40 m under the diorama, so they are built as `auto` (tunnels
 * under at least 6 m of cover; until D4, ground), and the planner workloads
 * start on the ground in "auto" height mode, as the tool drags with no height
 * steps (until D4 they started at z = 0 in the one height mode).
 */

const DIORAMA = generateTerrain({ seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE });

/** A drag from the ground at (q, r) to `to`, as the tool makes it with no height steps (D4 auto-grade). */
function groundDrag(q: number, r: number, to: { xMm: number; yMm: number }, rest: Omit<Drag, "from" | "to" | "dzMm">): Drag {
  const z = groundMmAt(DIORAMA, { q, r }) ?? 0;
  const end = nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
  return { from: { q, r, zMm: z }, to, dzMm: (groundMmAt(DIORAMA, end) ?? z) - z, heightMode: "auto", ...rest };
}

function row(r: number, from: number, count: number): PieceSpec[] {
  const q0 = 0 - Math.floor(r / 2) + from;
  return Array.from({ length: count }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r, zMm: 0 }, heading: 0, z1Mm: 0 }));
}

/** The default map with `existing` straights in full rows from its south-west corner (rows 0–12 for 4,900). */
function filledSim(existing: number): Sim {
  const sim = createSim({ terrain: { seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE } });
  let built = 0;
  for (let r = 0; built < existing; r++) {
    const count = Math.min(DEFAULT_TERRAIN_SIZE.columns - 1, existing - built);
    const result = sim.execute({ type: "build-track", pieces: row(r, 0, count), structure: "auto" });
    expect(result.ok).toBe(true);
    built += count;
  }
  return sim;
}

/** Median, p95 (s[floor(0.95·n)]) and max of a sample, in ms with 3 decimals. */
function stats(samples: readonly number[]): string {
  const s = [...samples].sort((a, b) => a - b);
  const at = (i: number) => (s[Math.min(s.length - 1, i)] ?? Number.NaN).toFixed(3);
  return `median ${at(Math.floor(s.length / 2))} ms, p95 ${at(Math.floor(0.95 * s.length))} ms, max ${at(s.length - 1)} ms (n = ${s.length})`;
}

describe("preview performance smoke", () => {
  // 5,000 existing + 100 new would stop at limit-reached (rule 1) and time
  // almost nothing, so 4,900 existing + 100 new fills the map to the cap and
  // runs every rule, clearance included.
  it("previews a 100-piece build that fills the map to 5,000 pieces in under 20 ms (median of 7)", () => {
    const existing = MAX_PIECES - 100;
    const sim = filledSim(existing);
    expect(sim.network().pieces).toHaveLength(existing);
    // Row 12 holds 112 pieces; the new 100 continue it 4.33 m beside the full
    // row 11 and join it at a through node, so topology and the clearance
    // broadphase both see real neighbours.
    const cmd = { type: "build-track", pieces: row(12, 112, 100), structure: "auto" } as const;
    const first = sim.preview(cmd);
    expect(first).toMatchObject({ ok: true, counts: { new: 100, reused: 0 } });
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      sim.preview(cmd);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[3]).toBeLessThan(20);
  });
});

/** Plan position of node (q, r) in mm, plus an offset. */
function at(q: number, r: number, dxMm = 0, dyMm = 0): { xMm: number; yMm: number } {
  return { xMm: 2500 * (2 * q + r) + dxMm, yMm: 2500 * SQRT3 * r + dyMm };
}

/**
 * A fixed drag list: 168 free-end drags (two starts × headings 0, 1 and free × 7 directions within
 * ±60° × 4 distances of 50–200 m), 8 drags joining the east buffer end of row 12 by magnetism, and
 * 8 drags behind a fixed start heading. Those searched all 12 rings and came back empty until the
 * two-bend fallback (2026-09-27); now each is a U-turn.
 */
function plannerWorkload(): Drag[] {
  const drags: Drag[] = [];
  for (const [q, r] of [
    [150, 150],
    [220, 180],
  ] as const) {
    for (const heading of [0, 1, undefined] as const) {
      const base = heading === 1 ? 30 : 0;
      for (let deg = -60; deg <= 60; deg += 20) {
        for (let distM = 50; distM <= 200; distM += 50) {
          const a = ((base + deg) * Math.PI) / 180;
          drags.push(
            groundDrag(q, r, at(q, r, Math.round(distM * 1000 * Math.cos(a)), Math.round(distM * 1000 * Math.sin(a))), {
              ...(heading === undefined ? {} : { fromHeading: heading }),
              magnetism: true,
            }),
          );
        }
      }
    }
  }
  // Magnetism joins the port at its own height (z = 0), so these start at z = 0 too, in "fixed" mode as before.
  for (let i = 0; i < 8; i++) drags.push({ from: { q: 130 + 10 * i, r: 40, zMm: 0 }, fromHeading: 8, to: at(106, 13), dzMm: 0, magnetism: true });
  for (let i = 0; i < 8; i++) drags.push(groundDrag(150, 150, at(150, 150, -60_000 - 5000 * i, 3000 * i), { fromHeading: 0, magnetism: true }));
  return drags;
}

describe("planner performance (dev measurement, not a gate)", () => {
  it("plans a fixed drag list and previews the planned pieces over 4,900 existing pieces", async ({ annotate }) => {
    const sim = filledSim(MAX_PIECES - 100);
    const drags = plannerWorkload();
    const plans: number[] = [];
    const previews: number[] = [];
    let snapped = 0;
    let empty = 0;
    // One warm-up pass, then three timed passes over the same drags.
    for (let pass = 0; pass < 4; pass++) {
      for (const drag of drags) {
        const t0 = performance.now();
        const plan = sim.planTrack(drag);
        const t1 = performance.now();
        if (pass === 0 && plan.snapped) snapped += 1;
        if (pass === 0 && plan.fit === "none") empty += 1;
        if (pass > 0) plans.push(t1 - t0);
        if (plan.pieces.length === 0) continue;
        const t2 = performance.now();
        sim.preview({ type: "build-track", pieces: plan.pieces, structure: "auto" });
        const t3 = performance.now();
        if (pass > 0) previews.push(t3 - t2);
      }
    }
    await annotate(`planTrack: ${stats(plans)}`);
    await annotate(`preview of the planned pieces: ${stats(previews)}`);
    expect(drags).toHaveLength(184);
    expect(snapped).toBe(8);
    expect(empty).toBe(0);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;
    expect(median(plans)).toBeLessThan(20);
    expect(median(previews)).toBeLessThan(20);
  });

  it("plans two-bend-heavy drags: pointers behind the start and inside its turning circle", async ({ annotate }) => {
    // Per start (two) and fixed heading (0, 1, 5): 36 pointers behind (±100–180° × 20–200 m, the U-turn
    // fallback or an exact U-turn), 18 inside the 60 m turning circle (±40–80° at 30–70 m, the ring search
    // over one- and two-bend fits) and 4 abeam beyond it (exact two-bend fits): 348 drags.
    const sim = filledSim(MAX_PIECES - 100);
    const drags: Drag[] = [];
    const cases: (readonly [number, number])[] = [
      ...[100, 120, 140, 160, 180, -100, -120, -140, -160].flatMap((deg) => [20, 60, 120, 200].map((distM) => [deg, distM] as const)),
      ...[40, 60, 80, -40, -60, -80].flatMap((deg) => [30, 50, 70].map((distM) => [deg, distM] as const)),
      ...[90, -90].flatMap((deg) => [130, 180].map((distM) => [deg, distM] as const)),
    ];
    for (const [q, r] of [
      [150, 150],
      [220, 180],
    ] as const) {
      for (const heading of [0, 1, 5] as const) {
        for (const [deg, distM] of cases) {
          const a = ((heading * 30 + deg) * Math.PI) / 180;
          drags.push(groundDrag(q, r, at(q, r, Math.round(distM * 1000 * Math.cos(a)), Math.round(distM * 1000 * Math.sin(a))), { fromHeading: heading, magnetism: true }));
        }
      }
    }
    const plans: number[] = [];
    const previews: number[] = [];
    const fits = new Map<string, number>();
    for (let pass = 0; pass < 4; pass++) {
      for (const drag of drags) {
        const t0 = performance.now();
        const plan = sim.planTrack(drag);
        const t1 = performance.now();
        if (pass === 0) fits.set(plan.fit, (fits.get(plan.fit) ?? 0) + 1);
        if (pass > 0) plans.push(t1 - t0);
        if (plan.pieces.length === 0) continue;
        const t2 = performance.now();
        sim.preview({ type: "build-track", pieces: plan.pieces, structure: "auto" });
        const t3 = performance.now();
        if (pass > 0) previews.push(t3 - t2);
      }
    }
    await annotate(`planTrack, two-bend-heavy: ${stats(plans)}; fits ${[...fits].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    await annotate(`preview of the planned pieces: ${stats(previews)}`);
    expect(drags).toHaveLength(348);
    expect(fits.get("none") ?? 0).toBe(0);
    expect(fits.get("two-bend") ?? 0).toBeGreaterThan(200);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;
    expect(median(plans)).toBeLessThan(20);
  });

  it("plans the worst case the validation cap allows: every candidate of a long plan rejected", async ({ annotate }) => {
    // A secondary-heading line crossing the area; each target sits beside it, so every one of the
    // up to 8 candidates validated (plans of about 110 pieces) fails clearance at its far end.
    const sim = createSim({ terrain: { seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE } });
    const line: PieceSpec[] = Array.from({ length: 40 }, (_, i) => ({ kind: "straight", from: { q: 150 + i, r: 20 + i, zMm: 0 }, heading: 1, z1Mm: 0 }));
    expect(sim.execute({ type: "build-track", pieces: line, structure: "auto" }).ok).toBe(true);
    const drags: Drag[] = [
      [171, 39],
      [172, 39],
      [170, 41],
      [169, 40],
    ].map(([q, r]) => ({ from: { q: 40, r: 30, zMm: 0 }, fromHeading: 0, to: at(q ?? 0, r ?? 0), dzMm: 0, magnetism: false }));
    const times: number[] = [];
    for (let pass = 0; pass < 11; pass++) {
      for (const drag of drags) {
        const t0 = performance.now();
        const plan = sim.planTrack(drag);
        const t1 = performance.now();
        if (pass > 0) times.push(t1 - t0);
        if (pass === 0) {
          expect(plan.pieces.length).toBeGreaterThan(100);
          // Rule 6 either way: since D4 a far end that crosses the line in plan is `vertical-clearance`.
          const verdict = sim.preview({ type: "build-track", pieces: plan.pieces, structure: "auto" });
          expect(!verdict.ok && ["tracks-too-close", "vertical-clearance"].includes(verdict.reason.code)).toBe(true);
        }
      }
    }
    await annotate(`planTrack, all candidates rejected: ${stats(times)}`);
    expect([...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]).toBeLessThan(20);
  });
});
