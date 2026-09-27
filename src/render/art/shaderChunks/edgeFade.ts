import { Color, type IUniform, Vector4 } from "three";
import { OUTPUT_ANCHOR, type ShaderChunk, ensureArtWorld, inject } from "./chunk";

/**
 * Edge fade (art direction "Materials"): the map's outer border dissolves into
 * the haze, so the diorama ends softly instead of at a cut. The fade mixes the
 * lit colour toward the haze by distance to the nearest map edge (world XZ).
 *
 * The background clear colour is not tone mapped but lit fragments are, so the
 * target is the haze run backwards through NeutralToneMapping (`hazeForToneMapping`):
 * at the very edge a fragment then comes out as exactly the background.
 * `edgeFadeAt` mirrors the GLSL for tests.
 */

/** Width of the fade band inside the map edge, in metres. */
export const EDGE_FADE_WIDTH_M = 70;

export interface EdgeFadeUniforms {
  /** World (minX, minZ, maxX, maxZ) of the map. */
  readonly uEdgeBounds: IUniform<Vector4>;
  readonly uEdgeWidth: IUniform<number>;
  /** Linear, pre-tone-mapping haze (see `hazeForToneMapping`). */
  readonly uEdgeHaze: IUniform<Color>;
}

export function createEdgeFadeUniforms(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): EdgeFadeUniforms {
  return {
    uEdgeBounds: { value: new Vector4(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ) },
    uEdgeWidth: { value: EDGE_FADE_WIDTH_M },
    uEdgeHaze: { value: new Color() },
  };
}

const FRAGMENT_PARS = /* glsl */ `
uniform vec4 uEdgeBounds;
uniform float uEdgeWidth;
uniform vec3 uEdgeHaze;
`;

const FRAGMENT_MAIN = /* glsl */ `
{
  vec2 edgeXZ = vArtWorld.xz;
  float edgeDistance = min( min( edgeXZ.x - uEdgeBounds.x, uEdgeBounds.z - edgeXZ.x ), min( edgeXZ.y - uEdgeBounds.y, uEdgeBounds.w - edgeXZ.y ) );
  outgoingLight = mix( outgoingLight, uEdgeHaze, 1.0 - smoothstep( 0.0, uEdgeWidth, edgeDistance ) );
}
`;

export function createEdgeFadeChunk(uniforms: EdgeFadeUniforms): ShaderChunk {
  return {
    key: "edge-fade-v1",
    patch(shader) {
      Object.assign(shader.uniforms, uniforms);
      ensureArtWorld(shader);
      shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_PARS, "after");
      shader.fragmentShader = inject(shader.fragmentShader, OUTPUT_ANCHOR, FRAGMENT_MAIN, "before");
    },
  };
}

/** How much of the haze a fragment at world (x, z) takes: 1 at the edge, 0 from `width` inward. */
export function edgeFadeAt(
  x: number,
  z: number,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  width = EDGE_FADE_WIDTH_M,
): number {
  const d = Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z);
  const t = Math.min(1, Math.max(0, d / width));
  return 1 - t * t * (3 - 2 * t);
}

/** three's NeutralToneMapping below its compression start (the part the haze uses). */
export function neutralToneMap(linear: readonly [number, number, number], exposure = 1): [number, number, number] {
  const c = [linear[0] * exposure, linear[1] * exposure, linear[2] * exposure] as const;
  const x = Math.min(c[0], c[1], c[2]);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  const out: [number, number, number] = [c[0] - offset, c[1] - offset, c[2] - offset];
  const start = 0.8 - 0.04;
  const peak = Math.max(...out);
  if (peak < start) return out;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  const scaled = out.map((v) => (v * newPeak) / peak) as [number, number, number];
  const g = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return scaled.map((v) => v * (1 - g) + newPeak * g) as [number, number, number];
}

/**
 * The linear colour that NeutralToneMapping at `exposure` turns into `target`.
 * Exact while the result stays under the compression start and its smallest
 * channel is at least 0.08 (the constant-offset branch), which holds for the
 * haze; outside that range it falls back to undoing the exposure alone.
 */
export function hazeForToneMapping(target: Color, exposure: number, out: Color = new Color()): Color {
  const e = Math.max(exposure, 1e-3);
  const minChannel = Math.min(target.r, target.g, target.b);
  const peak = Math.max(target.r, target.g, target.b);
  if (minChannel + 0.04 >= 0.08 && peak < 0.8 - 0.04) return out.setRGB((target.r + 0.04) / e, (target.g + 0.04) / e, (target.b + 0.04) / e);
  return out.setRGB(target.r / e, target.g / e, target.b / e);
}
