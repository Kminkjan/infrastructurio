import type { IUniform } from "three";
import { ALBEDO_ANCHOR, type ShaderChunk, ensureArtWorld, inject } from "./chunk";

/**
 * Grain (art direction "Materials"): world-space value noise that varies the
 * albedo's luminance by at most ±6%, so flat-coloured surfaces read as painted
 * rather than plastic. It is anchored to world position, so it never swims
 * while the camera pans or zooms. Two octaves (0.7 m and about 0.23 m) keep it
 * from reading as a grid at any zoom. `grainAt` mirrors the GLSL for tests.
 */

export const GRAIN_AMOUNT = 0.06;
/** Cells per metre of the coarse octave (0.7 m cells). */
export const GRAIN_FREQUENCY = 1 / 0.7;
const FINE_RATIO = 3.1;
const FINE_OFFSET = 17;

export interface GrainUniforms {
  readonly uGrainAmount: IUniform<number>;
  readonly uGrainFrequency: IUniform<number>;
}

export function createGrainUniforms(amount = GRAIN_AMOUNT): GrainUniforms {
  return { uGrainAmount: { value: amount }, uGrainFrequency: { value: GRAIN_FREQUENCY } };
}

const FRAGMENT_PARS = /* glsl */ `
uniform float uGrainAmount;
uniform float uGrainFrequency;

// Hash without sine (Dave Hoskins): stable across GPUs, no large-argument sin.
float grainHash( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float grainNoise( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( grainHash( i ), grainHash( i + vec3( 1, 0, 0 ) ), u.x ),
         mix( grainHash( i + vec3( 0, 1, 0 ) ), grainHash( i + vec3( 1, 1, 0 ) ), u.x ), u.y ),
    mix( mix( grainHash( i + vec3( 0, 0, 1 ) ), grainHash( i + vec3( 1, 0, 1 ) ), u.x ),
         mix( grainHash( i + vec3( 0, 1, 1 ) ), grainHash( i + vec3( 1, 1, 1 ) ), u.x ), u.y ),
    u.z );
}

// In [-1, 1].
float artGrain( vec3 world ) {
  vec3 p = world * uGrainFrequency;
  return ( 0.6 * grainNoise( p ) + 0.4 * grainNoise( p * ${FINE_RATIO.toFixed(1)} + ${FINE_OFFSET.toFixed(1)} ) ) * 2.0 - 1.0;
}
`;

const FRAGMENT_MAIN = /* glsl */ `
diffuseColor.rgb *= 1.0 + uGrainAmount * artGrain( vArtWorld );
`;

export function createGrainChunk(uniforms: GrainUniforms): ShaderChunk {
  return {
    key: "grain-v1",
    patch(shader) {
      Object.assign(shader.uniforms, uniforms);
      ensureArtWorld(shader);
      shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_PARS, "after");
      shader.fragmentShader = inject(shader.fragmentShader, ALBEDO_ANCHOR, FRAGMENT_MAIN, "before");
    },
  };
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function grainHash(x: number, y: number, z: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  let pz = fract(z * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d;
  py += d;
  pz += d;
  return fract((px + py) * pz);
}

function grainNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const ux = s(x - ix);
  const uy = s(y - iy);
  const uz = s(z - iz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (dx: number, dy: number, dz: number) => grainHash(ix + dx, iy + dy, iz + dz);
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), ux), lerp(h(0, 1, 0), h(1, 1, 0), ux), uy),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), ux), lerp(h(0, 1, 1), h(1, 1, 1), ux), uy),
    uz,
  );
}

/**
 * The luminance factor offset the shader applies at a world point:
 * albedo × (1 + grainAt(...)), within ±`amount`. Mirrors the GLSL in float64.
 */
export function grainAt(x: number, y: number, z: number, amount = GRAIN_AMOUNT, frequency = GRAIN_FREQUENCY): number {
  const px = x * frequency;
  const py = y * frequency;
  const pz = z * frequency;
  const n =
    0.6 * grainNoise(px, py, pz) + 0.4 * grainNoise(px * FINE_RATIO + FINE_OFFSET, py * FINE_RATIO + FINE_OFFSET, pz * FINE_RATIO + FINE_OFFSET);
  return amount * (n * 2 - 1);
}
