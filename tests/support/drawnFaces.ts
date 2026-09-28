import type { DrawnHeightfield } from "../../src/render/terrain/earthworks";

/**
 * The steepest drawn face of a conformed heightfield: over every refined
 * triangle's 16 sub-triangles, the largest plan gradient (rise per metre) and
 * where it lies. Natural triangles are the terrain's own and are not checked.
 * Shared by the earthworks tests that look for ledges (PR #83 re-review).
 */
export function steepestDrawnFace(field: DrawnHeightfield): { slope: number; x: number; y: number } {
  const spacing = field.lat.spacingM;
  const a = spacing / 4;
  const h = a * (Math.sqrt(3) / 2);
  const idx = (i: number, j: number) => j * 5 - (j * (j - 1)) / 2 + i;
  let best = { slope: 0, x: 0, y: 0 };
  for (const [id, heights] of field.triangles) {
    const up = id & 1;
    const rest = (id - up) / 2;
    const Q = (rest % 16384) - 8192;
    const R = Math.floor(rest / 16384) - 2;
    // Corner A of the triangle (the frame's origin): (Q, R) for a down triangle, (Q + 1, R + 1) for an up one.
    const ax0 = up === 0 ? spacing * (Q + R / 2) : spacing * (Q + 1 + (R + 1) / 2);
    const ay0 = up === 0 ? spacing * R * (Math.sqrt(3) / 2) : spacing * (R + 1) * (Math.sqrt(3) / 2);
    for (let b = 0; b < 4; b++) {
      for (let k = 0; k + b < 4; k++) {
        const tri = (i0: number, j0: number, i1: number, j1: number, i2: number, j2: number) => {
          const z0 = heights[idx(i0, j0)] ?? 0;
          const z1 = heights[idx(i1, j1)] ?? 0;
          const z2 = heights[idx(i2, j2)] ?? 0;
          // Plan positions in the triangle's own frame: sub-vertex (i, j) at i·e1 + j·e2, |e| = a, 60° apart.
          const ax = a * (i1 - i0 + (j1 - j0) / 2);
          const ay = h * (j1 - j0);
          const bx = a * (i2 - i0 + (j2 - j0) / 2);
          const by = h * (j2 - j0);
          const det = ax * by - ay * bx;
          const slope = Math.hypot(((z1 - z0) * by - (z2 - z0) * ay) / det, (ax * (z2 - z0) - bx * (z1 - z0)) / det);
          if (slope > best.slope) best = { slope, x: ax0, y: ay0 };
        };
        tri(k, b, k + 1, b, k, b + 1);
        if (k + b + 1 < 4) tri(k + 1, b, k + 1, b + 1, k, b + 1);
      }
    }
  }
  return best;
}
