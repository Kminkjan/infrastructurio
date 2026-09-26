import { describe, expect, it } from "vitest";
import { RingBuffer, p95 } from "./perfStats";

describe("perf ring buffer", () => {
  it("keeps the most recent samples, oldest first, once it wraps", () => {
    const ring = new RingBuffer(4);
    for (const v of [1, 2, 3]) ring.push(v);
    const out = new Float64Array(4);
    expect(ring.copyTo(out)).toBe(3);
    expect([...out.subarray(0, 3)]).toEqual([1, 2, 3]);
    for (const v of [4, 5, 6]) ring.push(v);
    expect(ring.length).toBe(4);
    expect(ring.copyTo(out)).toBe(4);
    expect([...out]).toEqual([3, 4, 5, 6]);
    ring.clear();
    expect(ring.copyTo(out)).toBe(0);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(2.5)).toThrow(RangeError);
  });
});

describe("p95", () => {
  it("is the sorted sample at floor(0.95·n)", () => {
    const hundred = Float64Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(p95(hundred)).toBe(96);
    expect(p95(Float64Array.from([5, 1, 3, 2, 4]))).toBe(5);
    expect(p95(Float64Array.from([7]))).toBe(7);
  });

  it("uses only the first n values and is NaN when empty", () => {
    const values = Float64Array.from([3, 1, 2, 1000, 1000]);
    expect(p95(values, 3)).toBe(3);
    expect(p95(new Float64Array(4), 0)).toBeNaN();
  });
});
