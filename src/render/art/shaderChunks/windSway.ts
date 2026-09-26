import type { IUniform } from "three";
import { type ShaderChunk, inject } from "./chunk";

/**
 * Wind sway for foliage (art direction "Materials" and "Trees and scenery"): a
 * vertex offset in the model's horizontal plane that grows with the square of
 * height, so trunks stay planted and crowns drift. Each tree's phase comes from
 * its world position, so a forest ripples instead of swaying in lockstep.
 *
 * It is ambient animation: the app advances `uTime` only while the scheduler's
 * `ambient` reason runs (30 fps), and sets the amplitude to 0 under reduced
 * motion, when the ambient reason is off too. Shadows use three's depth
 * material and do not sway; at 4–8 cm of drift that difference does not show.
 * `swayOffset` mirrors the GLSL for tests.
 */

/** Horizontal drift at 10 m above the model origin, in metres. */
export const SWAY_AMPLITUDE_M = 0.09;
/** Heights are normalised by this before squaring. */
const SWAY_REFERENCE_HEIGHT_M = 10;
const SWAY_FREQUENCY_X = 1.3;
const SWAY_FREQUENCY_Z = 1.7;
const PHASE_X = 0.21;
const PHASE_Z = 0.17;

export interface WindSwayUniforms {
  /** Seconds of ambient time. */
  readonly uTime: IUniform<number>;
  readonly uSwayAmplitude: IUniform<number>;
}

export function createWindSwayUniforms(): WindSwayUniforms {
  return { uTime: { value: 0 }, uSwayAmplitude: { value: SWAY_AMPLITUDE_M } };
}

const VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform float uSwayAmplitude;
`;

const VERTEX_MAIN = /* glsl */ `
{
  #ifdef USE_INSTANCING
  vec3 swayBase = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  #else
  vec3 swayBase = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  #endif
  float swayHeight = max( transformed.y, 0.0 ) / ${SWAY_REFERENCE_HEIGHT_M.toFixed(1)};
  float swayPhase = swayBase.x * ${PHASE_X} + swayBase.z * ${PHASE_Z};
  float swayReach = uSwayAmplitude * swayHeight * swayHeight;
  transformed.x += swayReach * sin( uTime * ${SWAY_FREQUENCY_X} + swayPhase );
  transformed.z += swayReach * sin( uTime * ${SWAY_FREQUENCY_Z} + swayPhase * 1.3 );
}
`;

export function createWindSwayChunk(uniforms: WindSwayUniforms): ShaderChunk {
  return {
    key: "wind-sway-v1",
    patch(shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = inject(shader.vertexShader, "#include <common>", VERTEX_PARS, "after");
      shader.vertexShader = inject(shader.vertexShader, "#include <morphtarget_vertex>", VERTEX_MAIN, "before");
    },
  };
}

/**
 * The model-space offset the shader adds to a vertex `heightM` above the model
 * origin, for a tree whose world origin is (baseX, baseZ). Mirrors the GLSL.
 */
export function swayOffset(
  heightM: number,
  timeS: number,
  baseX: number,
  baseZ: number,
  amplitudeM = SWAY_AMPLITUDE_M,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const h = Math.max(heightM, 0) / SWAY_REFERENCE_HEIGHT_M;
  const phase = baseX * PHASE_X + baseZ * PHASE_Z;
  const reach = amplitudeM * h * h;
  out.x = reach * Math.sin(timeS * SWAY_FREQUENCY_X + phase);
  out.z = reach * Math.sin(timeS * SWAY_FREQUENCY_Z + phase * 1.3);
  return out;
}
