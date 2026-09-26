import type { IUniform, Material } from "three";

/**
 * Composition of isolated `onBeforeCompile` chunks (ADR 0013, art direction
 * "Materials"). Each chunk module owns its GLSL and uniforms and patches three's
 * shader source at named anchors; `installChunks` runs several on one material
 * and sets a `customProgramCacheKey` from their keys, so materials with the same
 * chunk list share a program and different lists never collide in the cache.
 *
 * Ordering: chunks insert *before* an anchor, so code lands in install order.
 * Albedo edits go before `#include <alphamap_fragment>` (just after the vertex
 * colours are applied), output edits before `#include <opaque_fragment>`.
 */

/** The part of three's shader object a chunk may touch. */
export interface ShaderSource {
  uniforms: Record<string, IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

export interface ShaderChunk {
  /** Joins the program cache key; change it whenever the chunk's GLSL changes. */
  readonly key: string;
  patch(shader: ShaderSource): void;
}

export const ALBEDO_ANCHOR = "#include <alphamap_fragment>";
export const OUTPUT_ANCHOR = "#include <opaque_fragment>";

/**
 * Inserts `code` before or after `anchor`. Throws when the anchor is missing,
 * so a three upgrade that renames a chunk fails loudly instead of silently
 * dropping the effect.
 */
export function inject(source: string, anchor: string, code: string, where: "before" | "after"): string {
  if (!source.includes(anchor)) throw new Error(`shader chunk: shader has no "${anchor}"`);
  return source.replace(anchor, where === "after" ? `${anchor}\n${code}` : `${code}\n${anchor}`);
}

/** Replaces `anchor` outright (for chunks that redefine one of three's includes). */
export function replaceInclude(source: string, anchor: string, code: string): string {
  if (!source.includes(anchor)) throw new Error(`shader chunk: shader has no "${anchor}"`);
  return source.replace(anchor, code);
}

const WORLD_VERTEX_PARS = /* glsl */ `
varying vec3 vArtWorld;
`;

// World position of the final vertex, instancing and batching included. The
// chunk runs after project_vertex, so it sees any sway applied to `transformed`.
const WORLD_VERTEX_MAIN = /* glsl */ `
{
  vec4 artWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
  artWorld = batchingMatrix * artWorld;
  #endif
  #ifdef USE_INSTANCING
  artWorld = instanceMatrix * artWorld;
  #endif
  vArtWorld = ( modelMatrix * artWorld ).xyz;
}
`;

/**
 * Adds a `vArtWorld` varying (world-space position) to both stages, once per
 * shader however many chunks ask for it. three's own `worldPosition` exists
 * only when shadows or environment maps are on, so chunks never rely on it.
 */
export function ensureArtWorld(shader: ShaderSource): void {
  if (shader.vertexShader.includes("varying vec3 vArtWorld;")) return;
  shader.vertexShader = inject(shader.vertexShader, "#include <common>", WORLD_VERTEX_PARS, "after");
  shader.vertexShader = inject(shader.vertexShader, "#include <project_vertex>", WORLD_VERTEX_MAIN, "after");
  shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", WORLD_VERTEX_PARS, "after");
}

/** Installs `chunks` on `material` in order, with a cache key naming all of them. */
export function installChunks(material: Material, chunks: readonly ShaderChunk[]): void {
  const key = chunks.map((chunk) => chunk.key).join("+");
  material.onBeforeCompile = (shader) => {
    for (const chunk of chunks) chunk.patch(shader);
  };
  material.customProgramCacheKey = () => key;
}
