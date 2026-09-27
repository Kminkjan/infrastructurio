import { describe, expect, it } from "vitest";
import type { PieceSpec } from "../geometry/piece";
import { DEFAULT_TERRAIN_SIZE } from "../terrain";
import { MAX_PIECES, createSim } from "./api";

/**
 * Soft performance smoke, not a gate: the real bench with committed budgets
 * is D12 (acceptance gates B3/B4). A failure here means "look", on any
 * machine, and says nothing about the gate hardware.
 */

function row(r: number, from: number, count: number): PieceSpec[] {
  const q0 = 0 - Math.floor(r / 2) + from;
  return Array.from({ length: count }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r, zMm: 0 }, heading: 0, z1Mm: 0 }));
}

describe("preview performance smoke", () => {
  // 5,000 existing + 100 new would stop at limit-reached (rule 1) and time
  // almost nothing, so 4,900 existing + 100 new fills the map to the cap and
  // runs every rule, clearance included.
  it("previews a 100-piece build that fills the map to 5,000 pieces in under 20 ms (median of 7)", () => {
    const sim = createSim({ terrain: { seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE } });
    const existing = MAX_PIECES - 100;
    let built = 0;
    for (let r = 0; built < existing; r++) {
      const count = Math.min(DEFAULT_TERRAIN_SIZE.columns - 1, existing - built);
      const result = sim.execute({ type: "build-track", pieces: row(r, 0, count), structure: "ground" });
      expect(result.ok).toBe(true);
      built += count;
    }
    expect(sim.network().pieces).toHaveLength(existing);
    // Row 12 holds 112 pieces; the new 100 continue it 4.33 m beside the full
    // row 11 and join it at a through node, so topology and the clearance
    // broadphase both see real neighbours.
    const cmd = { type: "build-track", pieces: row(12, 112, 100), structure: "ground" } as const;
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
