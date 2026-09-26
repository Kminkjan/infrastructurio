/**
 * Allocation-free frame statistics for `PerfMonitor`. These are development
 * readings only: the acceptance gates count D13 bench runs, never these.
 */

/** Fixed-capacity ring of recent samples; the oldest drop off once full. */
export class RingBuffer {
  private readonly data: Float64Array;
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`ring capacity must be a positive integer, got ${capacity}`);
    this.data = new Float64Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(value: number): void {
    this.data[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Copies the samples, oldest first, into `out` and returns how many there are. */
  copyTo(out: Float64Array): number {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) out[i] = this.data[(start + i) % this.capacity] ?? 0;
    return this.count;
  }
}

/**
 * 95th percentile as the sorted sample s[floor(0.95·n)] (nearest rank, no
 * interpolation), NaN when empty. Sorts `values[0..n)` in place.
 */
export function p95(values: Float64Array, n: number = values.length): number {
  if (n <= 0) return Number.NaN;
  const sorted = values.subarray(0, n).sort();
  return sorted[Math.floor(0.95 * n)] ?? Number.NaN;
}
