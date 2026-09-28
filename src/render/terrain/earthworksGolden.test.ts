import { describe, expect, it } from "vitest";
import { type BufferGeometry, MeshBasicMaterial } from "three";
import { type Command, createSim, terrainBoundsM } from "../../core/sim/api";
import { generateDiorama } from "../../core/scenarios/baltic-diorama";
import { DIORAMA_PARAMS, diorama, groundPlans } from "../../../tests/support/groundPlans";
import { EARTHWORK_ATTRIBUTE } from "../art/shaderChunks/earthwork";
import { type ClearableLayer, SceneryClearance } from "../scenery/clearance";
import { propPlacements } from "../scenery/props";
import { buildSplatMaps } from "../scenery/splatMap";
import { EarthworksView } from "./EarthworksView";
import { TerrainView } from "./TerrainView";
import { sampleTerrainHeightM } from "./heightfieldRay";
import { type DrawnHeightfield, conforms, earthworkPiece, nearestOnPiece } from "./earthworks";
import { TERRAIN_LOOKS } from "./terrainLook";
import { chunkCounts } from "./terrainGeometry";
import { computeTerrainShading } from "./terrainShading";

/**
 * A byte pin of what the earthworks and the terrain bake draw on the diorama (PR #83 review,
 * 2026-09-27). Refactors of the conform, the chunk mesh, the shading bake, the splat bake and
 * the scenery clearing must keep every byte; the hashes change only with a deliberate change
 * of the output, named in the commit that updates them.
 */

/** FNV-1a (32-bit) over the bytes of typed arrays, lengths included. */
function fnv(arrays: readonly ArrayBufferView[]): string {
  let h = 0x811c9dc5;
  const mix = (b: number) => {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const a of arrays) {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (const b of [a.byteLength & 0xff, (a.byteLength >>> 8) & 0xff, (a.byteLength >>> 16) & 0xff]) mix(b);
    for (let i = 0; i < bytes.length; i++) mix(bytes[i] ?? 0);
  }
  return h.toString(16).padStart(8, "0");
}

/** Refined triangles by ascending id: ids, then heights. */
function fieldArrays(field: DrawnHeightfield): ArrayBufferView[] {
  const ids = [...field.triangles.keys()].sort((a, b) => a - b);
  const heights = new Float32Array(ids.length * 15);
  ids.forEach((id, i) => heights.set(field.triangles.get(id) ?? new Float32Array(15), 15 * i));
  return [Float64Array.from(ids), heights];
}

class PointLayer implements ClearableLayer {
  readonly cleared: Uint8Array;
  constructor(readonly points: Float64Array) {
    this.cleared = new Uint8Array(points.length / 2);
  }
  get clearableCount(): number {
    return this.cleared.length;
  }
  clearablePosition(i: number, out: { x: number; y: number }): void {
    out.x = this.points[2 * i] ?? 0;
    out.y = this.points[2 * i + 1] ?? 0;
  }
  setCleared(i: number, cleared: boolean): boolean {
    if ((this.cleared[i] === 1) === cleared) return false;
    this.cleared[i] = cleared ? 1 : 0;
    return true;
  }
  isCleared(i: number): boolean {
    return this.cleared[i] === 1;
  }
  commitCleared(): void {}
}

describe("earthworks and terrain bake output (a byte pin)", () => {
  it("draw the same bytes on a diorama network", () => {
    const { terrain } = diorama();
    const scenery = generateDiorama(terrain);
    const sim = createSim({ terrain: DIORAMA_PARAMS });
    for (const plan of groundPlans(40, "earthworks-golden")) {
      const command: Command = { type: "build-track", pieces: plan.pieces, structure: "auto" };
      sim.execute(command);
    }
    const network = sim.network();
    expect(network.pieces.length).toBeGreaterThan(100);
    const bounds0 = terrainBoundsM(terrain);

    // Scenery positions: every tree and prop.
    const props = Object.values(propPlacements(scenery)).flat();
    const points = new Float64Array(2 * (scenery.trees.count + props.length));
    for (let i = 0; i < scenery.trees.count; i++) {
      points[2 * i] = (scenery.trees.xMm[i] ?? 0) / 1000;
      points[2 * i + 1] = (scenery.trees.yMm[i] ?? 0) / 1000;
    }
    props.forEach((p, i) => {
      points[2 * (scenery.trees.count + i)] = p.xM;
      points[2 * (scenery.trees.count + i) + 1] = p.yM;
    });
    const layer = new PointLayer(points);

    const view = new TerrainView(terrain, new MeshBasicMaterial(), new MeshBasicMaterial(), TERRAIN_LOOKS.b.colours);
    const earthworks = new EarthworksView({ terrain, target: view, requestFrame: () => {}, now: () => 0, budgetMs: Infinity, scenery: new SceneryClearance(terrain, [layer]) });
    earthworks.sync(network);
    expect(earthworks.busy).toBe(false);

    const counts = chunkCounts(terrain);
    const chunkHashes = (lod: 0 | 1) => {
      const byName: Record<string, ArrayBufferView[]> = { position: [], normal: [], color: [], [EARTHWORK_ATTRIBUTE]: [], index: [] };
      for (let y = 0; y < counts.y; y++) {
        for (let x = 0; x < counts.x; x++) {
          const g = view.chunkMesh(x, y, lod)?.geometry as BufferGeometry | undefined;
          if (!g) continue;
          for (const name of ["position", "normal", "color", EARTHWORK_ATTRIBUTE]) byName[name]?.push(g.getAttribute(name).array as Float32Array);
          const index = g.getIndex()?.array;
          if (index) byName.index?.push(index as Uint16Array);
        }
      }
      return [fnv(byName.position ?? []), fnv(byName.normal ?? []), fnv(byName.color ?? []), fnv(byName[EARTHWORK_ATTRIBUTE] ?? []), fnv(byName.index ?? [])].join(" ");
    };

    const pieces = network.pieces.filter(conforms).map((p) => earthworkPiece(terrain, p));
    const reach = new Float64Array(pieces.length * 6);
    pieces.forEach((p, i) => reach.set([p.reachM, p.lengthM, p.minX, p.minY, p.maxX, p.maxY], 6 * i));
    // Nearest centreline points on a 1.3 m grid around the first 12 curves and shifts.
    const near: number[] = [];
    for (const p of pieces.filter((q) => q.prims.some((prim) => prim.kind === "arc")).slice(0, 12)) {
      for (let x = p.minX; x <= p.maxX; x += 1.3) {
        for (let y = p.minY; y <= p.maxY; y += 1.3) {
          const n = nearestOnPiece(p, x, y);
          near.push(n.d, n.s);
        }
      }
    }
    expect(near.length).toBeGreaterThan(10_000);

    // The drawn and natural surfaces (both LODs) and the sim-height sampler on a 3.7 m grid over the map.
    const surfaces: number[] = [];
    for (let x = -1; x < bounds0.maxX + 2; x += 3.7) {
      for (let y = -1; y < bounds0.maxY + 2; y += 3.7) {
        surfaces.push(earthworks.heightfield.heightAtM(x, y), earthworks.heightfield.naturalAtM(x, y), earthworks.heightfieldLod1.heightAtM(x, y), earthworks.heightfieldLod1.naturalAtM(x, y), sampleTerrainHeightM(terrain, x, y) ?? -1);
      }
    }

    const d11a = computeTerrainShading(terrain, TERRAIN_LOOKS.d11a.colours);
    const b = computeTerrainShading(terrain, TERRAIN_LOOKS.b.colours);
    const splat = buildSplatMaps(scenery, { widthM: bounds0.maxX, heightM: bounds0.maxY });

    const stats = earthworks.stats;
    const hashes = {
      pieces: pieces.length,
      refined: stats.refinedTriangles,
      withEarthworks: stats.chunksWithEarthworks,
      cleared: stats.clearedScenery,
      maxCutFill: [stats.maxCutM, stats.maxFillM],
      // Per LOD: position, normal, colour, earthwork attribute and index hashes over every chunk.
      lod0: chunkHashes(0),
      lod1: chunkHashes(1),
      heightfield0: fnv(fieldArrays(earthworks.heightfield)),
      heightfield1: fnv(fieldArrays(earthworks.heightfieldLod1)),
      reach: fnv([reach]),
      nearest: fnv([Float64Array.from(near)]),
      clearedFlags: fnv([layer.cleared]),
      surfaces: fnv([Float64Array.from(surfaces)]),
      shadingD11a: fnv([d11a.normals, d11a.colors, d11a.dryColors, d11a.waterDistance]),
      shadingB: fnv([b.normals, b.colors, b.dryColors, b.waterDistance]),
      splat: fnv([splat.splat, splat.field, splat.ao]),
    };
    // Re-recorded 2026-09-28 for D4 (owner decision "M2"), deliberately: the pinned network changed, not the conform.
    // The 40 plans are auto-graded under D4's rules, so some pieces are bridges and tunnels the conform leaves alone
    // (411 ground pieces until D4, when every plan followed the ground and nothing was judged); since M2 the band is
    // ±8 m and a drag on water starts at the deck height. The bridges near the ground now take a cut
    // (`cutsUnderDeck`). Checked before re-recording: under the D4 core half's rules (±4 m, no dip at abutments, no
    // deck start) this code with bridge cuts disabled drew every hash of the merged head c21e941 exactly (299 pieces,
    // 5,406 refined), so the refactor itself moved no byte; with bridge cuts on, one deck within 0.6 m of the ground
    // there added 7 refined triangles. The terrain bakes (shading, splat) are unchanged.
    // Re-recorded again 2026-09-28 (D4 feel-check fixes), deliberately: the chains' earthworks now stop at the plane
    // through each end where a bridge or a tunnel goes on (`ClipPlane`, a 2 : 1 headwall past it), so the approach
    // cones no longer run under a bridge's first span or into the hill behind a portal. Refined LOD0 triangles
    // 6,670 → 6,173; the deepest cut and fill 8.49 m and 8.75 m → 8.00 m and 7.86 m (only those cones went past the
    // ±8 m band); 14 fewer scenery items cleared. Checked before re-recording: with the clip planes disabled, the rule
    // moved into `core/track/earthworks.ts` drew every hash of 3a4c2f5 exactly (the pieces, reaches and nearest points
    // are unchanged here too), so moving the rule into the core moved no byte.
    expect(hashes).toEqual({
      pieces: 327,
      refined: 6173,
      withEarthworks: 37,
      cleared: 292,
      maxCutFill: [7.997250366210935, 7.86400032043457],
      lod0: "a7c7e15b 843396e3 d4567712 2b90c783 260da98b",
      lod1: "11e2f543 dce88e16 08a6d71c 3c525296 c9019c6d",
      heightfield0: "b7567503",
      heightfield1: "b60990bf",
      reach: "10a1303f",
      nearest: "ccf44728",
      clearedFlags: "a0e1f7ab",
      surfaces: "c62bb8a6",
      shadingD11a: "ab72930b",
      shadingB: "aed09c41",
      splat: "d14a2fa6",
    });
    view.dispose();
  });
});
