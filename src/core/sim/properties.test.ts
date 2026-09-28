import { describe, expect, it } from "vitest";
import { forAll, shuffled } from "../../../tests/support/forall";
import { flatTerrain, simOn } from "../../../tests/support/simOn";
import { type PlanStep, learnKeys, randomPlan, toCommand } from "../../../tests/support/trackGen";
import { parseKey } from "../geometry/piece";
import { hashCanonical } from "../util/hash";
import type { NetworkView, Result, Sim } from "./api";

/**
 * Seeded properties over random command sequences (simulation model §17).
 * Plans mix chained builds (some ending in an invalid curve), demolitions of
 * real and missing keys, undo and redo on a 400 × 300 m map, so every D2 rule
 * family rejects some commands. All D2 codes appear except `limit-reached`
 * and `undo-blocked`, which need 5,000 pieces or a loaded history; their
 * negative fixtures cover them. Since D4 the map is flat dry ground at 0 m
 * (until D4 the seeded map "d2-properties", whose ground at 10–40 m the D4
 * terrain rules would judge the generator's track at 0 m against): the
 * generator's track lies on it, and its level at 7 m is a bridge under
 * structure auto and `needs-bridge` under ground.
 */

const SIZE = { columns: 80, rows: 70 } as const;
const TERRAIN = flatTerrain(SIZE.columns, SIZE.rows);

/** The network without its revision: the state a hash should compare. */
function stateHash(view: NetworkView): string {
  return hashCanonical({ pieces: view.pieces, nodes: view.nodes, sections: view.sections });
}

function play(s: Sim, plan: readonly PlanStep[], each?: (result: Result) => void): string[] {
  const known: string[] = [];
  for (const step of plan) {
    const result = s.execute(toCommand(step, known));
    learnKeys(result, known);
    each?.(result);
  }
  return known;
}

describe("construction properties", () => {
  it("preview then execute equals execute alone", () => {
    const codes = new Set<string>();
    forAll(
      { seed: "preview-then-execute", runs: 30 },
      (prng) => randomPlan(prng, SIZE, 40),
      (plan) => {
        const a = simOn(TERRAIN);
        const b = simOn(TERRAIN);
        const knownA: string[] = [];
        const knownB: string[] = [];
        for (const step of plan) {
          const cmd = toCommand(step, knownA);
          const previewed = a.preview(cmd);
          const executed = a.execute(cmd);
          const alone = b.execute(toCommand(step, knownB));
          expect(executed).toEqual(alone);
          expect(previewed).toEqual(executed);
          learnKeys(executed, knownA);
          learnKeys(alone, knownB);
          if (!executed.ok) codes.add(executed.reason.code);
        }
        expect(stateHash(a.network())).toBe(stateHash(b.network()));
      },
    );
    // The plans must actually exercise rejections, not only happy paths.
    for (const code of [
      "out-of-bounds",
      "unknown-target",
      "radius-too-tight",
      "turn-too-sharp",
      "no-fit",
      "kinked-join",
      "tracks-too-close",
      "undo-empty",
      "redo-empty",
      "needs-bridge",
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it("preview never mutates", () => {
    forAll(
      { seed: "preview-never-mutates", runs: 20 },
      (prng) => ({ plan: randomPlan(prng, SIZE, 30), probes: randomPlan(prng, SIZE, 30) }),
      ({ plan, probes }) => {
        const a = simOn(TERRAIN);
        const b = simOn(TERRAIN);
        const known: string[] = [];
        plan.forEach((step, i) => {
          const view = a.network();
          const hash = stateHash(view);
          const probe = probes[i];
          if (probe) {
            a.preview(toCommand(probe, known));
            a.preview({ type: "undo" });
            a.preview({ type: "redo" });
          }
          expect(a.network()).toBe(view);
          expect(stateHash(a.network())).toBe(hash);
          const cmd = toCommand(step, known);
          const result = a.execute(cmd);
          expect(result).toEqual(b.execute(cmd));
          learnKeys(result, known);
        });
        // Histories match too: both undo to the same states.
        for (;;) {
          const ra = a.execute({ type: "undo" });
          expect(ra).toEqual(b.execute({ type: "undo" }));
          if (!ra.ok) break;
        }
      },
    );
  });

  it("round-trips random command sequences through undo and redo to identical state hashes", () => {
    forAll(
      { seed: "undo-redo-roundtrip", runs: 30 },
      (prng) => randomPlan(prng, SIZE, 40),
      (plan) => {
        const s = simOn(TERRAIN);
        play(s, plan);
        const end = stateHash(s.network());
        const trail = [end];
        for (;;) {
          const r = s.execute({ type: "undo" });
          if (!r.ok) {
            expect(r.reason.code).toBe("undo-empty");
            break;
          }
          trail.push(stateHash(s.network()));
        }
        // Fewer than 100 edits, and every change goes through history: back to empty.
        expect(s.network().pieces).toHaveLength(0);
        for (let i = trail.length - 2; i >= 0; i--) {
          expect(s.execute({ type: "redo" }).ok).toBe(true);
          expect(stateHash(s.network())).toBe(trail[i]);
        }
        expect(stateHash(s.network())).toBe(end);
        // A plan that ended after undos leaves redo entries of its own; they still apply.
        for (let r = s.execute({ type: "redo" }); r.ok; r = s.execute({ type: "redo" })) expect(r.diff.added.length + r.diff.removed.length).toBeGreaterThan(0);
      },
    );
  });

  it("derives the same network whatever order the pieces were built in", () => {
    forAll(
      { seed: "derive-order-commands", runs: 8 },
      (prng) => {
        const s = simOn(TERRAIN);
        play(s, randomPlan(prng, SIZE, 40));
        const records = s.network().pieces.map((p) => ({ key: p.key, structure: p.structure }));
        return { records, orders: [shuffled(prng, records), shuffled(prng, records), [...records].reverse()] };
      },
      ({ records, orders }) => {
        const reference = simOn(TERRAIN);
        for (const r of records) {
          const spec = parseKey(r.key);
          if (!spec) throw new Error(`bad key ${r.key}`);
          expect(reference.execute({ type: "build-track", pieces: [spec], structure: r.structure }).ok).toBe(true);
        }
        for (const order of orders) {
          const s = simOn(TERRAIN);
          for (const r of order) {
            const spec = parseKey(r.key);
            if (!spec) throw new Error(`bad key ${r.key}`);
            expect(s.execute({ type: "build-track", pieces: [spec], structure: r.structure }).ok).toBe(true);
          }
          expect(s.network()).toEqual(reference.network());
          expect(hashCanonical(s.network())).toBe(hashCanonical(reference.network()));
        }
      },
    );
  });
});
