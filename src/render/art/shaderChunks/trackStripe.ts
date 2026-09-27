import { Color, type IUniform } from "three";
import { palette } from "../palette";
import { ALBEDO_ANCHOR, type ShaderChunk, inject } from "./chunk";

/**
 * The far-LOD ballast stripe (art direction "Track": below 4 ppm the
 * sleepers hide and the ballast carries a stripe instead). The ballast
 * geometry marks its centre band with a `trackStripe` vertex attribute (1 on
 * the band, 0 elsewhere); while `uTrackStripe` is 1 the band takes the
 * stripe colour, so the network still reads as track where rails and
 * sleepers would be under a pixel. Near LOD sets it to 0 and the ballast
 * looks plain.
 */

export interface TrackStripeUniforms {
  readonly uTrackStripe: IUniform<number>;
  readonly uTrackStripeColor: IUniform<Color>;
}

export function createTrackStripeUniforms(): TrackStripeUniforms {
  return { uTrackStripe: { value: 0 }, uTrackStripeColor: { value: new Color(palette.sleeper) } };
}

const VERTEX_PARS = /* glsl */ `
attribute float trackStripe;
varying float vTrackStripe;
`;

const VERTEX_MAIN = /* glsl */ `
vTrackStripe = trackStripe;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uTrackStripe;
uniform vec3 uTrackStripeColor;
varying float vTrackStripe;
`;

const FRAGMENT_MAIN = /* glsl */ `
diffuseColor.rgb = mix( diffuseColor.rgb, uTrackStripeColor, uTrackStripe * step( 0.5, vTrackStripe ) );
`;

export function createTrackStripeChunk(uniforms: TrackStripeUniforms): ShaderChunk {
  return {
    key: "track-stripe-v1",
    patch(shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = inject(shader.vertexShader, "#include <common>", VERTEX_PARS, "after");
      shader.vertexShader = inject(shader.vertexShader, "#include <begin_vertex>", VERTEX_MAIN, "after");
      shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_PARS, "after");
      shader.fragmentShader = inject(shader.fragmentShader, ALBEDO_ANCHOR, FRAGMENT_MAIN, "before");
    },
  };
}
