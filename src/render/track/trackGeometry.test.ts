import { describe, expect, it } from "vitest";
import { MeshLambertMaterial, ShaderLib } from "three";
import { type PieceSpec, resolvePiece } from "../../core/sim/api";
import { createArtUniforms, createTrackMaterials } from "../art/materials";
import type { ShaderSource } from "../art/shaderChunks/chunk";
import { PICK_LIFT_M } from "../picking/trackPicker";
import { RIBBON_LIFT_M } from "./ghostGeometry";
import { RING_LIFT_M } from "./SnapRing";
import {
  BALLAST_BASE_HALF_M,
  BALLAST_DEPTH_M,
  RAIL_HEIGHT_M,
  RAIL_OFFSET_M,
  RAIL_WIDTH_M,
  SLEEPER_HEIGHT_M,
  SLEEPER_LENGTH_M,
  SLEEPER_WIDTH_M,
  TRACK_LIFT_M,
  TRACK_RAIL_TOP_M,
  type TrackCentreline,
  type TrackMeshData,
  buildTrackMeshes,
  sampleCentreline,
  sleeperStations,
  trackSagittaM,
} from "./trackGeometry";
import { TRACK_FAR_LOD_BELOW_PPM, trackLodForPpm } from "./trackLod";
import { mergeChunk } from "./TrackBatch";

function centreline(spec: PieceSpec): TrackCentreline {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(res.failure.message);
  return { prims: res.piece.prims, z0M: res.piece.ends[0].node.zMm / 1000, z1M: res.piece.ends[1].node.zMm / 1000 };
}

const STRAIGHT = centreline({ kind: "straight", from: { q: 0, r: 0, zMm: 2000 }, heading: 0, z1Mm: 2000 });
const CURVE_60 = centreline({ kind: "curve", from: { q: 0, r: 0, zMm: 0 }, heading: 0, turn: 3, radiusM: 60, variant: 0, z1Mm: 0 });
const CURVE_360 = centreline({ kind: "curve", from: { q: 0, r: 0, zMm: 0 }, heading: 0, turn: 1, radiusM: 360, variant: 0, z1Mm: 0 });
const SHIFT = centreline({ kind: "shift", from: { q: 0, r: 0, zMm: 0 }, heading: 0, side: "left", z1Mm: 0 });

function vertex(d: TrackMeshData, i: number): [number, number, number] {
  return [d.positions[i * 3] ?? 0, d.positions[i * 3 + 1] ?? 0, d.positions[i * 3 + 2] ?? 0];
}

function normal(d: TrackMeshData, i: number): [number, number, number] {
  return [d.normals[i * 3] ?? 0, d.normals[i * 3 + 1] ?? 0, d.normals[i * 3 + 2] ?? 0];
}

/** Every triangle's winding (b − a) × (c − a) agrees with its vertices' normals (FrontSide only). */
function expectWindingMatchesNormals(d: TrackMeshData): void {
  for (let t = 0; t < d.indexCount; t += 3) {
    const [ia, ib, ic] = [d.indices[t] ?? 0, d.indices[t + 1] ?? 0, d.indices[t + 2] ?? 0];
    const a = vertex(d, ia);
    const b = vertex(d, ib);
    const c = vertex(d, ic);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      (e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0),
      (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0),
      (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0),
    ];
    const n = [ia, ib, ic].map((i) => normal(d, i)).reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
    const dot = (cross[0] ?? 0) * (n[0] ?? 0) + (cross[1] ?? 0) * (n[1] ?? 0) + (cross[2] ?? 0) * (n[2] ?? 0);
    if (!(dot > 0)) expect.fail(`triangle ${t / 3} winds against its normal (dot ${dot})`);
  }
}

describe("track arc sampling", () => {
  it("bounds each chord by min(2·acos(1 − 0.02/r), 5°)", () => {
    for (const c of [CURVE_60, CURVE_360, SHIFT]) {
      const arc = c.prims.find((p) => p.kind === "arc");
      if (!arc || arc.kind !== "arc") throw new Error("no arc");
      const limit = Math.min(2 * Math.acos(1 - 0.02 / arc.radiusM), (5 * Math.PI) / 180);
      const frames = sampleCentreline(c);
      let arcChords = 0;
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1];
        const b = frames[i];
        if (!a || !b) continue;
        const turned = Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty));
        if (turned > 1e-9) arcChords += 1;
        expect(turned).toBeLessThanOrEqual(limit + 1e-9);
      }
      expect(arcChords).toBeGreaterThan(0);
    }
    // R 60: the chord term governs, about 3.0° (art direction "Track").
    expect(2 * Math.acos(1 - trackSagittaM(CURVE_60.prims) / 60) * (180 / Math.PI)).toBeCloseTo(2.959, 2);
    expect(trackSagittaM(STRAIGHT.prims)).toBe(0.02);
  });

  it("gives exact lattice tangents at both ends and heights linear in arc length", () => {
    const frames = sampleCentreline(CURVE_60);
    const first = frames[0];
    const last = frames[frames.length - 1];
    expect(first?.tx).toBeCloseTo(1, 12);
    expect(first?.ty).toBeCloseTo(0, 12);
    // A 90° left turn ends heading north.
    expect(last?.tx).toBeCloseTo(0, 12);
    expect(last?.ty).toBeCloseTo(1, 12);
    const sloped = sampleCentreline({ ...STRAIGHT, z0M: 0, z1M: 1 });
    expect(sloped.map((f) => f.z)).toEqual([0, 1]);
  });
});

describe("track meshes", () => {
  it("builds the ballast trapezoid 4.4 m at the base, 0.35 m deep, marked for the stripe on its centre band", () => {
    const { ballast } = buildTrackMeshes(STRAIGHT);
    let minY = Infinity;
    let maxY = -Infinity;
    let maxAcross = 0;
    for (let i = 0; i < ballast.vertexCount; i++) {
      const [, y, z] = vertex(ballast, i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      // The straight runs east (world x); across is world z (−north).
      maxAcross = Math.max(maxAcross, Math.abs(z));
    }
    expect(maxAcross).toBeCloseTo(BALLAST_BASE_HALF_M, 5);
    expect(minY).toBeCloseTo(2 - BALLAST_DEPTH_M + TRACK_LIFT_M, 6);
    expect(maxY).toBeCloseTo(2 + TRACK_LIFT_M, 6);
    const striped = [...(ballast.stripe ?? [])].filter((v) => v === 1).length;
    expect(striped).toBe(4);
    expectWindingMatchesNormals(ballast);
  });

  it("stacks the render-only lifts: ballast top, pick aim, rail tops, ghost ribbon, snap ring", () => {
    // The lift keeps the ballast's shoulders in flat ground it lies on (no visible gap under them) …
    expect(TRACK_LIFT_M).toBeLessThan(BALLAST_DEPTH_M);
    // … and everything aimed or drawn over the track follows it, so picks land on the drawn rails and the
    // overlays stay above them.
    expect(TRACK_RAIL_TOP_M).toBeCloseTo(TRACK_LIFT_M + SLEEPER_HEIGHT_M + RAIL_HEIGHT_M, 12);
    const stack = [TRACK_LIFT_M, PICK_LIFT_M, TRACK_RAIL_TOP_M, RIBBON_LIFT_M, RING_LIFT_M];
    for (let i = 1; i < stack.length; i++) expect(stack[i], `lift ${i}`).toBeGreaterThan(stack[i - 1] ?? Infinity);
    expect(stack.map((v) => Math.round(v * 100) / 100)).toEqual([0.15, 0.4, 0.45, 0.5, 0.6]);
  });

  it("places 2.6 × 0.14 × 0.24 m sleepers about every 0.9 m", () => {
    expect(sleeperStations(5)).toHaveLength(6);
    expect(sleeperStations(8.66)).toHaveLength(10);
    expect(sleeperStations(0.2)).toHaveLength(1);
    const { sleepers } = buildTrackMeshes(STRAIGHT);
    expect(sleepers.vertexCount).toBe(6 * 20);
    // The first sleeper's box (float32 positions: 5 decimals).
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 20; i++) {
      const [x, y, z] = vertex(sleepers, i);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    expect(maxX - minX).toBeCloseTo(SLEEPER_WIDTH_M, 5);
    expect(maxZ - minZ).toBeCloseTo(SLEEPER_LENGTH_M, 5);
    expect(maxY - minY).toBeCloseTo(SLEEPER_HEIGHT_M, 5);
    expectWindingMatchesNormals(sleepers);
    // Every face points out of its box.
    for (let box = 0; box < 6; box++) {
      const centre = [0, 0, 0];
      for (let i = 0; i < 20; i++) vertex(sleepers, box * 20 + i).forEach((v, k) => (centre[k] = (centre[k] ?? 0) + v / 20));
      for (let i = 0; i < 20; i++) {
        const p = vertex(sleepers, box * 20 + i);
        const n = normal(sleepers, box * 20 + i);
        const out = (p[0] - (centre[0] ?? 0)) * n[0] + (p[1] - (centre[1] ?? 0)) * n[1] + (p[2] - (centre[2] ?? 0)) * n[2];
        expect(out).toBeGreaterThan(0);
      }
    }
  });

  it("puts 0.11 × 0.16 m rails at ±0.817 m on the sleepers", () => {
    const { rails } = buildTrackMeshes(STRAIGHT);
    const across = new Set<string>();
    let maxY = -Infinity;
    for (let i = 0; i < rails.vertexCount; i++) {
      const [, y, z] = vertex(rails, i);
      across.add((-z).toFixed(4));
      maxY = Math.max(maxY, y);
    }
    const expected = [RAIL_OFFSET_M, -RAIL_OFFSET_M].flatMap((c) => [c + RAIL_WIDTH_M / 2, c - RAIL_WIDTH_M / 2]).map((u) => u.toFixed(4));
    expect([...across].sort()).toEqual(expected.sort());
    expect(maxY).toBeCloseTo(2 + TRACK_LIFT_M + SLEEPER_HEIGHT_M + RAIL_HEIGHT_M, 6);
    expectWindingMatchesNormals(rails);
  });

  it("winds curves and shifts to match their normals, and the ballast top faces up", () => {
    for (const c of [CURVE_60, CURVE_360, SHIFT]) {
      const m = buildTrackMeshes(c);
      expectWindingMatchesNormals(m.ballast);
      expectWindingMatchesNormals(m.sleepers);
      expectWindingMatchesNormals(m.rails);
      for (let i = 0; i < m.ballast.vertexCount; i++) expect(normal(m.ballast, i)[1]).toBeGreaterThan(0);
    }
  });

  it("merges pieces into one chunk geometry with offset indices (the multi-draw fallback)", () => {
    const a = buildTrackMeshes(STRAIGHT).ballast;
    const b = buildTrackMeshes(CURVE_60).ballast;
    const g = mergeChunk([a, b]);
    expect(g.getAttribute("position").count).toBe(a.vertexCount + b.vertexCount);
    expect(g.getAttribute("trackStripe").count).toBe(a.vertexCount + b.vertexCount);
    const index = g.getIndex();
    expect(index?.count).toBe(a.indexCount + b.indexCount);
    expect(index?.getX(a.indexCount)).toBe((b.indices[0] ?? 0) + a.vertexCount);
    g.dispose();
  });
});

describe("track LOD and materials", () => {
  it("switches to the far LOD below 4 ppm", () => {
    expect(TRACK_FAR_LOD_BELOW_PPM).toBe(4);
    expect(trackLodForPpm(3.99)).toBe("far");
    expect(trackLodForPpm(4)).toBe("near");
    expect(trackLodForPpm(0.75)).toBe("far");
    expect(trackLodForPpm(24)).toBe("near");
  });

  it("gives ballast the stripe, grain and edge fade, sleepers grain, rails only the edge fade", () => {
    const m = createTrackMaterials(createArtUniforms({ minX: 0, minZ: -100, maxX: 100, maxZ: 0 }));
    expect(m.ballast.customProgramCacheKey()).toBe("track-stripe-v1+grain-v1+edge-fade-v1");
    expect(m.sleepers.customProgramCacheKey()).toBe("grain-v1+edge-fade-v1");
    expect(m.rails.customProgramCacheKey()).toBe("edge-fade-v1");
    const shader: ShaderSource = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    m.ballast.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain("attribute float trackStripe;");
    expect(shader.fragmentShader).toContain("uTrackStripe * step( 0.5, vTrackStripe )");
    expect(m.all.every((x) => x instanceof MeshLambertMaterial && x.vertexColors)).toBe(true);
    m.dispose();
  });
});
