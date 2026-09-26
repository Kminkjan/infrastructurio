import { describe, expect, it } from "vitest";
import { Color, Matrix4 } from "three";
import { convexInwardFacing, downFacing, inwardFacing, triangleCount, windingMismatches } from "../../../tests/support/geometry";
import { palette } from "../art/palette";
import { MeshBuilder } from "./meshBuilder";

describe("mesh builder", () => {
  it("winds every primitive outward, agreeing with its normals", () => {
    const b = new MeshBuilder();
    b.box({ x: 1, z: -2, y0: 0, y1: 3, sx: 4, sz: 2, bottom: true });
    b.prism({ x: 5, z: 0, y0: 0, y1: 2, radius: 1, radiusTop: 0.6, sides: 7, bottom: true });
    b.cone({ x: -3, z: 3, y0: 1, y1: 4, radius: 1.5, sides: 8, bottom: true });
    b.blob({ x: 0, y: 6, z: 0, rx: 2, ry: 1, rz: 1.5, shape: "icosahedron" });
    b.blob({ x: 0, y: 9, z: 0, rx: 1, ry: 1, rz: 1, shape: "octahedron" });
    const g = b.build();
    expect(triangleCount(g)).toBe(12 + (14 + 5 + 5) + (8 + 6) + 20 + 8);
    expect(windingMismatches(g)).toBe(0);
    expect(inwardFacing(g, b.parts)).toBe(0);
  });

  it("orients a hand-placed quad away from its inside point, whichever order its corners come in", () => {
    for (const flip of [false, true]) {
      const b = new MeshBuilder();
      const pts = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ];
      const [p0, p1, p2, p3] = flip ? [...pts].reverse() : pts;
      b.quad(p0!, p1!, p2!, p3!, { x: 0.5, y: 0.5, z: -1 });
      const g = b.build();
      expect(g.getAttribute("normal").getZ(0)).toBeCloseTo(1, 12);
      expect(inwardFacing(g, b.parts)).toBe(0);
    }
  });

  it("records each part's kind and bottom cap, so the convex check can ignore the inside point", () => {
    const b = new MeshBuilder();
    b.box({ x: 0, z: 0, y0: 0, y1: 1, sx: 1, sz: 1, bottom: true });
    b.cone({ x: 3, z: 0, y0: 0, y1: 2, radius: 1, sides: 6, bottom: true });
    b.quad({ x: 0, y: 5, z: 0 }, { x: 1, y: 5, z: 0 }, { x: 1, y: 5, z: 1 }, { x: 0, y: 5, z: 1 }, { x: 0.5, y: 4, z: 0.5 });
    expect(b.parts.map((p) => [p.kind, p.start, p.soffitStart, p.end])).toEqual([
      ["box", 0, 10, 12],
      ["cone", 12, 18, 22],
      ["quad", 22, 24, 24],
    ]);
    const g = b.build();
    expect(convexInwardFacing(g, b.parts)).toBe(0);
    expect(downFacing(g, b.parts)).toBe(2 * 4); // the box's four sides only; caps and the quad face up or are soffits
  });

  it("lets the independent oracles catch what the inside-point checks cannot (negative self-check)", () => {
    // A roof plane handed an inside point above it faces into the building, yet agrees with its
    // normal and faces away from that recorded point.
    const roof = new MeshBuilder();
    roof.quad({ x: 0, y: 10, z: 0 }, { x: 4, y: 10, z: 0 }, { x: 4, y: 10, z: 4 }, { x: 0, y: 10, z: 4 }, { x: 2, y: 11, z: 2 });
    const r = roof.build();
    expect(windingMismatches(r)).toBe(0);
    expect(inwardFacing(r, roof.parts)).toBe(0);
    expect(downFacing(r, roof.parts)).toBe(2);
    // One flipped triangle in a box is caught against the box's own vertices.
    const box = new MeshBuilder();
    box.box({ x: 0, z: 0, y0: 0, y1: 2, sx: 2, sz: 2 });
    const g = box.build();
    const p = g.getAttribute("position");
    const [bx, by, bz] = [p.getX(1), p.getY(1), p.getZ(1)];
    p.setXYZ(1, p.getX(2), p.getY(2), p.getZ(2));
    p.setXYZ(2, bx, by, bz);
    expect(convexInwardFacing(g, box.parts)).toBe(1);
  });

  it("keeps orientation through a transform", () => {
    const b = new MeshBuilder();
    b.transform(new Matrix4().makeRotationY(1.1).setPosition(3, 0, -4));
    b.box({ x: 0, z: 0, y0: 0, y1: 2, sx: 3, sz: 1 });
    const g = b.build();
    expect(windingMismatches(g)).toBe(0);
    expect(inwardFacing(g, b.parts)).toBe(0);
  });

  it("writes palette colours in linear space and darkens them toward the ground", () => {
    const b = new MeshBuilder();
    b.color(palette.stucco).ao({ floor: 0.5, heightM: 2 }).box({ x: 0, z: 0, y0: 0, y1: 4, sx: 1, sz: 1 });
    const g = b.build();
    const colors = g.getAttribute("color");
    const positions = g.getAttribute("position");
    const linear = new Color(palette.stucco);
    for (let i = 0; i < colors.count; i++) {
      const y = positions.getY(i);
      const expected = y <= 0 ? 0.5 : y >= 2 ? 1 : undefined;
      if (expected !== undefined) expect(colors.getX(i)).toBeCloseTo(linear.r * expected, 6);
    }
    // Linear, not raw sRGB bytes: the stored red is well below the hex's 0xe9 / 255.
    expect(linear.r).toBeLessThan(0xe9 / 255 - 0.05);
  });

  it("writes an alpha channel when asked (the foliage mask)", () => {
    const b = new MeshBuilder(true);
    b.color(palette.timber, 0).box({ x: 0, z: 0, y0: 0, y1: 1, sx: 1, sz: 1 });
    b.neutral(0.9, 1).cone({ x: 0, z: 0, y0: 1, y1: 3, radius: 1, sides: 5 });
    const colors = b.build().getAttribute("color");
    expect(colors.itemSize).toBe(4);
    expect(colors.getW(0)).toBe(0);
    expect(colors.getW(colors.count - 1)).toBe(1);
  });
});
