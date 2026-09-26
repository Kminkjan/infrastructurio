import { describe, expect, it } from "vitest";
import { Raycaster, Vector2, Vector3 } from "three";
import { IsoCamera, ROTATE_DURATION_MS } from "./IsoCamera";
import { cameraOffset, yawForStep } from "./isoMath";

describe("iso camera", () => {
  it("places the three camera at target + offset with the ppm frustum", () => {
    const cam = new IsoCamera({ target: { x: 100, z: -50 }, ppm: 6 });
    cam.setViewport(1200, 600);
    expect(cam.update(0)).toBe(false);
    const o = cameraOffset(0);
    expect(cam.camera.position.distanceTo(new Vector3(100 + o.x, o.y, -50 + o.z))).toBeLessThan(1e-9);
    expect(cam.camera.right).toBe(100);
    expect(cam.camera.top).toBe(50);
  });

  it("eases a Q/E step over 300 ms and lands exactly on k·60°", () => {
    const cam = new IsoCamera({ target: { x: 0, z: 0 }, ppm: 6, yawStep: 5 });
    cam.rotate(1);
    expect(cam.yawStep).toBe(0);
    expect(cam.update(1000)).toBe(true);
    expect(cam.yaw).toBeCloseTo(yawForStep(5), 12);
    expect(cam.update(1000 + ROTATE_DURATION_MS / 2)).toBe(true);
    expect(cam.yaw).toBeCloseTo(yawForStep(5) + Math.PI / 6, 12);
    expect(cam.update(1000 + ROTATE_DURATION_MS)).toBe(false);
    expect(cam.yaw).toBe(0);
  });

  it("continues toward the newest step when pressed again mid-ease", () => {
    const cam = new IsoCamera({ target: { x: 0, z: 0 }, ppm: 6 });
    cam.rotate(-1);
    cam.update(0);
    cam.update(100);
    const mid = cam.yaw;
    cam.rotate(-1);
    cam.update(200);
    expect(cam.yaw).toBeCloseTo(mid, 12);
    cam.update(200 + ROTATE_DURATION_MS);
    expect(cam.yawStep).toBe(4);
    expect(cam.yaw).toBeCloseTo(yawForStep(4), 12);
  });

  it("rotates instantly under reduced motion", () => {
    const cam = new IsoCamera({ target: { x: 0, z: 0 }, ppm: 6, reducedMotion: () => true });
    cam.rotate(1);
    expect(cam.rotating).toBe(false);
    expect(cam.yaw).toBeCloseTo(yawForStep(1), 12);
    expect(cam.update(0)).toBe(false);
  });

  it("casts the same ray as three's orthographic raycaster", () => {
    const cam = new IsoCamera({ target: { x: 400, z: -300 }, ppm: 2.5, yawStep: 3 });
    cam.setViewport(1000, 800);
    cam.update(0);
    const raycaster = new Raycaster();
    for (const [x, y] of [[0, 0], [500, 400], [1000, 800], [123, 654]] as const) {
      const ours = cam.screenToGroundRay(x, y);
      raycaster.setFromCamera(new Vector2((x / 1000) * 2 - 1, 1 - (y / 800) * 2), cam.camera);
      const theirs = raycaster.ray;
      expect(ours.direction.distanceTo(theirs.direction)).toBeLessThan(1e-9);
      // Same line: the origins differ only along the direction.
      const offset = new Vector3().subVectors(theirs.origin, ours.origin);
      expect(offset.clone().cross(ours.direction).length()).toBeLessThan(1e-6);
    }
  });
});
