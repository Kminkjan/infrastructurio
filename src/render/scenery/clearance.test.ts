import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { commitClearedMeshes, refreshInstanceBounds, writeClearedInstance } from "./clearance";

describe("scenery clearing mechanics (shared by trees and props)", () => {
  it("collapses an instance to its translation and restores the placed matrix exactly", () => {
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 3);
    const placed = new Float32Array(48);
    for (let k = 0; k < 3; k++) {
      new Matrix4().compose(new Vector3(k, 2 * k, -k), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3 * k), new Vector3(1.1, 1.2, 0.9)).toArray(placed, 16 * k);
      writeClearedInstance(mesh, k, placed, 16 * k, false);
    }
    const array = mesh.instanceMatrix.array as Float32Array;
    expect(Array.from(array)).toEqual(Array.from(placed));
    writeClearedInstance(mesh, 1, placed, 16, true);
    for (const e of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(array[16 + e]).toBe(0);
    for (const e of [3, 7, 11, 12, 13, 14, 15]) expect(array[16 + e]).toBe(placed[16 + e]);
    // The other instances are untouched.
    expect(Array.from(array.subarray(0, 16))).toEqual(Array.from(placed.subarray(0, 16)));
    expect(Array.from(array.subarray(32))).toEqual(Array.from(placed.subarray(32)));
    writeClearedInstance(mesh, 1, placed, 16, false);
    expect(Array.from(array)).toEqual(Array.from(placed));
    mesh.dispose();
  });

  it("commits dirty meshes: flags the upload, refreshes bounds as asked and empties the set", () => {
    const a = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1);
    const b = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1);
    const versions = [a.instanceMatrix.version, b.instanceMatrix.version];
    const dirty = new Set([a, b]);
    const rebound = vi.fn(refreshInstanceBounds);
    commitClearedMeshes(dirty, rebound);
    expect([a.instanceMatrix.version, b.instanceMatrix.version]).toEqual([versions[0]! + 1, versions[1]! + 1]);
    expect(rebound.mock.calls.map((c) => c[0])).toEqual([a, b]);
    expect(a.boundingSphere).not.toBeNull();
    expect(a.boundingBox).not.toBeNull();
    expect(dirty.size).toBe(0);
    commitClearedMeshes(new Set([b]));
    expect(b.boundingBox).not.toBeNull();
    a.dispose();
    b.dispose();
  });
});
