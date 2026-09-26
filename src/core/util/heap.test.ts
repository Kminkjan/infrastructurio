import { describe, expect, it } from "vitest";
import { MinHeap } from "./heap";
import { createPrng } from "./prng";

interface Entry {
  readonly cost: number;
  readonly id: number;
}

/** Total order: cost, then id, as a pathfinder would break ties. */
const byCostThenId = (a: Entry, b: Entry): number => a.cost - b.cost || a.id - b.id;

function drain<T>(heap: MinHeap<T>): T[] {
  const out: T[] = [];
  for (let v = heap.pop(); v !== undefined; v = heap.pop()) out.push(v);
  return out;
}

describe("MinHeap", () => {
  it("heapsorts seeded data exactly like Array.prototype.sort", () => {
    const prng = createPrng("heap-sort");
    for (const n of [0, 1, 2, 3, 10, 257, 5000]) {
      const values = Array.from({ length: n }, () => prng.nextInt(1000) - 500);
      const heap = new MinHeap<number>((a, b) => a - b);
      for (const v of values) heap.push(v);
      expect(heap.size).toBe(n);
      expect(drain(heap)).toEqual([...values].sort((a, b) => a - b));
      expect(heap.size).toBe(0);
    }
  });

  it("pops ties in the same order whatever the push order, given a total order", () => {
    const prng = createPrng("heap-ties");
    // Many equal costs, so only the id tie-break decides the order.
    const entries: Entry[] = Array.from({ length: 400 }, (_, id) => ({ cost: prng.nextInt(5), id }));
    const expected = [...entries].sort(byCostThenId);
    for (let round = 0; round < 5; round++) {
      const shuffled = [...entries];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = prng.nextInt(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j] as Entry, shuffled[i] as Entry];
      }
      const heap = new MinHeap(byCostThenId);
      for (const e of shuffled) heap.push(e);
      expect(drain(heap)).toEqual(expected);
    }
  });

  it("peeks without removing and returns undefined when empty", () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
    heap.push(5);
    heap.push(2);
    heap.push(8);
    expect(heap.peek()).toBe(2);
    expect(heap.size).toBe(3);
    expect(heap.pop()).toBe(2);
    expect(heap.peek()).toBe(5);
  });

  it("stays ordered when pushes and pops interleave", () => {
    const prng = createPrng("heap-mixed");
    const heap = new MinHeap<number>((a, b) => a - b);
    const mirror: number[] = [];
    for (let i = 0; i < 3000; i++) {
      if (mirror.length > 0 && prng.nextInt(3) === 0) {
        mirror.sort((a, b) => a - b);
        expect(heap.pop()).toBe(mirror.shift());
      } else {
        const v = prng.nextInt(100);
        heap.push(v);
        mirror.push(v);
      }
      expect(heap.size).toBe(mirror.length);
    }
  });
});
