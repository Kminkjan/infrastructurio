import { afterEach, describe, expect, it, vi } from "vitest";
import { type PieceSpec, createSim } from "../../core/sim/api";
import { ISO_PITCH_RAD, type IsoView, yawForStep } from "../camera/isoMath";
import { GhostView, HighlightView } from "./GhostView";

/**
 * The overlay classes stay thin, but two behaviours are testable in Node:
 * the end-height tags write the DOM only when their projected position
 * changes (render guide "Frame loop": no per-frame strings), and the
 * rejection highlight skips empty and unchanged key sets (review of PR #82).
 */

/** A stand-in for the tag elements: counts writes to `style.transform`. */
function fakeDocument(writes: string[]) {
  return {
    createElement: () => {
      const style: Record<string, string> = {};
      Object.defineProperty(style, "transform", {
        set: (v: string) => {
          writes.push(v);
        },
        get: () => writes.at(-1) ?? "",
      });
      return { style, className: "", textContent: "", setAttribute: () => undefined, remove: () => undefined };
    },
  };
}

const VIEW: IsoView = { target: { x: 0, z: 0 }, ppm: 6, yaw: yawForStep(0), pitch: ISO_PITCH_RAD, cssWidth: 1280, cssHeight: 800 };

/** Four straights 6 m above flat ground at 0 m: an elevated ghost, so both end tags show. */
const ELEVATED: readonly PieceSpec[] = [0, 1, 2, 3].map((i) => ({ kind: "straight", from: { q: i, r: 0, zMm: 6000 }, heading: 0, z1Mm: 6000 }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ghost end-height tags", () => {
  it("writes the tag transforms only when their projected positions change", () => {
    const writes: string[] = [];
    vi.stubGlobal("document", fakeDocument(writes));
    const ghost = new GhostView({ appendChild: () => undefined } as unknown as HTMLElement, () => 0);
    ghost.set({ pieces: ELEVATED.map((spec) => ({ spec, status: "new" })), valid: true });
    ghost.updateTags(VIEW);
    expect(writes).toHaveLength(2);
    // The same projection again, from the same or an equal view: no DOM writes, no strings.
    ghost.updateTags(VIEW);
    ghost.updateTags({ ...VIEW });
    expect(writes).toHaveLength(2);
    // The camera moved: both tags follow.
    ghost.updateTags({ ...VIEW, target: { x: 10, z: 0 } });
    expect(writes).toHaveLength(4);
    // A new ghost at the same place is placed again, even though the camera did not move.
    ghost.set({ pieces: ELEVATED.map((spec) => ({ spec, status: "new" })), valid: true });
    ghost.updateTags({ ...VIEW, target: { x: 10, z: 0 } });
    expect(writes).toHaveLength(6);
    ghost.dispose();
  });
});

describe("rejection highlight", () => {
  it("skips empty and unchanged key sets, and re-resolves keys only for a new network revision", () => {
    const sim = createSim({ terrain: { seed: "d3-highlight", columns: 60, rows: 52 } });
    const run = (q0: number, n: number): PieceSpec[] =>
      Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r: 10, zMm: 0 }, heading: 0, z1Mm: 0 }));
    expect(sim.execute({ type: "build-track", pieces: run(10, 4), structure: "auto" }).ok).toBe(true);
    const network = sim.network();
    const keys = network.pieces.slice(0, 2).map((p) => p.key);
    const highlight = new HighlightView();
    const set = vi.spyOn(highlight.ribbons, "set");

    highlight.set([], network);
    expect(set).not.toHaveBeenCalled();
    highlight.set(keys, network);
    expect(set).toHaveBeenCalledTimes(1);
    expect(highlight.group.visible).toBe(true);
    // Equal keys (a fresh array) against the same revision: nothing to redo.
    highlight.set([...keys], network);
    expect(set).toHaveBeenCalledTimes(1);
    highlight.set([], network);
    expect(set).toHaveBeenCalledTimes(2);
    expect(highlight.group.visible).toBe(false);
    highlight.set([], network);
    expect(set).toHaveBeenCalledTimes(2);

    // A new revision: the same keys are looked up again.
    highlight.set(keys, network);
    expect(sim.execute({ type: "build-track", pieces: run(20, 2), structure: "auto" }).ok).toBe(true);
    highlight.set(keys, sim.network());
    expect(set).toHaveBeenCalledTimes(4);
    expect(highlight.group.visible).toBe(true);
    highlight.dispose();
  });
});
