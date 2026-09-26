import { type NodeRef, type PieceSpec, resolvePiece } from "../../src/core/geometry/piece";
import { CURVE_TURNS, type RadiusClassM, type Turn, curveVariantCount } from "../../src/core/geometry/templates";
import { type Heading, HEADINGS, opposite } from "../../src/core/lattice";
import type { Command, Result } from "../../src/core/sim/world";
import { nodeOfOffset } from "../../src/core/terrain";
import type { Prng } from "../../src/core/util/prng";
import { pick } from "./forall";

/**
 * Seeded generators of track commands for property tests. Mostly valid,
 * chained pieces on a small map, with enough clashes, kinks, off-map ends,
 * invalid closing curves and bogus targets that every D2 rule family gets
 * exercised. Two codes are out of reach here and have fixtures of their own:
 * `limit-reached` (needs 5,000 pieces) and `undo-blocked` (needs a loaded
 * history).
 */

/** Small radii dominate: large ones rarely fit a small test map. */
const RADII: readonly RadiusClassM[] = [60, 60, 60, 90, 90, 120, 180];
/** Most track is level; some climbs, and one grade-separated level. */
const Z_STEPS = [0, 0, 0, 0, 175, -175, 100];
const LEVELS = [0, 0, 0, 7000];

export interface MapSize {
  readonly columns: number;
  readonly rows: number;
}

export function randomNode(prng: Prng, size: MapSize, zMm: number): NodeRef {
  const n = nodeOfOffset(prng.nextInt(size.columns), prng.nextInt(size.rows));
  return { q: n.q, r: n.r, zMm };
}

export function randomSpec(prng: Prng, from: NodeRef, heading: Heading): PieceSpec {
  const z1Mm = from.zMm + pick(prng, Z_STEPS);
  const roll = prng.nextInt(20);
  if (roll < 10) return { kind: "straight", from, heading, z1Mm };
  if (roll < 17) {
    const turn = pick(prng, CURVE_TURNS);
    const radiusM = pick(prng, RADII);
    const variant = prng.nextInt(curveVariantCount(heading, turn, radiusM));
    return { kind: "curve", from, heading, turn, radiusM, variant, z1Mm };
  }
  return { kind: "shift", from, heading, side: prng.nextInt(2) === 0 ? "left" : "right", z1Mm };
}

/** The far end of a spec and the heading a following piece continues on. */
export function continuation(spec: PieceSpec): { node: NodeRef; heading: Heading } {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(`generator produced an unresolvable spec: ${res.failure.message}`);
  const [a, b] = res.piece.ends;
  const far = a.node.q === spec.from.q && a.node.r === spec.from.r && a.node.zMm === spec.from.zMm ? b : a;
  return { node: far.node, heading: opposite(far.outward) };
}

/** A chain of 1–`maxLength` pieces from a random node, each starting where the last ended. */
export function randomChain(prng: Prng, size: MapSize, maxLength: number): PieceSpec[] {
  let node = randomNode(prng, size, pick(prng, LEVELS));
  let heading = pick(prng, HEADINGS);
  const out: PieceSpec[] = [];
  const length = 1 + prng.nextInt(maxLength);
  for (let i = 0; i < length; i++) {
    const spec = randomSpec(prng, node, heading);
    out.push(spec);
    ({ node, heading } = continuation(spec));
  }
  return out;
}

/**
 * A curve from `from` that fails geometry: one of `radius-too-tight`,
 * `turn-too-sharp` or `no-fit` (a variant one past the last).
 */
export function invalidCurve(prng: Prng, from: NodeRef, heading: Heading): PieceSpec {
  const turn = pick(prng, CURVE_TURNS);
  const z1Mm = from.zMm;
  switch (prng.nextInt(3)) {
    case 0:
      return { kind: "curve", from, heading, turn, radiusM: 50 as RadiusClassM, variant: 0, z1Mm };
    case 1:
      return { kind: "curve", from, heading, turn: (turn < 0 ? -4 : 4) as Turn, radiusM: 60, variant: 0, z1Mm };
    default: {
      const radiusM = pick(prng, RADII);
      return { kind: "curve", from, heading, turn, radiusM, variant: curveVariantCount(heading, turn, radiusM), z1Mm };
    }
  }
}

/**
 * One step of a random command plan. Demolish targets are drawn later from
 * the keys learned so far (`toCommand`), so a plan is plain data that prints
 * in a failure message and replays identically on twin sims.
 */
export type PlanStep =
  | { readonly type: "build-track"; readonly pieces: readonly PieceSpec[]; readonly structure: "ground" | "auto" }
  | { readonly type: "demolish"; readonly picks: readonly number[]; readonly bogus: boolean }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

export function randomPlan(prng: Prng, size: MapSize, length: number): PlanStep[] {
  return Array.from({ length }, (): PlanStep => {
    const roll = prng.nextInt(20);
    if (roll < 11) {
      const pieces = randomChain(prng, size, 5);
      const last = pieces[pieces.length - 1];
      // Now and then an invalid curve ends the chain, so geometry rejects too.
      // It goes last because `continuation` cannot follow a spec that fails.
      if (last && prng.nextInt(6) === 0) {
        const { node, heading } = continuation(last);
        pieces.push(invalidCurve(prng, node, heading));
      }
      return { type: "build-track", pieces, structure: prng.nextInt(4) === 0 ? "auto" : "ground" };
    }
    if (roll < 14) {
      return { type: "demolish", picks: Array.from({ length: 1 + prng.nextInt(2) }, () => prng.nextUint32()), bogus: prng.nextInt(5) === 0 };
    }
    return { type: prng.nextInt(2) === 0 ? "undo" : "redo" };
  });
}

/** Resolves a plan step against the keys learned so far. */
export function toCommand(step: PlanStep, known: readonly string[]): Command {
  if (step.type !== "demolish") return step;
  const pieces = step.picks.map((n, i) =>
    known.length === 0 || (step.bogus && i === 0) ? `S:${n % 7},${n % 5},0:0:0` : (known[n % known.length] as string),
  );
  return { type: "demolish", pieces };
}

/** Collects keys a result added, for later demolish targets. */
export function learnKeys(result: Result, into: string[]): void {
  if (result.ok) for (const r of result.diff.added) if (!into.includes(r.key)) into.push(r.key);
}
