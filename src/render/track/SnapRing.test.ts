import { describe, expect, it } from "vitest";
import { CircleGeometry, Mesh, RingGeometry, Vector3 } from "three";
import { IsoCamera } from "../camera/IsoCamera";
import { SnapRing, turnoutGlyph } from "./SnapRing";

/**
 * The snap ring's turnout glyph is a procedural generator drawn with a
 * FrontSide material, so its winding must face the camera (render guide
 * "Geometry, winding and materials"): a wrong winding would make it
 * silently invisible.
 */

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();

/** z of (b − a) × (c − a) for each triangle of an indexed geometry: positive faces +z. */
function faceNormalsZ(g: ReturnType<typeof turnoutGlyph>): number[] {
  const index = g.getIndex();
  const pos = g.getAttribute("position");
  if (!index) throw new Error("expected an indexed geometry");
  const out: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    a.fromBufferAttribute(pos, index.getX(t));
    b.fromBufferAttribute(pos, index.getX(t + 1));
    c.fromBufferAttribute(pos, index.getX(t + 2));
    out.push((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  }
  return out;
}

describe("snap ring turnout glyph", () => {
  it("winds every triangle to face +z, the side the ring and disc face", () => {
    const glyph = turnoutGlyph();
    const z = faceNormalsZ(glyph);
    expect(z).toHaveLength(6);
    for (const [i, n] of z.entries()) expect(n, `triangle ${i}`).toBeGreaterThan(0);
    // The glyph's facing normal (+z) is the one three gives the ring and disc it is drawn with.
    for (const g of [new RingGeometry(0.72, 1, 40), new CircleGeometry(0.5, 32)]) {
      const normals = g.getAttribute("normal");
      for (let i = 0; i < normals.count; i++) expect(normals.getZ(i)).toBe(1);
      g.dispose();
    }
    glyph.dispose();
  });

  it("draws the glyph counter-clockwise on screen once billboarded, for all 6 yaws", () => {
    const ring = new SnapRing();
    ring.set({ kind: "track", node: { q: 3, r: 2, zMm: 1500 } });
    // The glyph is the only visible mesh with 6 triangles (18 indices) on a track pick.
    const glyph = ring.group.children.find((m): m is Mesh => m instanceof Mesh && m.visible && m.geometry.getIndex()?.count === 18);
    if (!glyph) throw new Error("no glyph mesh");
    const geometry = glyph.geometry;
    const index = geometry.getIndex();
    const pos = geometry.getAttribute("position");
    if (!index) throw new Error("expected an indexed geometry");
    for (const yawStep of [0, 1, 2, 3, 4, 5]) {
      const iso = new IsoCamera({ target: { x: 20, z: -10 }, ppm: 6, yawStep });
      iso.setViewport(1280, 800);
      iso.update(0);
      ring.update(iso.camera, iso.ppm);
      ring.group.updateMatrixWorld(true);
      for (let t = 0; t < index.count; t += 3) {
        a.fromBufferAttribute(pos, index.getX(t)).applyMatrix4(glyph.matrixWorld).project(iso.camera);
        b.fromBufferAttribute(pos, index.getX(t + 1)).applyMatrix4(glyph.matrixWorld).project(iso.camera);
        c.fromBufferAttribute(pos, index.getX(t + 2)).applyMatrix4(glyph.matrixWorld).project(iso.camera);
        // NDC is y-up, so a positive cross product is counter-clockwise (front-facing).
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        expect(cross, `yaw step ${yawStep}, triangle ${t / 3}`).toBeGreaterThan(0);
      }
    }
    ring.dispose();
  });
});
