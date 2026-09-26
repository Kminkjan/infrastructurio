import { describe, expect, it } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { simToWorld } from "../coords";
import {
  CAMERA_DISTANCE_M,
  CAMERA_FAR,
  CAMERA_NEAR,
  ISO_PITCH_RAD,
  type IsoView,
  NAMED_ZOOMS,
  PPM_MAX,
  PPM_MIN,
  cameraBasis,
  cameraOffset,
  clampPpm,
  clampTarget,
  easeInOutCubic,
  frustumFor,
  lodBandForPpm,
  minLatticeLineSpacingPx,
  nextNamedZoom,
  normalizeYawStep,
  panByScreen,
  screenRay,
  screenToWorldAtHeight,
  worldToScreen,
  yawForStep,
  zoomAboutPoint,
} from "./isoMath";

const YAWS = [0, 1, 2, 3, 4, 5].map(yawForStep);
const ZOOMS = Object.values(NAMED_ZOOMS);
const VIEWPORTS: readonly [number, number][] = [
  [1280, 720],
  [390, 844],
  [2560, 1440],
];

function view(yaw: number, ppm: number, [cssWidth, cssHeight]: readonly [number, number], target = { x: 812.5, z: -640.25 }): IsoView {
  return { target, ppm, yaw, pitch: ISO_PITCH_RAD, cssWidth, cssHeight };
}

/** A three camera set up exactly as IsoCamera does, for cross-checking the pure maths. */
function threeCamera(v: IsoView): OrthographicCamera {
  const f = frustumFor(v.cssWidth, v.cssHeight, v.ppm);
  const camera = new OrthographicCamera(f.left, f.right, f.top, f.bottom, CAMERA_NEAR, CAMERA_FAR);
  const offset = cameraOffset(v.yaw, v.pitch);
  camera.position.set(v.target.x + offset.x, offset.y, v.target.z + offset.z);
  camera.lookAt(v.target.x, 0, v.target.z);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

/** NDC → CSS px, y down. */
function ndcToCss(p: Vector3, v: IsoView): { x: number; y: number } {
  return { x: ((p.x + 1) / 2) * v.cssWidth, y: ((1 - p.y) / 2) * v.cssHeight };
}

/** Deterministic pseudo-random sequence in [0, 1) for sampling (no Math.random in tests). */
function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("iso camera constants and steps", () => {
  it("holds true isometric pitch in one constant", () => {
    expect((ISO_PITCH_RAD * 180) / Math.PI).toBeCloseTo(35.264, 3);
  });

  it("normalizes yaw steps to 0..5 and maps them to k·60°", () => {
    expect(normalizeYawStep(-1)).toBe(5);
    expect(normalizeYawStep(6)).toBe(0);
    expect(normalizeYawStep(13)).toBe(1);
    expect(yawForStep(2)).toBeCloseTo((2 * Math.PI) / 3, 12);
    expect(yawForStep(-2)).toBeCloseTo((4 * Math.PI) / 3, 12);
    expect(() => normalizeYawStep(0.5)).toThrow(RangeError);
  });

  it("places the camera at target + D·(sin(yaw)cos p, sin p, cos(yaw)cos p)", () => {
    const o = cameraOffset(0);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(CAMERA_DISTANCE_M * Math.sin(ISO_PITCH_RAD), 9);
    expect(o.z).toBeCloseTo(CAMERA_DISTANCE_M * Math.cos(ISO_PITCH_RAD), 9);
    for (const yaw of YAWS) {
      const p = cameraOffset(yaw);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(CAMERA_DISTANCE_M, 9);
      expect(p.x).toBeCloseTo(CAMERA_DISTANCE_M * Math.sin(yaw) * Math.cos(ISO_PITCH_RAD), 9);
    }
  });

  it("builds the frustum from halfW = cssW/(2·ppm)", () => {
    expect(frustumFor(1200, 800, 6)).toEqual({ left: -100, right: 100, top: 800 / 12, bottom: -800 / 12 });
  });

  it("clamps zoom to 0.75–24 ppm and rejects NaN", () => {
    expect(clampPpm(0.1)).toBe(PPM_MIN);
    expect(clampPpm(99)).toBe(PPM_MAX);
    expect(clampPpm(6)).toBe(6);
    expect(() => clampPpm(Number.NaN)).toThrow(RangeError);
  });

  it("steps through the named zoom levels and stops at the ends", () => {
    expect(nextNamedZoom(6, 1)).toBe(12);
    expect(nextNamedZoom(6, -1)).toBe(2.5);
    expect(nextNamedZoom(7, -1)).toBe(6);
    expect(nextNamedZoom(7, 1)).toBe(12);
    expect(nextNamedZoom(0.75, 1)).toBe(0.9);
    expect(nextNamedZoom(22, 1)).toBe(22);
    expect(nextNamedZoom(23, 1)).toBe(23);
    expect(nextNamedZoom(0.9, -1)).toBe(0.9);
    expect(nextNamedZoom(6 * (1 + 1e-9), 1)).toBe(12);
  });

  it("splits LOD bands at 2 and 5 ppm", () => {
    expect(lodBandForPpm(0.9)).toBe("far");
    expect(lodBandForPpm(1.999)).toBe("far");
    expect(lodBandForPpm(2)).toBe("mid");
    expect(lodBandForPpm(5)).toBe("mid");
    expect(lodBandForPpm(5.001)).toBe("near");
  });

  it("clamps the target to the map plus a 100 m margin", () => {
    const bounds = { minX: 0, maxX: 2000, minZ: -1500, maxZ: 0 };
    expect(clampTarget({ x: -500, z: 300 }, bounds)).toEqual({ x: -100, z: 100 });
    expect(clampTarget({ x: 2500, z: -2000 }, bounds)).toEqual({ x: 2100, z: -1600 });
    expect(clampTarget({ x: 10, z: -10 }, bounds, 0)).toEqual({ x: 10, z: -10 });
  });

  it("eases the rotation symmetrically from 0 to 1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 12);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe("iso projection", () => {
  it("matches three's lookAt basis for every yaw", () => {
    for (const yaw of YAWS) {
      const camera = threeCamera(view(yaw, 6, [800, 600]));
      const x = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const y = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const z = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
      const b = cameraBasis(yaw);
      expect(x.distanceTo(new Vector3(b.right.x, b.right.y, b.right.z))).toBeLessThan(1e-12);
      expect(y.distanceTo(new Vector3(b.up.x, b.up.y, b.up.z))).toBeLessThan(1e-12);
      expect(z.distanceTo(new Vector3(b.back.x, b.back.y, b.back.z))).toBeLessThan(1e-12);
    }
  });

  it("agrees with three's projection to well under a pixel", () => {
    const next = sequence(7);
    for (const yaw of YAWS) {
      for (const ppm of ZOOMS) {
        for (const vp of VIEWPORTS) {
          const v = view(yaw, ppm, vp);
          const camera = threeCamera(v);
          for (let i = 0; i < 5; i++) {
            const p = { x: v.target.x + (next() - 0.5) * 200, y: next() * 40, z: v.target.z + (next() - 0.5) * 200 };
            const ours = worldToScreen(v, p);
            const theirs = ndcToCss(new Vector3(p.x, p.y, p.z).project(camera), v);
            expect(Math.abs(ours.x - theirs.x)).toBeLessThan(1e-6);
            expect(Math.abs(ours.y - theirs.y)).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it("round-trips world → screen → world to under 1e-6 m across 6 yaws × 5 zooms × 3 viewports", () => {
    const next = sequence(11);
    let worst = 0;
    for (const yaw of YAWS) {
      for (const ppm of ZOOMS) {
        for (const vp of VIEWPORTS) {
          const v = view(yaw, ppm, vp);
          for (let i = 0; i < 8; i++) {
            const p = { x: v.target.x + (next() - 0.5) * 300, y: next() * 40, z: v.target.z + (next() - 0.5) * 300 };
            const s = worldToScreen(v, p);
            const back = screenToWorldAtHeight(v, s.x, s.y, p.y);
            worst = Math.max(worst, Math.hypot(back.x - p.x, back.y - p.y, back.z - p.z));
          }
        }
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("shows ppm CSS px per metre to within 0.5% through the three camera", () => {
    for (const yaw of YAWS) {
      for (const ppm of ZOOMS) {
        for (const vp of VIEWPORTS) {
          const v = view(yaw, ppm, vp);
          const camera = threeCamera(v);
          const r = cameraBasis(yaw).right;
          const a = ndcToCss(new Vector3(v.target.x, 0, v.target.z).project(camera), v);
          const b = ndcToCss(new Vector3(v.target.x + 10 * r.x, 0, v.target.z + 10 * r.z).project(camera), v);
          const measured = Math.hypot(b.x - a.x, b.y - a.y) / 10;
          expect(Math.abs(measured - ppm) / ppm).toBeLessThan(0.005);
        }
      }
    }
  });

  it("casts screen rays along the view direction from the camera plane", () => {
    const v = view(yawForStep(1), 6, [1280, 720]);
    const { origin, direction } = screenRay(v, 640, 360);
    const offset = cameraOffset(v.yaw);
    expect(origin.x).toBeCloseTo(v.target.x + offset.x, 9);
    expect(origin.y).toBeCloseTo(offset.y, 9);
    expect(origin.z).toBeCloseTo(v.target.z + offset.z, 9);
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 12);
    const centre = screenToWorldAtHeight(v, 640, 360, 0);
    expect(centre.x).toBeCloseTo(v.target.x, 9);
    expect(centre.z).toBeCloseTo(v.target.z, 9);
  });

  it("keeps the (origin, east, north) triangle counter-clockwise on screen for all 6 yaws (winding oracle)", () => {
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const v = view(yawForStep(k), 6, [1280, 720], { x: 0, z: 0 });
      const camera = threeCamera(v);
      const o = simToWorld(0, 0, 0).project(camera);
      const e = simToWorld(10, 0, 0).project(camera);
      const n = simToWorld(0, 10, 0).project(camera);
      // NDC is y-up, so a positive cross product is counter-clockwise.
      const cross = (e.x - o.x) * (n.y - o.y) - (e.y - o.y) * (n.x - o.x);
      expect(cross).toBeGreaterThan(0);
    }
  });

  it("shows heading-0 (east) lines horizontal at yaw step 0, looking north", () => {
    const v = view(yawForStep(0), 6, [1280, 720], { x: 0, z: 0 });
    const camera = threeCamera(v);
    const a = simToWorld(-50, 20, 0).project(camera);
    const b = simToWorld(50, 20, 0).project(camera);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1e-12);
    expect(b.x).toBeGreaterThan(a.x);
    const north = simToWorld(0, 50, 0).project(camera);
    expect(north.y).toBeGreaterThan(0);
  });
});

describe("zoom and pan", () => {
  it("keeps the point under the cursor within 0.5 px while zooming", () => {
    const next = sequence(23);
    let worst = 0;
    for (const yaw of YAWS) {
      for (const ppm of ZOOMS) {
        for (const vp of VIEWPORTS) {
          const v = view(yaw, ppm, vp);
          for (let i = 0; i < 4; i++) {
            const cursor = { x: next() * vp[0], y: next() * vp[1] };
            // Anchor at a terrain-like height: any point on the cursor ray must stay put.
            const anchor = screenToWorldAtHeight(v, cursor.x, cursor.y, next() * 40);
            const factor = next() < 0.5 ? 1.15 : 1 / 1.15;
            const zoomed = zoomAboutPoint(v, anchor, ppm * factor, yaw);
            const after = worldToScreen({ ...v, target: zoomed.target, ppm: zoomed.ppm }, anchor);
            worst = Math.max(worst, Math.hypot(after.x - cursor.x, after.y - cursor.y));
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.5);
    expect(worst).toBeLessThan(1e-6);
  });

  it("clamps the zoom inside zoomAboutPoint and keeps the anchor fixed at the clamp", () => {
    const v = view(yawForStep(2), 20, [1280, 720]);
    const anchor = screenToWorldAtHeight(v, 100, 600, 0);
    const zoomed = zoomAboutPoint(v, anchor, 100, v.yaw);
    expect(zoomed.ppm).toBe(PPM_MAX);
    const after = worldToScreen({ ...v, target: zoomed.target, ppm: zoomed.ppm }, anchor);
    expect(after.x).toBeCloseTo(100, 6);
    expect(after.y).toBeCloseTo(600, 6);
  });

  it("drags the ground point under the pointer along with it", () => {
    const next = sequence(31);
    for (const yaw of YAWS) {
      const v = view(yaw, 6, [1280, 720]);
      const start = { x: 300 + next() * 600, y: 200 + next() * 300 };
      const grabbed = screenToWorldAtHeight(v, start.x, start.y, 0);
      const dx = (next() - 0.5) * 400;
      const dy = (next() - 0.5) * 400;
      const target = panByScreen(v.target, dx, dy, v.ppm, yaw);
      const after = worldToScreen({ ...v, target }, grabbed);
      expect(after.x).toBeCloseTo(start.x + dx, 6);
      expect(after.y).toBeCloseTo(start.y + dy, 6);
    }
  });

  it("measures the lattice's tightest line spacing as 2.5 m·ppm at every rest yaw", () => {
    for (const yaw of YAWS) {
      expect(minLatticeLineSpacingPx(yaw, ISO_PITCH_RAD, 1)).toBeCloseTo(2.5, 9);
      expect(minLatticeLineSpacingPx(yaw, ISO_PITCH_RAD, 6)).toBeCloseTo(15, 9);
    }
    // Mid-rotation no family is screen-horizontal, so the tightest spacing is wider.
    expect(minLatticeLineSpacingPx(Math.PI / 6, ISO_PITCH_RAD, 1)).toBeGreaterThan(2.5);
  });
});
