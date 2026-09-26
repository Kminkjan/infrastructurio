/**
 * Binary min-heap for pathfinding and event queues.
 *
 * A heap is not stable: elements that compare equal come out in an order
 * that depends on the push history. Determinism therefore rests on the
 * comparator being a **total order** (it returns 0 only for elements that
 * are interchangeable), so break every tie explicitly, e.g. paths by
 * (cost, dirSectionId) and reservations by (firstRequestTick, trainId).
 * With a total order the pop sequence is the sorted order, whatever order the
 * elements were pushed in.
 */
export class MinHeap<T> {
  private readonly items: T[] = [];
  private readonly compare: (a: T, b: T) => number;

  /** `compare(a, b) < 0` means `a` pops first; it must be a total order. */
  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  get size(): number {
    return this.items.length;
  }

  push(v: T): void {
    const items = this.items;
    items.push(v);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = items[parent] as T;
      if (this.compare(v, p) >= 0) break;
      items[i] = p;
      i = parent;
    }
    items[i] = v;
  }

  /** Smallest element without removing it, or undefined when empty. */
  peek(): T | undefined {
    return this.items[0];
  }

  /** Removes and returns the smallest element, or undefined when empty. */
  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0] as T;
    const last = items.pop() as T;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= n) break;
        const right = left + 1;
        let child = left;
        if (right < n && this.compare(items[right] as T, items[left] as T) < 0) child = right;
        const c = items[child] as T;
        if (this.compare(c, last) >= 0) break;
        items[i] = c;
        i = child;
      }
      items[i] = last;
    }
    return top;
  }
}
