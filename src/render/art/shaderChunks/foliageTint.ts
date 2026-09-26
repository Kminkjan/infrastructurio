import { type ShaderChunk, replaceInclude } from "./chunk";

/**
 * Foliage tint (art direction "Materials"): per-instance variation between the
 * paired forest tokens without tinting trunks. Tree geometry carries a vertex
 * alpha mask, 1 on the crown and 0 on the trunk; this chunk replaces three's
 * colour include so the instance colour (the crown's blended palette pair plus
 * HSL jitter) multiplies only where the mask is set. Trunks keep their baked
 * palette colour. `foliageColor` mirrors the GLSL for tests.
 */

const COLOR_VERTEX = /* glsl */ `
#if defined( USE_COLOR_ALPHA )
  vColor = color;
#elif defined( USE_COLOR )
  vColor = vec4( color, 1.0 );
#elif defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, vColor.a );
#endif
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
  // The mask has done its job; keep it out of the fragment's alpha.
  vColor.a = 1.0;
#endif
`;

export function createFoliageTintChunk(): ShaderChunk {
  return {
    key: "foliage-tint-v1",
    patch(shader) {
      shader.vertexShader = replaceInclude(shader.vertexShader, "#include <color_vertex>", COLOR_VERTEX);
    },
  };
}

/** The colour a foliage vertex ends up with: vertex × mix(1, instance, mask). */
export function foliageColor(
  vertex: readonly [number, number, number],
  mask: number,
  instance: readonly [number, number, number],
): [number, number, number] {
  return [
    vertex[0] * (1 + (instance[0] - 1) * mask),
    vertex[1] * (1 + (instance[1] - 1) * mask),
    vertex[2] * (1 + (instance[2] - 1) * mask),
  ];
}
