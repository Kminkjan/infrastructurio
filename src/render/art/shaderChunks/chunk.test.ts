import { describe, expect, it } from "vitest";
import { MeshLambertMaterial, ShaderLib } from "three";
import { type ShaderSource, installChunks } from "./chunk";
import { createEdgeFadeChunk, createEdgeFadeUniforms } from "./edgeFade";
import { createFoliageTintChunk } from "./foliageTint";
import { createGrainChunk, createGrainUniforms } from "./grain";
import { createSplatChunk, createSplatUniforms } from "./splat";
import { createWindSwayChunk, createWindSwayUniforms } from "./windSway";

function lambertSource(): ShaderSource {
  return { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
}

function compile(material: MeshLambertMaterial): ShaderSource {
  const shader = lambertSource();
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

const bounds = { minX: 0, minZ: -1500, maxX: 2000, maxZ: 0 };

describe("shader chunk composition", () => {
  it("patches three's Lambert shader with every chunk and a cache key naming them in order", () => {
    const material = new MeshLambertMaterial({ vertexColors: true });
    installChunks(material, [
      createFoliageTintChunk(),
      createWindSwayChunk(createWindSwayUniforms()),
      createGrainChunk(createGrainUniforms()),
      createEdgeFadeChunk(createEdgeFadeUniforms(bounds)),
    ]);
    expect(material.customProgramCacheKey()).toBe("foliage-tint-v1+wind-sway-v1+grain-v1+edge-fade-v1");
    const shader = compile(material);
    expect(shader.vertexShader).not.toContain("#include <color_vertex>");
    expect(shader.vertexShader).toContain("mix( vec3( 1.0 ), instanceColor.rgb, vColor.a )");
    expect(shader.vertexShader).toContain("transformed.x += swayReach");
    expect(shader.fragmentShader).toContain("artGrain( vArtWorld )");
    expect(shader.fragmentShader).toContain("uEdgeHaze");
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(["uTime", "uSwayAmplitude", "uGrainAmount", "uEdgeBounds"]));
    material.dispose();
  });

  it("declares the world-position varying once however many chunks need it", () => {
    const material = new MeshLambertMaterial();
    installChunks(material, [createGrainChunk(createGrainUniforms()), createEdgeFadeChunk(createEdgeFadeUniforms(bounds)), createSplatChunk(createSplatUniforms())]);
    const shader = compile(material);
    expect(shader.vertexShader.split("varying vec3 vArtWorld;").length - 1).toBe(1);
    expect(shader.fragmentShader.split("varying vec3 vArtWorld;").length - 1).toBe(1);
    // Instanced meshes get the instance transform in the world position.
    expect(shader.vertexShader).toContain("artWorld = instanceMatrix * artWorld;");
    material.dispose();
  });

  it("keeps install order at a shared anchor: splat, then grain, then the albedo is final", () => {
    const material = new MeshLambertMaterial();
    installChunks(material, [createSplatChunk(createSplatUniforms()), createGrainChunk(createGrainUniforms())]);
    const shader = compile(material);
    const splat = shader.fragmentShader.indexOf("diffuseColor.rgb = base");
    const grain = shader.fragmentShader.indexOf("diffuseColor.rgb *= 1.0 + uGrainAmount");
    const colour = shader.fragmentShader.indexOf("#include <color_fragment>");
    const lights = shader.fragmentShader.indexOf("#include <lights_lambert_fragment>");
    expect(colour).toBeLessThan(splat);
    expect(splat).toBeLessThan(grain);
    expect(grain).toBeLessThan(lights);
    material.dispose();
  });

  it("puts the edge fade after lighting, on the outgoing light", () => {
    const material = new MeshLambertMaterial();
    installChunks(material, [createEdgeFadeChunk(createEdgeFadeUniforms(bounds))]);
    const shader = compile(material);
    const outgoing = shader.fragmentShader.indexOf("vec3 outgoingLight =");
    const fade = shader.fragmentShader.indexOf("outgoingLight = mix( outgoingLight, uEdgeHaze");
    expect(outgoing).toBeGreaterThan(0);
    expect(fade).toBeGreaterThan(outgoing);
    expect(fade).toBeLessThan(shader.fragmentShader.indexOf("#include <opaque_fragment>"));
    material.dispose();
  });

  it("fails loudly when three's shader lacks an anchor", () => {
    const shader: ShaderSource = { uniforms: {}, vertexShader: "void main() {}", fragmentShader: "void main() {}" };
    expect(() => createGrainChunk(createGrainUniforms()).patch(shader)).toThrow(/has no/);
  });
});
