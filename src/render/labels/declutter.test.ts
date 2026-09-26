import { describe, expect, it } from "vitest";
import { type LabelBox, declutter } from "./declutter";

const view = { width: 1000, height: 800 };

function run(boxes: LabelBox[], ppm = 6): number[] {
  const visible = new Uint8Array(boxes.length);
  declutter(boxes, ppm, view, visible, new Int32Array(boxes.length));
  return [...visible];
}

const box = (x: number, y: number, priority: number, minPpm = 0.9, width = 100, height = 20): LabelBox => ({ x, y, width, height, priority, minPpm });

describe("label declutter", () => {
  it("shows labels that do not collide", () => {
    expect(run([box(100, 100, 1), box(400, 100, 1), box(100, 400, 1)])).toEqual([1, 1, 1]);
  });

  it("keeps the higher priority label when two overlap, whatever their order", () => {
    expect(run([box(100, 100, 1), box(130, 105, 3)])).toEqual([0, 1]);
    expect(run([box(130, 105, 3), box(100, 100, 1)])).toEqual([1, 0]);
  });

  it("breaks priority ties by label order", () => {
    expect(run([box(100, 100, 2), box(120, 100, 2)])).toEqual([1, 0]);
  });

  it("keeps padding between labels", () => {
    // 104 px apart centre to centre: 4 px gap between 100 px boxes, under the 6 px padding.
    expect(run([box(100, 100, 2), box(204, 100, 1)])).toEqual([1, 0]);
    expect(run([box(100, 100, 2), box(210, 100, 1)])).toEqual([1, 1]);
  });

  it("hides labels below their zoom minimum (towns below 0.9 ppm)", () => {
    expect(run([box(100, 100, 3, 0.9)], 0.89)).toEqual([0]);
    expect(run([box(100, 100, 3, 0.9)], 0.9)).toEqual([1]);
    expect(run([box(100, 100, 3, 2), box(500, 100, 1, 0.9)], 1.5)).toEqual([0, 1]);
  });

  it("hides labels that are off screen, so they do not block on-screen ones", () => {
    expect(run([box(-200, 100, 5), box(40, 100, 1)])).toEqual([0, 1]);
    expect(run([box(500, 900, 5)])).toEqual([0]);
  });
});
