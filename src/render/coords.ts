import { Matrix4, Vector3 } from "three";

/**
 * The only conversion point between simulation space and Three.js world space.
 *
 * Simulation: right-handed ENU metres (x = east, y = north, z = up).
 * Three.js:   right-handed Y-up metres (X = east, Y = up, Z = south).
 *
 * world = (x, z, -y) is a -90° rotation about X with determinant +1, so it
 * never mirrors the scene (the legacy harness's (x, z, y) swap did).
 */
export const SIM_TO_WORLD: Readonly<Matrix4> = new Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);

export function simToWorld(x: number, y: number, z: number, target = new Vector3()): Vector3 {
  return target.set(x, z, -y);
}

export function worldToSim(v: Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: -v.z, z: v.y };
}
