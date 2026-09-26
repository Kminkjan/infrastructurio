import { describe, expect, it } from "vitest";
import { Color, InstancedMesh, MeshLambertMaterial, SRGBColorSpace } from "three";
import { convexInwardFacing, inwardFacing, sameGeometry, triangleCount, windingMismatches } from "../../../tests/support/geometry";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { TREE_BIRCH, TREE_PINE, TREE_SPRUCE, type TreeInstances } from "../../core/scenarios/baltic-diorama";
import { AssetRegistry } from "../art/AssetRegistry";
import { palette } from "../art/palette";
import { NAMED_ZOOMS } from "../camera/isoMath";
import {
  TREE_BUDGETS,
  TREE_KINDS,
  TREE_LOD0_FROM_PPM,
  TREE_OVERSIZE,
  TREE_SCALE_MAX,
  TREE_SCALE_MIN,
  TREE_SHADOW_FROM_PPM,
  TreeLayer,
  buildTree,
  registerTreeAssets,
  treeLook,
  treeTierForPpm,
} from "./trees";

describe("tree models", () => {
  it("keep LOD0 within 60–120 triangles and LOD1 within 24–30", () => {
    for (const kind of TREE_KINDS) {
      for (const lod of [0, 1] as const) {
        const n = triangleCount(buildTree(kind, lod).build());
        expect(n, `${kind} lod${lod}`).toBeGreaterThanOrEqual(TREE_BUDGETS[lod].min);
        expect(n, `${kind} lod${lod}`).toBeLessThanOrEqual(TREE_BUDGETS[lod].max);
      }
    }
  });

  it("wind every triangle outward, agreeing with its normals", () => {
    for (const kind of TREE_KINDS) {
      for (const lod of [0, 1] as const) {
        const b = buildTree(kind, lod);
        const g = b.build();
        expect(windingMismatches(g)).toBe(0);
        expect(inwardFacing(g, b.parts)).toBe(0);
        // Every tree part is convex: checked against its own vertices, not the recorded inside point.
        expect(b.parts.every((part) => part.kind !== "quad" && part.kind !== "triangle")).toBe(true);
        expect(convexInwardFacing(g, b.parts)).toBe(0);
      }
    }
  });

  it("mask the crown (alpha 1) apart from the trunk (alpha 0), and stand on the ground", () => {
    for (const kind of TREE_KINDS) {
      const g = buildTree(kind, 0).build();
      const colors = g.getAttribute("color");
      const positions = g.getAttribute("position");
      let crown = 0;
      let trunk = 0;
      let minY = Infinity;
      for (let i = 0; i < colors.count; i++) {
        if (colors.getW(i) === 1) crown++;
        else if (colors.getW(i) === 0) trunk++;
        minY = Math.min(minY, positions.getY(i));
      }
      expect(crown).toBeGreaterThan(trunk);
      expect(trunk).toBeGreaterThan(0);
      expect(minY).toBe(0);
    }
  });

  it("are built identically every time", () => {
    for (const kind of TREE_KINDS) expect(sameGeometry(buildTree(kind, 0).build(), buildTree(kind, 0).build())).toBe(true);
  });

  it("register with the asset registry under their kinds, with a foliage slot and budget", () => {
    const registry = new AssetRegistry();
    registerTreeAssets(registry);
    for (const kind of TREE_KINDS) {
      const asset = registry.get(kind, 0, 1);
      expect(asset.slots.foliage).toBeDefined();
      expect(asset.triangles).toBeLessThanOrEqual(asset.triangleBudget);
    }
    registry.dispose();
  });
});

describe("tree looks", () => {
  it("scale trees 0.8–1.3 times, 15% oversize, with any yaw", () => {
    let minScale = Infinity;
    let maxScale = -Infinity;
    for (let seed = 0; seed < 5000; seed++) {
      const look = treeLook(TREE_SPRUCE, (seed * 2654435761) >>> 0);
      minScale = Math.min(minScale, look.scale);
      maxScale = Math.max(maxScale, look.scale);
      expect(look.yaw).toBeGreaterThanOrEqual(0);
      expect(look.yaw).toBeLessThanOrEqual(2 * Math.PI);
    }
    expect(minScale).toBeGreaterThanOrEqual(TREE_OVERSIZE * TREE_SCALE_MIN - 1e-9);
    expect(maxScale).toBeLessThanOrEqual(TREE_OVERSIZE * TREE_SCALE_MAX + 1e-9);
    expect(maxScale - minScale).toBeGreaterThan(0.5);
  });

  it("tint crowns near their palette pair, never far from it", () => {
    const pairs: [number, number, number][] = [
      [TREE_SPRUCE, palette.spruce, palette.spruceLight],
      [TREE_PINE, palette.pineCrown, palette.pineCrown],
      [TREE_BIRCH, palette.deciduous, palette.deciduousLight],
    ];
    // Compared in sRGB (perceptual), where the jitter is applied: within 0.06 of the pair's range.
    const srgb = (c: Color) => c.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
    for (const [species, a, b] of pairs) {
      const ca = srgb(new Color(a));
      const cb = srgb(new Color(b));
      for (let seed = 0; seed < 500; seed++) {
        const c = srgb(treeLook(species, (seed * 40503 + 17) >>> 0).color);
        for (const k of ["r", "g", "b"] as const) {
          expect(c[k]).toBeGreaterThan(Math.min(ca[k], cb[k]) - 0.06);
          expect(c[k]).toBeLessThan(Math.max(ca[k], cb[k]) + 0.06);
        }
      }
    }
  });
});

describe("tree layer", () => {
  const terrain = makeTerrain(120, 100, () => 120);
  const trees: TreeInstances = {
    count: 4,
    xMm: Int32Array.from([10_000, 20_000, 300_000, 310_000]),
    yMm: Int32Array.from([10_000, 12_000, 20_000, 30_000]),
    species: Uint8Array.from([TREE_SPRUCE, TREE_SPRUCE, TREE_PINE, TREE_BIRCH]),
    seed: Uint32Array.from([1, 2, 3, 4]),
  };

  /** The tree meshes a frame would draw (visible through every parent). */
  const drawn = (layer: TreeLayer): InstancedMesh[] => {
    const out: InstancedMesh[] = [];
    layer.group.traverseVisible((o) => {
      if (o instanceof InstancedMesh) out.push(o);
    });
    return out;
  };

  it("instances trees per 256 m chunk × species, LOD1 sharing LOD0's instance data", () => {
    const registry = new AssetRegistry();
    registerTreeAssets(registry);
    const layer = new TreeLayer(trees, terrain, registry, new MeshLambertMaterial());
    expect(layer.instanceCount).toBe(4);
    // Chunk (0,0) spruce ×2; chunk (1,0) pine and birch.
    expect(layer.meshCount).toBe(3);
    const meshes = layer.group.getObjectByName("trees by chunk")!.children as InstancedMesh[];
    expect(meshes).toHaveLength(6);
    for (let i = 0; i < meshes.length; i += 2) {
      expect(meshes[i + 1]!.instanceMatrix).toBe(meshes[i]!.instanceMatrix);
      expect(meshes[i + 1]!.instanceColor).toBe(meshes[i]!.instanceColor);
      expect(meshes[i]!.boundingSphere).not.toBeNull();
    }
    layer.update(TREE_LOD0_FROM_PPM - 0.5);
    expect(drawn(layer)).toEqual([meshes[1], meshes[3], meshes[5]]);
    expect(drawn(layer).every((m) => m.castShadow)).toBe(true);
    layer.update(6);
    expect(drawn(layer)).toEqual([meshes[0], meshes[2], meshes[4]]);
    expect(drawn(layer).every((m) => m.castShadow)).toBe(true);
    layer.dispose();
    registry.dispose();
  });

  it("draws the far band from one whole-map mesh per species, with its own copy of the instances and no shadows", () => {
    const registry = new AssetRegistry();
    registerTreeAssets(registry);
    const layer = new TreeLayer(trees, terrain, registry, new MeshLambertMaterial());
    expect(layer.farMeshCount).toBe(3);
    const chunkMeshes = layer.group.getObjectByName("trees by chunk")!.children as InstancedMesh[];
    for (const ppm of [0.75, NAMED_ZOOMS.far, TREE_SHADOW_FROM_PPM - 0.01]) {
      layer.update(ppm);
      const far = drawn(layer);
      expect(far, `${ppm} ppm`).toHaveLength(3);
      expect(far.every((m) => !m.castShadow && m.boundingSphere !== null)).toBe(true);
      expect(far.reduce((n, m) => n + m.count, 0)).toBe(trees.count);
      for (const m of far) {
        // Its own attributes (never a chunk's), holding the same transforms and colours.
        const twin = chunkMeshes.find((c) => c.geometry === m.geometry && c.count === m.count)!;
        expect(m.instanceMatrix).not.toBe(twin.instanceMatrix);
        expect(Array.from(m.instanceMatrix.array)).toEqual(Array.from(twin.instanceMatrix.array));
        expect(Array.from(m.instanceColor!.array)).toEqual(Array.from(twin.instanceColor!.array));
      }
    }
    layer.update(TREE_SHADOW_FROM_PPM);
    expect(drawn(layer)).toHaveLength(3);
    expect(drawn(layer).every((m) => m.castShadow)).toBe(true);
    layer.dispose();
    registry.dispose();
  });

  it("picks the tier by zoom: LOD0 from 4 ppm, LOD1 from 2 ppm, the whole-map meshes below", () => {
    expect([24, TREE_LOD0_FROM_PPM, 3.99, TREE_SHADOW_FROM_PPM, 1.99, 0.75].map(treeTierForPpm)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
