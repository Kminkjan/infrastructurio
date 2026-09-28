import {
  type Drag,
  HEADINGS,
  type Heading,
  type NodeRef,
  type Result,
  type Sim,
  type Structure,
  type Terrain,
  type TrackPlan,
  groundMmAt,
  nearestNode,
  nodeOfOffset,
  resolvePiece,
  stepOf,
  toWorld,
} from "../../src/core/sim/api";
import { createPrng } from "../../src/core/util/prng";
import { diorama, toolStartMm } from "./groundPlans";
import { simOn } from "./simOn";

/**
 * Auto-graded drags on the diorama map, made as the track tool makes them
 * with no height steps (D4, owner decision 2026-09-28 "Auto-grade"): the
 * start on the ground (on water at the deck height, the water level + 4.0 m,
 * since the owner decision 2026-09-28 "M2"; or on the chain's last end),
 * `heightMode: "auto"`,
 * `dzMm` from the ground at the pointer's node, magnetism on. Free drags are
 * previewed on an empty network, each on its own; chains of 3–6 drags are
 * built on one network, each continuing from the last accepted end with its
 * heading, as the tool chains. Half the drags run straight for 10–40 steps
 * along a heading, half aim at a free pointer within ±150 m; a quarter of the
 * free starts have no heading. Starts lie at least 300 m inside the map.
 *
 * `measureAutoGrade` summarises what the rules make of them: the share
 * accepted, the rejection reasons, the structure mix, how far nodes sit from
 * the ground and how steep the pieces are. A dev measurement, not a gate.
 */

export interface AutoGradeSample {
  readonly plan: TrackPlan;
  readonly verdict: Result;
  readonly chained: boolean;
}

function point(q: number, r: number): { xMm: number; yMm: number } {
  const w = toWorld({ q, r });
  return { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) };
}

function autoDrag(terrain: Terrain, from: NodeRef, fromHeading: Heading | undefined, to: { xMm: number; yMm: number }): Drag {
  const end = nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
  return {
    from,
    ...(fromHeading === undefined ? {} : { fromHeading }),
    to,
    // As the tool: the ground at the pointer's node, or the start's own height off the map.
    dzMm: (groundMmAt(terrain, end) ?? from.zMm) - from.zMm,
    magnetism: true,
    heightMode: "auto",
  };
}

type Prng = ReturnType<typeof createPrng>;

function pointerFrom(prng: Prng, s: { q: number; r: number }, heading: Heading): { xMm: number; yMm: number; straight: boolean } {
  if (prng.nextInt(2) === 0) {
    const k = 10 + prng.nextInt(31);
    const d = stepOf(heading);
    return { ...point(s.q + d.q * k, s.r + d.r * k), straight: true };
  }
  const p = point(s.q, s.r);
  return { xMm: p.xMm + prng.nextInt(300_001) - 150_000, yMm: p.yMm + prng.nextInt(300_001) - 150_000, straight: false };
}

/** `free` independent drags on an empty network, then `chains` chains built on their own networks. */
export function autoGradeSamples(free: number, chains: number, seed = "auto-grade-probe"): AutoGradeSample[] {
  const { terrain, sim } = diorama();
  const prng = createPrng(seed);
  const out: AutoGradeSample[] = [];
  while (out.length < free) {
    const s = nodeOfOffset(60 + prng.nextInt(280), 80 + prng.nextInt(186));
    const heading: Heading = HEADINGS[prng.nextInt(12)] ?? 0;
    const to = pointerFrom(prng, s, heading);
    const fromHeading = !to.straight && prng.nextInt(2) === 0 ? undefined : heading;
    const from = { q: s.q, r: s.r, zMm: toolStartMm(terrain, s) };
    const plan = sim.planTrack(autoDrag(terrain, from, fromHeading, to));
    if (plan.fit === "none") continue;
    out.push({ plan, verdict: sim.preview({ type: "build-track", pieces: plan.pieces, structure: "auto" }), chained: false });
  }
  for (let c = 0; c < chains; c++) {
    const chainSim: Sim = simOn(terrain);
    const s = nodeOfOffset(60 + prng.nextInt(280), 80 + prng.nextInt(186));
    let from: NodeRef = { q: s.q, r: s.r, zMm: toolStartMm(terrain, s) };
    let heading: Heading | undefined = prng.nextInt(4) === 0 ? undefined : (HEADINGS[prng.nextInt(12)] ?? 0);
    const length = 3 + prng.nextInt(4);
    for (let k = 0; k < length; k++) {
      const to = pointerFrom(prng, from, heading ?? (HEADINGS[prng.nextInt(12)] ?? 0));
      const plan = chainSim.planTrack(autoDrag(terrain, from, heading, to));
      if (plan.fit === "none" || !plan.end) continue;
      const command = { type: "build-track", pieces: plan.pieces, structure: "auto" } as const;
      const verdict = chainSim.preview(command);
      out.push({ plan, verdict, chained: k > 0 });
      if (!verdict.ok) continue;
      chainSim.execute(command);
      from = plan.end.node;
      heading = plan.end.heading;
    }
  }
  return out;
}

export interface AutoGradeStats {
  readonly drags: number;
  readonly accepted: number;
  readonly reasons: ReadonlyMap<string, number>;
  /** Accepted plans' new pieces by structure. */
  readonly structures: ReadonlyMap<Structure, number>;
  readonly structureLengthMm: ReadonlyMap<Structure, number>;
  /** Node height minus the ground (`groundMmAt`) over every node of every plan, sorted. */
  readonly deviationsMm: readonly number[];
  /** |grade| in ‰ over every piece of every plan, sorted. */
  readonly gradesPermille: readonly number[];
  /** Plans with a piece over 35‰. */
  readonly steepPlans: number;
}

export function measureAutoGrade(samples: readonly AutoGradeSample[]): AutoGradeStats {
  const { terrain } = diorama();
  const reasons = new Map<string, number>();
  const structures = new Map<Structure, number>();
  const structureLengthMm = new Map<Structure, number>();
  const deviationsMm: number[] = [];
  const gradesPermille: number[] = [];
  let accepted = 0;
  let steepPlans = 0;
  for (const { plan, verdict } of samples) {
    const nodes: NodeRef[] = [plan.pieces[0]?.from ?? { q: 0, r: 0, zMm: 0 }];
    let steep = false;
    for (const spec of plan.pieces) {
      const res = resolvePiece(spec);
      if (!res.ok) continue;
      const [a, b] = res.piece.ends;
      const far = a.node.q === spec.from.q && a.node.r === spec.from.r && a.node.zMm === spec.from.zMm ? b.node : a.node;
      nodes.push(far);
      const g = (Math.abs(spec.z1Mm - spec.from.zMm) * 1000) / res.piece.lengthMm;
      gradesPermille.push(g);
      if (Math.abs(spec.z1Mm - spec.from.zMm) * 1000 > 35 * res.piece.lengthMm) steep = true;
    }
    if (steep) steepPlans += 1;
    for (const n of nodes) {
      const g = groundMmAt(terrain, n);
      if (g !== undefined) deviationsMm.push(n.zMm - g);
    }
    if (verdict.ok) {
      accepted += 1;
      for (const r of verdict.diff.added) structures.set(r.structure, (structures.get(r.structure) ?? 0) + 1);
      for (const spec of plan.pieces) {
        const res = resolvePiece(spec);
        if (!res.ok) continue;
        const record = verdict.diff.added.find((r) => r.key === res.piece.key);
        if (record) structureLengthMm.set(record.structure, (structureLengthMm.get(record.structure) ?? 0) + res.piece.lengthMm);
      }
    } else {
      reasons.set(verdict.reason.code, (reasons.get(verdict.reason.code) ?? 0) + 1);
    }
  }
  deviationsMm.sort((x, y) => x - y);
  gradesPermille.sort((x, y) => x - y);
  return { drags: samples.length, accepted, reasons, structures, structureLengthMm, deviationsMm, gradesPermille, steepPlans };
}

/** s[floor(q·n)] of a sorted sample. */
export function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
}

export function describeAutoGrade(s: AutoGradeStats): string[] {
  const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
  const abs = s.deviationsMm.map(Math.abs).sort((x, y) => x - y);
  const pieces = [...s.structures.values()].reduce((a, b) => a + b, 0);
  const length = [...s.structureLengthMm.values()].reduce((a, b) => a + b, 0);
  const band = (lo: number, hi: number) => s.gradesPermille.filter((g) => g >= lo && g < hi).length;
  return [
    `${s.drags} drags, ${s.accepted} accepted (${pct(s.accepted, s.drags)}); rejected: ${[...s.reasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
    `new pieces of accepted plans: ${(["ground", "bridge", "tunnel"] as const).map((k) => `${k} ${s.structures.get(k) ?? 0} (${pct(s.structures.get(k) ?? 0, pieces)} of pieces, ${pct(s.structureLengthMm.get(k) ?? 0, length)} of length)`).join(", ")}`,
    `node − ground over ${s.deviationsMm.length} nodes: on the ground ${pct(s.deviationsMm.filter((d) => d === 0).length, s.deviationsMm.length)}, |d| p50 ${(quantile(abs, 0.5) / 1000).toFixed(2)} m, p95 ${(quantile(abs, 0.95) / 1000).toFixed(2)} m, max ${(quantile(abs, 1) / 1000).toFixed(2)} m; beyond ±4 m ${pct(abs.filter((d) => d > 4000).length, abs.length)}, beyond ±8 m ${pct(abs.filter((d) => d > 8000).length, abs.length)} (min ${(quantile(s.deviationsMm, 0) / 1000).toFixed(2)} m, max ${(quantile(s.deviationsMm, 1) / 1000).toFixed(2)} m)`,
    `grades over ${s.gradesPermille.length} pieces: 0‰ ${pct(s.gradesPermille.filter((g) => g === 0).length, s.gradesPermille.length)}, (0, 10) ${pct(band(1e-9, 10), s.gradesPermille.length)}, [10, 20) ${pct(band(10, 20), s.gradesPermille.length)}, [20, 30) ${pct(band(20, 30), s.gradesPermille.length)}, [30, 35] ${pct(s.gradesPermille.filter((g) => g >= 30 && g <= 35).length, s.gradesPermille.length)}, over 35 ${pct(s.gradesPermille.filter((g) => g > 35).length, s.gradesPermille.length)}; p50 ${quantile(s.gradesPermille, 0.5).toFixed(1)}‰, p95 ${quantile(s.gradesPermille, 0.95).toFixed(1)}‰; plans with a piece over 35‰: ${s.steepPlans}`,
  ];
}
