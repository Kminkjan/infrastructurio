/**
 * Small pure maths shared across render (PR #83 review, 2026-09-27: one copy
 * instead of eight). Shader chunks use GLSL's own `smoothstep`; their float64
 * mirrors, the bakes and the mesh builders use this one.
 */

/** Hermite smoothstep, as GLSL's: 0 at or below `edge0`, 1 at or above `edge1`, 3t² − 2t³ between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
