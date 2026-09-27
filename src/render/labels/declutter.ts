/**
 * Greedy label declutter (art direction "Typography and labels"): labels are
 * placed in priority order and a label is shown only if its screen box clears
 * every box already shown (plus padding), it sits on screen, and the zoom is
 * at or above its own minimum. Pure and allocation-free, so the label layer
 * can re-run it whenever the camera changes.
 */

/** A label's screen box in CSS px: centred on x, its bottom edge on y. */
export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  readonly priority: number;
  /** Hidden below this zoom (ppm). */
  readonly minPpm: number;
}

export const LABEL_PADDING_PX = 6;

/**
 * Writes 1 into `visible[i]` for each label shown, 0 otherwise. `order` is
 * scratch of the same length (label indices, sorted here by priority, ties by
 * index), passed in so nothing is allocated per call.
 */
export function declutter(
  boxes: readonly LabelBox[],
  ppm: number,
  viewport: { readonly width: number; readonly height: number },
  visible: Uint8Array,
  order: Int32Array,
  padding = LABEL_PADDING_PX,
): number {
  const n = boxes.length;
  for (let i = 0; i < n; i++) order[i] = i;
  // Insertion sort: a handful of labels, and it keeps ties in index order.
  for (let i = 1; i < n; i++) {
    const current = order[i] ?? 0;
    const p = boxes[current]?.priority ?? 0;
    let j = i - 1;
    while (j >= 0 && (boxes[order[j] ?? 0]?.priority ?? 0) < p) {
      order[j + 1] = order[j] ?? 0;
      j--;
    }
    order[j + 1] = current;
  }
  let shown = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k] ?? 0;
    const b = boxes[i];
    visible[i] = 0;
    if (!b || ppm < b.minPpm || b.width <= 0) continue;
    const left = b.x - b.width / 2;
    const top = b.y - b.height;
    if (left + b.width < 0 || left > viewport.width || b.y < 0 || top > viewport.height) continue;
    let clear = true;
    for (let m = 0; m < k && clear; m++) {
      const o = order[m] ?? 0;
      if (visible[o] !== 1) continue;
      const other = boxes[o];
      if (!other) continue;
      const oLeft = other.x - other.width / 2;
      const oTop = other.y - other.height;
      clear =
        left + b.width + padding <= oLeft ||
        oLeft + other.width + padding <= left ||
        top + b.height + padding <= oTop ||
        oTop + other.height + padding <= top;
    }
    if (clear) {
      visible[i] = 1;
      shown += 1;
    }
  }
  return shown;
}
