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

interface FakeTag {
  readonly style: Record<string, string>;
  textContent: string;
}

/** A stand-in for the tag elements: counts writes to `style.transform`, and keeps the elements it made. */
function fakeDocument(writes: string[], made: FakeTag[] = []) {
  return {
    createElement: () => {
      const style: Record<string, string> = {};
      Object.defineProperty(style, "transform", {
        set: (v: string) => {
          writes.push(v);
        },
        get: () => writes.at(-1) ?? "",
      });
      const el = { style, className: "", textContent: "", setAttribute: () => undefined, remove: () => undefined };
      made.push(el);
      return el;
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

describe("ghost elevation marks", () => {
  it("measures its drop lines and end-height tags again when the drawn ground changes under an unchanged plan", () => {
    // PR #83 re-review: a commit sets the chained ghost before the time-sliced earthworks land, and a ghost whose plan
    // did not change was never measured again, so a continuation off an embankment kept a "+6 m" tag at its start
    // (the ground from before the build) and a drop line through the bank. The app now calls `refreshGround` once
    // the earthworks have drawn the revision.
    const tags: FakeTag[] = [];
    vi.stubGlobal("document", fakeDocument([], tags));
    let embankment = false;
    // Flat ground at 0 m; once built, a 6 m embankment under the first two pieces (x < 10 m).
    const ghost = new GhostView({ appendChild: () => undefined } as unknown as HTMLElement, (x) => (embankment && x < 10 ? 6 : 0));
    const drops = ghost.group.children[1] as unknown as { visible: boolean; geometry: { getAttribute(name: string): { count: number } | undefined } };
    ghost.set({ pieces: ELEVATED.map((spec) => ({ spec, status: "new" })), valid: true });
    expect(tags.map((t) => t.textContent)).toEqual(["+6 m", "+6 m"]);
    const before = drops.geometry.getAttribute("position")?.count ?? 0;
    expect(before).toBeGreaterThan(0);

    embankment = true;
    expect(ghost.refreshGround()).toBe(true);
    expect(tags.map((t) => t.textContent)).toEqual(["0 m", "+6 m"]);
    expect(tags.map((t) => t.style.display)).toEqual(["block", "block"]);
    // The drop line at the start (x = 0) now stands on the bank's crest, so it is gone.
    expect(drops.geometry.getAttribute("position")?.count ?? 0).toBeLessThan(before);

    ghost.set(null);
    expect(ghost.refreshGround()).toBe(false);
    expect(drops.visible).toBe(false);
    ghost.dispose();
  });
});

describe("ghost held end", () => {
  it("draws the held-end drop line only while the plan's end is held, in two passes, and measures it again with the ground", () => {
    vi.stubGlobal("document", fakeDocument([]));
    let ground = 0;
    const ghost = new GhostView({ appendChild: () => undefined } as unknown as HTMLElement, () => ground);
    const lines = ["ghost held end (through)", "ghost held end"].map((name) => ghost.group.getObjectByName(name) as unknown as { visible: boolean; renderOrder: number; material: { depthTest: boolean }; geometry: { getAttribute(name: string): { count: number; getY(i: number): number } | undefined } });
    const buried = [0, 1, 2, 3].map((i): PieceSpec => ({ kind: "straight", from: { q: i, r: 0, zMm: -11_200 }, heading: 0, z1Mm: -11_200 }));
    const pieces = buried.map((spec) => ({ spec, status: "new" as const, structure: "tunnel" as const }));

    ghost.set({ pieces, valid: true, endHeld: true });
    expect(ghost.heldVisible).toBe(true);
    expect(lines.map((l) => l.visible)).toEqual([true, true]);
    // The see-through pass shows the part inside the hill; the depth-tested pass draws over it.
    expect(lines.map((l) => l.material.depthTest)).toEqual([false, true]);
    expect(lines[0]?.renderOrder).toBeLessThan(lines[1]?.renderOrder ?? 0);
    expect(lines[1]?.geometry.getAttribute("position")?.count).toBe(4);
    expect(lines[1]?.geometry.getAttribute("position")?.getY(1)).toBe(0);

    // The drawn ground rose (the earthworks landed): the line follows it.
    ground = 2;
    expect(ghost.refreshGround()).toBe(true);
    expect(lines[1]?.geometry.getAttribute("position")?.getY(1)).toBe(2);

    // Not held (or no flag, as other ghosts send): no line.
    ghost.set({ pieces, valid: true, endHeld: false });
    expect(ghost.heldVisible).toBe(false);
    ghost.set({ pieces, valid: true });
    expect(ghost.heldVisible).toBe(false);
    ghost.set(null);
    expect(lines.map((l) => l.visible)).toEqual([false, false]);
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
