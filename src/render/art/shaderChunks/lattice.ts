import type { Color, IUniform, Material, Vector2 } from "three";

/**
 * The construction lattice overlay as an isolated `onBeforeCompile` chunk
 * (art direction "Terrain and water", ADR 0013). It draws the lattice's three
 * line families and its node dots straight onto the terrain's lit colour, in
 * screen-space pixel widths, with no extra geometry or draw calls.
 *
 * Geometry: nodes sit at x = 5(q + r/2), y = 4.33·r (sim metres). Each family
 * of lines through them has a unit normal n and satisfies p·n = k·h for
 * integer k, with h = 5·√3/2 = 4.330127 m:
 *   heading   0°: n = (0, 1)          → p·n = h·r
 *   heading  60°: n = (−√3/2,  1/2)   → p·n = −h·q
 *   heading 120°: n = (−√3/2, −1/2)   → p·n = −h·(q + r)
 * The shader reads sim (x, y) as world (X, −Z), the same axes as coords.ts.
 * `latticeFamilyDistancesM` mirrors the GLSL so tests can check the maths.
 */

export const LATTICE_ROW_SPACING_M = 4.330127018922193;
const HALF_SQRT3 = LATTICE_ROW_SPACING_M / 5;

/** Distance (m) from sim point (x, y) to the nearest line of each family: [0°, 60°, 120°]. */
export function latticeFamilyDistancesM(x: number, y: number): [number, number, number] {
  return [familyDistance(y), familyDistance(-HALF_SQRT3 * x + 0.5 * y), familyDistance(-HALF_SQRT3 * x - 0.5 * y)];
}

function familyDistance(s: number): number {
  const f = s / LATTICE_ROW_SPACING_M + 0.5;
  return Math.abs(f - Math.floor(f) - 0.5) * LATTICE_ROW_SPACING_M;
}

export interface LatticeUniforms {
  readonly uBuildMode: IUniform<number>;
  readonly uCursor: IUniform<Vector2>;
  readonly uGlobalOpacity: IUniform<number>;
  readonly uNearOpacity: IUniform<number>;
  readonly uRevealRadius: IUniform<number>;
  readonly uLineColor: IUniform<Color>;
  readonly uLinePx: IUniform<number>;
  readonly uLineWidthPx: IUniform<number>;
  readonly uDotRadiusPx: IUniform<number>;
  readonly uFadeBelowPx: IUniform<number>;
  [name: string]: IUniform;
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vLatticeWorld;
`;

const VERTEX_MAIN = /* glsl */ `
vLatticeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uBuildMode;
uniform vec2 uCursor;
uniform float uGlobalOpacity;
uniform float uNearOpacity;
uniform float uRevealRadius;
uniform vec3 uLineColor;
uniform float uLinePx;
uniform float uLineWidthPx;
uniform float uDotRadiusPx;
uniform float uFadeBelowPx;
varying vec3 vLatticeWorld;

const float LATTICE_A = 5.0;
const float LATTICE_H = ${LATTICE_ROW_SPACING_M.toFixed(12)};
const float LATTICE_HALF_SQRT3 = ${HALF_SQRT3.toFixed(12)};

// Coverage of one line family at family coordinate s (metres). Dividing the
// metric distance by |grad s| in pixels gives an exact screen-space distance,
// so lines stay about uLineWidthPx wide at every zoom and yaw.
float latticeLine(float s) {
  float d = abs(fract(s / LATTICE_H + 0.5) - 0.5) * LATTICE_H;
  float px = d / max(length(vec2(dFdx(s), dFdy(s))), 1e-6);
  return 1.0 - smoothstep(uLineWidthPx * 0.5 - 0.5, uLineWidthPx * 0.5 + 0.5, px);
}
`;

const FRAGMENT_MAIN = /* glsl */ `
if (uBuildMode > 0.0) {
  vec2 simXY = vec2(vLatticeWorld.x, -vLatticeWorld.z);
  float lines = max(
    latticeLine(simXY.y),
    max(latticeLine(-LATTICE_HALF_SQRT3 * simXY.x + 0.5 * simXY.y), latticeLine(-LATTICE_HALF_SQRT3 * simXY.x - 0.5 * simXY.y))
  );
  // Nearest node by cube rounding, then its distance in screen pixels via the
  // inverse screen-to-ground Jacobian, so dots are round on screen.
  float rf = simXY.y / LATTICE_H;
  float qf = simXY.x / LATTICE_A - 0.5 * rf;
  float sf = -qf - rf;
  float q = floor(qf + 0.5);
  float r = floor(rf + 0.5);
  float s = floor(sf + 0.5);
  float dq = abs(q - qf);
  float dr = abs(r - rf);
  float ds = abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  vec2 node = vec2(LATTICE_A * (q + 0.5 * r), LATTICE_H * r);
  mat2 groundPerPixel = mat2(dFdx(simXY), dFdy(simXY));
  float dotPx = length(inverse(groundPerPixel) * (simXY - node));
  float dots = 1.0 - smoothstep(uDotRadiusPx - 0.5, uDotRadiusPx + 0.5, dotPx);

  float reveal = 1.0 - smoothstep(uRevealRadius * 0.8, uRevealRadius, distance(vLatticeWorld.xz, uCursor));
  float opacity = mix(uGlobalOpacity, uNearOpacity, reveal);
  float legible = smoothstep(uFadeBelowPx - 1.0, uFadeBelowPx, uLinePx);
  outgoingLight = mix(outgoingLight, uLineColor, uBuildMode * opacity * legible * max(lines, dots));
}
`;

const CACHE_KEY = "lattice-overlay-v1";

/**
 * Patches a Lambert material to draw the lattice. The uniform objects are
 * shared, so changing `uniforms.x.value` updates every program. Throws if
 * three's shader no longer has the anchor chunks, so an upgrade fails loudly
 * instead of silently dropping the overlay.
 */
export function installLatticeChunk(material: Material, uniforms: LatticeUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = inject(shader.vertexShader, "#include <common>", VERTEX_PARS, "after");
    shader.vertexShader = inject(shader.vertexShader, "#include <project_vertex>", VERTEX_MAIN, "after");
    shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_PARS, "after");
    shader.fragmentShader = inject(shader.fragmentShader, "#include <opaque_fragment>", FRAGMENT_MAIN, "before");
  };
  material.customProgramCacheKey = () => CACHE_KEY;
}

function inject(source: string, anchor: string, code: string, where: "before" | "after"): string {
  if (!source.includes(anchor)) throw new Error(`lattice chunk: shader has no "${anchor}"`);
  return source.replace(anchor, where === "after" ? `${anchor}\n${code}` : `${code}\n${anchor}`);
}
