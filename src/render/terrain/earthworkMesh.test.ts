import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { type Drag, type PieceSpec, groundMmAt, resolvePiece, toWorld } from "../../core/sim/api";
import { diorama } from "../../../tests/support/groundPlans";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { ISO_PITCH_RAD, type IsoView, worldToScreen, yawForStep } from "../camera/isoMath";
import { worldToSim } from "../coords";
import { EARTHWORK_ITEM_SIZE, earthworkLipOf, earthworkWeightOf } from "../art/shaderChunks/earthwork";
import {
  CREST_ROUND_M,
  ChunkPass,
  EARTHWORK_WEIGHT_FROM_X,
  type EarthworkPiece,
  FORMATION_HALF_WIDTH_M,
  type PieceInput,
  SIDE_SLOPE_RUN,
  chunksTouching,
  conformTerrain,
  earthworkPiece,
  piecesTouching,
} from "./earthworks";
import { type EarthworkMeshData, buildEarthworkChunk } from "./earthworkMesh";
import { type MeshData, buildChunkData } from "./terrainGeometry";
import { computeTerrainShading } from "./terrainShading";

function inputOf(spec: PieceSpec): PieceInput {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(res.failure.message);
  return { key: res.piece.key, prims: res.piece.prims, z0Mm: res.piece.ends[0].node.zMm, z1Mm: res.piece.ends[1].node.zMm };
}

/** The diorama's hill crossing used by the e2e: a free drag (226, 100) → (233, 117), a straight then an R 180 curve up to 10 m under the hill. */
function hillPlan(): PieceInput[] {
  const { terrain, sim } = diorama();
  const ground = (q: number, r: number) => groundMmAt(terrain, { q, r }) ?? 0;
  const w = toWorld({ q: 233, r: 117 });
  const drag: Drag = { from: { q: 226, r: 100, zMm: ground(226, 100) }, to: { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) }, dzMm: ground(233, 117) - ground(226, 100), magnetism: true };
  const plan = sim.planTrack(drag);
  expect(plan.pieces.some((p) => p.kind === "curve")).toBe(true);
  return plan.pieces.map(inputOf);
}

function passFor(terrain: ReturnType<typeof diorama>["terrain"], lod: 0 | 1, x: number, y: number, pieces: readonly EarthworkPiece[]): ChunkPass {
  const pass = new ChunkPass();
  pass.run(terrain, lod, x, y, piecesTouching(pieces, ChunkPass.chunkBox(terrain, lod, x, y)));
  return pass;
}

const vertex = (m: MeshData, i: number, out = new Vector3()) => out.set(m.positions[3 * i] ?? 0, m.positions[3 * i + 1] ?? 0, m.positions[3 * i + 2] ?? 0);

function forTriangles(m: MeshData, visit: (a: number, b: number, c: number) => void): void {
  for (let t = 0; t < m.triangleCount; t++) visit(m.indices[3 * t] ?? 0, m.indices[3 * t + 1] ?? 0, m.indices[3 * t + 2] ?? 0);
}

/** Once-used edges' total plan length, the most any edge is used, and repeated directed edges. */
function edgeReport(m: MeshData): { boundaryM: number; maxUse: number; repeatedDirected: number } {
  const undirected = new Map<string, number>();
  const directed = new Set<string>();
  let repeatedDirected = 0;
  forTriangles(m, (a, b, c) => {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      undirected.set(key, (undirected.get(key) ?? 0) + 1);
      const d = `${p}>${q}`;
      if (directed.has(d)) repeatedDirected += 1;
      directed.add(d);
    }
  });
  let boundaryM = 0;
  let maxUse = 0;
  const pa = new Vector3();
  const pb = new Vector3();
  for (const [key, uses] of undirected) {
    maxUse = Math.max(maxUse, uses);
    if (uses !== 1) continue;
    const [a, b] = key.split(",").map(Number) as [number, number];
    vertex(m, a, pa);
    vertex(m, b, pb);
    boundaryM += Math.hypot(pa.x - pb.x, pa.z - pb.z);
  }
  return { boundaryM, maxUse, repeatedDirected };
}

function planArea(m: MeshData): number {
  let area = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  forTriangles(m, (ia, ib, ic) => {
    vertex(m, ia, a);
    vertex(m, ib, b);
    vertex(m, ic, c);
    // World (x, −z) is the sim plan; counter-clockwise in plan is positive.
    area += ((b.x - a.x) * -(c.z - a.z) - -(b.z - a.z) * (c.x - a.x)) / 2;
  });
  return area;
}

describe("earthwork chunk geometry", () => {
  const { terrain } = diorama();
  const shading = computeTerrainShading(terrain);
  const plan = hillPlan().map((p) => earthworkPiece(terrain, p));
  const chunks: [number, number][] = [];
  chunksTouching(terrain, 0, { minX: Math.min(...plan.map((p) => p.minX)), minY: Math.min(...plan.map((p) => p.minY)), maxX: Math.max(...plan.map((p) => p.maxX)), maxY: Math.max(...plan.map((p) => p.maxY)) }, (x, y) => chunks.push([x, y]));
  const built = new Map<string, EarthworkMeshData>();
  for (const lod of [0, 1] as const) {
    for (const [x, y] of chunks) built.set(`${lod}:${x},${y}`, buildEarthworkChunk(passFor(terrain, lod, x, y, plan), shading));
  }
  const withEarthworks = [...built.entries()].filter(([, m]) => m.earthwork.some((w) => w > 0));

  it("refines the hill crossing at both LODs", () => {
    expect(withEarthworks.some(([k]) => k.startsWith("0:"))).toBe(true);
    expect(withEarthworks.some(([k]) => k.startsWith("1:"))).toBe(true);
  });

  it("winds every triangle counter-clockwise from above, agreeing with its vertex normals", () => {
    for (const [, m] of withEarthworks) {
      let bad = 0;
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      const face = new Vector3();
      forTriangles(m, (ia, ib, ic) => {
        vertex(m, ia, a);
        vertex(m, ib, b);
        vertex(m, ic, c);
        face.subVectors(b, a).cross(new Vector3().subVectors(c, a));
        if (face.y <= 0) bad++;
        for (const i of [ia, ib, ic]) {
          const n = new Vector3(m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]);
          if (face.dot(n) <= 0) bad++;
        }
      });
      expect(bad).toBe(0);
    }
  });

  it("winds every triangle counter-clockwise on screen at all six yaws, culling only faces that turn away from the camera", () => {
    // The render guide's oracle is on plan triangles: flattened, every triangle must project counter-clockwise.
    // Drawn, a cut face steeper than the 35.26° view pitch (1 : 1.5 side slope plus the track's grade) can face
    // away from the camera: FrontSide culls it, and on a heightfield such a face is hidden by the ground
    // between it and the camera anyway, so no hole opens. Any clockwise drawn triangle must be one of those.
    const [, m] = withEarthworks[0] ?? [];
    if (!m) throw new Error("no earthworks");
    const centre = vertex(m, m.positions.length / 3 - 1);
    let backFacing = 0;
    for (let k = 0; k < 6; k++) {
      const view: IsoView = { target: { x: centre.x, z: centre.z }, ppm: 6, yaw: yawForStep(k), pitch: ISO_PITCH_RAD, cssWidth: 1280, cssHeight: 720 };
      // Toward the camera: from the view's yaw and pitch (screen centre ray reversed).
      const far = worldToScreen(view, new Vector3(centre.x, centre.y, centre.z));
      const up = worldToScreen(view, new Vector3(centre.x, centre.y + 1, centre.z));
      expect(up.y).toBeLessThan(far.y);
      let planClockwise = 0;
      let wrong = 0;
      forTriangles(m, (ia, ib, ic) => {
        const [a, b, c] = [vertex(m, ia), vertex(m, ib), vertex(m, ic)];
        const flat = [a, b, c].map((p) => worldToScreen(view, new Vector3(p.x, 0, p.z)));
        const [fa, fb, fc] = flat as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
        if ((fb.x - fa.x) * (fc.y - fa.y) - (fb.y - fa.y) * (fc.x - fa.x) >= 0) planClockwise++;
        const [sa, sb, sc] = [worldToScreen(view, a), worldToScreen(view, b), worldToScreen(view, c)];
        if ((sb.x - sa.x) * (sc.y - sa.y) - (sb.y - sa.y) * (sc.x - sa.x) < 0) return;
        backFacing++;
        // Clockwise on screen: the face must be steeper than the view pitch.
        const face = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
        if (Math.acos(face.y) < ISO_PITCH_RAD - 1e-6) wrong++;
      });
      expect(planClockwise).toBe(0);
      expect(wrong).toBe(0);
    }
    expect(backFacing).toBeLessThan(m.triangleCount * 0.05);
  });

  it("stays watertight: no T-junctions, the same outline and plan area as the plain chunk", () => {
    for (const [key, m] of withEarthworks) {
      const [lod, xy] = key.split(":") as [string, string];
      const [x, y] = xy.split(",").map(Number) as [number, number];
      const plain = buildChunkData(terrain, shading, x, y, Number(lod) as 0 | 1);
      const report = edgeReport(m);
      const plainReport = edgeReport(plain);
      expect(report.maxUse).toBe(2);
      expect(report.repeatedDirected).toBe(0);
      expect(report.boundaryM).toBeCloseTo(plainReport.boundaryM, 6);
      expect(planArea(m)).toBeCloseTo(planArea(plain), 3);
      for (const array of [m.positions, m.normals, m.colors, m.earthwork]) expect(array.every(Number.isFinite)).toBe(true);
    }
  });

  it("draws exactly the heightfield that picking and scenery read", () => {
    const field = conformTerrain(terrain, { pieces: hillPlan() });
    const [key, m] = withEarthworks.find(([k]) => k.startsWith("0:")) ?? [];
    if (!key || !m) throw new Error("no LOD0 earthworks");
    // Bucket triangles by 5 m plan cells, then probe random points inside the chunk's refined area.
    const cells = new Map<string, number[]>();
    const tris: number[][] = [];
    const p = [new Vector3(), new Vector3(), new Vector3()] as const;
    forTriangles(m, (a, b, c) => {
      const id = tris.push([a, b, c]) - 1;
      vertex(m, a, p[0]);
      vertex(m, b, p[1]);
      vertex(m, c, p[2]);
      const xs = p.map((v) => v.x);
      const ys = p.map((v) => -v.z);
      for (let cx = Math.floor(Math.min(...xs) / 5); cx <= Math.floor(Math.max(...xs) / 5); cx++) {
        for (let cy = Math.floor(Math.min(...ys) / 5); cy <= Math.floor(Math.max(...ys) / 5); cy++) {
          const k = `${cx},${cy}`;
          const list = cells.get(k) ?? [];
          list.push(id);
          cells.set(k, list);
        }
      }
    });
    const meshHeight = (x: number, y: number): number | undefined => {
      for (const id of cells.get(`${Math.floor(x / 5)},${Math.floor(y / 5)}`) ?? []) {
        const [a, b, c] = (tris[id] ?? []).map((i) => worldToSim(vertex(m, i)));
        if (!a || !b || !c) continue;
        const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
        const u = ((x - a.x) * (c.y - a.y) - (c.x - a.x) * (y - a.y)) / det;
        const v = ((b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)) / det;
        if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) return a.z + u * (b.z - a.z) + v * (c.z - a.z);
      }
      return undefined;
    };
    let probed = 0;
    let worst = 0;
    for (const piece of plan) {
      for (let x = piece.minX; x < piece.maxX; x += 0.83) {
        for (let y = piece.minY; y < piece.maxY; y += 0.79) {
          const h = meshHeight(x, y);
          if (h === undefined) continue;
          probed++;
          worst = Math.max(worst, Math.abs(h - field.heightAtM(x, y)));
        }
      }
    }
    expect(probed).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1e-3);
  });

  it("gives back the plain chunk exactly when nothing moved (undo restores the natural terrain)", () => {
    const pass = new ChunkPass();
    for (const lod of [0, 1] as const) {
      for (const [x, y] of chunks) {
        pass.run(terrain, lod, x, y, []);
        const m = buildEarthworkChunk(pass, shading);
        const plain = buildChunkData(terrain, shading, x, y, lod);
        expect(m.positions).toEqual(plain.positions);
        expect(m.normals).toEqual(plain.normals);
        expect(m.colors).toEqual(plain.colors);
        expect(m.indices).toEqual(plain.indices);
        expect(m.earthwork.every((w) => w === 0)).toBe(true);
      }
    }
  });

  it("carries the colour attribute: departure and distance where moved, and no colour on anything the rule left natural", () => {
    const field = conformTerrain(terrain, { pieces: hillPlan() });
    let moved = 0;
    let natural = 0;
    let coloured = 0;
    for (const [key, m] of withEarthworks) {
      if (!key.startsWith("0:")) continue;
      expect(m.earthwork.length).toBe((m.positions.length / 3) * EARTHWORK_ITEM_SIZE);
      for (let i = 0; i < m.positions.length / 3; i++) {
        const s = worldToSim(vertex(m, i));
        const departure = s.z - field.naturalAtM(s.x, s.y);
        const [x, dep, dist] = [m.earthwork[3 * i] ?? 0, m.earthwork[3 * i + 1] ?? 0, m.earthwork[3 * i + 2] ?? 0];
        if (Math.abs(departure) < 1e-4) {
          natural += 1;
          // Unmoved (plain, fan and natural sub-vertices alike, or moved by under 0.1 mm where the soft band starts):
          // no earthwork colour, and no departure to speak of.
          expect(earthworkWeightOf(x)).toBeLessThan(1e-3);
          expect(Math.abs(dep)).toBeLessThan(1e-4);
        } else {
          moved += 1;
          expect(dep).toBeCloseTo(departure, 3);
          expect(dist).toBeLessThan(40);
          if (earthworkWeightOf(x) > 0) coloured += 1;
          // Anything moved lies on the lip at least, so the facets are gone there.
          expect(earthworkLipOf(x)).toBeGreaterThan(0);
        }
      }
    }
    expect(moved).toBeGreaterThan(200);
    expect(natural).toBeGreaterThan(1000);
    expect(coloured).toBeGreaterThan(100);
    expect(EARTHWORK_WEIGHT_FROM_X).toBeGreaterThan(0);
  });

  it("tilts moved normals by the departure's gradient: upright on the formation, 1 : 1.5 on a straight bank, eased between", () => {
    const flatTerrain = makeTerrain(130, 70, () => 200);
    const flatShading = computeTerrainShading(flatTerrain);
    // A 6 m embankment: its slope runs straight from 5 m out (past the crest's round-off) to about 12 m (the toe's).
    const run = Array.from({ length: 20 }, (_, i) => earthworkPiece(flatTerrain, inputOf({ kind: "straight", from: { q: 20 + i, r: 30, zMm: 26_000 }, heading: 0, z1Mm: 26_000 } as PieceSpec)));
    const m = buildEarthworkChunk(passFor(flatTerrain, 0, 0, 0, run), flatShading);
    const y0 = 30 * 2.5 * Math.sqrt(3);
    const bank = (Math.atan(1 / SIDE_SLOPE_RUN) * 180) / Math.PI;
    let bed = 0;
    let slope = 0;
    const eased: [number, number][] = [];
    for (let i = 0; i < m.positions.length / 3; i++) {
      const s = worldToSim(vertex(m, i));
      // The run spans x = 5 · (20 + 30/2) = 175 m to 275 m; stay 30 m clear of its ends. Skip the plain chunk's
      // vertices the refined triangles no longer use (they stay in the arrays at the natural height).
      if (s.x < 205 || s.x > 245 || s.z < 20.2) continue;
      const d = Math.abs(s.y - y0);
      const n = new Vector3(m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]);
      const tilt = (Math.acos(n.y) * 180) / Math.PI;
      if (d < FORMATION_HALF_WIDTH_M - 1.3) {
        bed += 1;
        expect(tilt).toBeLessThan(0.01);
      } else if (d > FORMATION_HALF_WIDTH_M + CREST_ROUND_M + 1.3 && d < 10.8) {
        slope += 1;
        expect(tilt).toBeCloseTo(bank, 1);
        // Facing away from the track.
        expect(Math.sign(-n.z)).toBe(Math.sign(s.y - y0));
      } else if (d > FORMATION_HALF_WIDTH_M && d < FORMATION_HALF_WIDTH_M + CREST_ROUND_M) eased.push([d, tilt]);
    }
    expect(bed).toBeGreaterThan(20);
    expect(slope).toBeGreaterThan(20);
    // Across the crest's round-off the tilt grows with the distance and stays between flat and the bank.
    eased.sort((a, b) => a[0] - b[0]);
    expect(eased.length).toBeGreaterThan(10);
    for (const [, tilt] of eased) expect(tilt).toBeLessThanOrEqual(bank + 0.5);
    expect(eased[eased.length - 1]![1]).toBeGreaterThan(eased[0]![1]);
  });

  it("meets its neighbour along chunk seams", () => {
    // A synthetic ridge across the seam between chunks (0, 0) and (1, 0) at LOD0 (column 64), cut by a run along row 30.
    const ridge = makeTerrain(130, 70, (_q, _r, col) => 200 + Math.max(0, 60 - Math.abs(col - 64) * 4));
    const ridgeShading = computeTerrainShading(ridge);
    const run = Array.from({ length: 30 }, (_, i) => earthworkPiece(ridge, inputOf({ kind: "straight", from: { q: 35 + i, r: 30, zMm: 20_000 }, heading: 0, z1Mm: 20_000 } as PieceSpec)));
    const west = buildEarthworkChunk(passFor(ridge, 0, 0, 0, run), ridgeShading);
    const east = buildEarthworkChunk(passFor(ridge, 0, 1, 0, run), ridgeShading);
    expect(west.earthwork.some((w) => w > 0) && east.earthwork.some((w) => w > 0)).toBe(true);
    // Every seam vertex of one chunk (plan x on the seam's zigzag, found by lattice column 64) exists in the other.
    const seam = (m: MeshData) => {
      const out = new Set<string>();
      for (let i = 0; i < m.positions.length / 3; i++) {
        const s = worldToSim(vertex(m, i));
        const row = s.y / (2.5 * Math.sqrt(3));
        const col = s.x / 5 - (Math.round(row) & 1) / 2;
        // Refined seam vertices lie on the seam's lattice edges: between columns 64 of adjacent rows.
        const onSeamNode = Math.abs(col - 64) < 1e-6 && Math.abs(row - Math.round(row)) < 1e-6;
        const r0 = Math.floor(row + 1e-9);
        const f = row - r0;
        const x0 = 5 * (64 + (r0 & 1) / 2);
        const x1 = 5 * (64 + ((r0 + 1) & 1) / 2);
        const onSeamEdge = f > 1e-6 && f < 1 - 1e-6 && Math.abs(s.x - (x0 + (x1 - x0) * f)) < 1e-6;
        if (onSeamNode || onSeamEdge) out.add(`${s.x.toFixed(4)},${s.y.toFixed(4)},${s.z.toFixed(4)}`);
      }
      return out;
    };
    const a = seam(west);
    const b = seam(east);
    expect(a.size).toBeGreaterThan(40);
    expect([...a].filter((v) => !b.has(v))).toEqual([]);
    expect([...b].filter((v) => !a.has(v))).toEqual([]);
  });
});
