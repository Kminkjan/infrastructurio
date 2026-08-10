// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  fitCamera,
  panCamera,
  resizeCamera,
  zoomCamera,
  type ViewportSize,
} from "./map-camera";

const bounds = { width: 960, height: 620 };
const viewport: ViewportSize = { width: 1200, height: 800 };

describe("map camera", () => {
  it("fits and centers the complete map in the viewport", () => {
    const camera = fitCamera(bounds, viewport);

    expect(camera.scale).toBeCloseTo(71 / 60);
    expect(camera.x).toBeCloseTo(32);
    expect(camera.y).toBeCloseTo(199 / 6);
  });

  it("keeps a zoomed map within its pan bounds", () => {
    const fitted = fitCamera(bounds, viewport);
    const zoomed = zoomCamera(
      fitted,
      2,
      { x: viewport.width / 2, y: viewport.height / 2 },
      bounds,
      viewport,
    );

    expect(panCamera(zoomed, { x: 10_000, y: 10_000 }, bounds, viewport)).toEqual(
      { x: 0, y: 0, scale: zoomed.scale },
    );
    expect(
      panCamera(zoomed, { x: -10_000, y: -10_000 }, bounds, viewport),
    ).toEqual({
      x: viewport.width - bounds.width * zoomed.scale,
      y: viewport.height - bounds.height * zoomed.scale,
      scale: zoomed.scale,
    });
  });

  it("zooms around the pointer and enforces deterministic zoom limits", () => {
    const fitted = fitCamera(bounds, viewport);
    const anchor = { x: 600, y: 400 };
    const worldPointBefore = {
      x: (anchor.x - fitted.x) / fitted.scale,
      y: (anchor.y - fitted.y) / fitted.scale,
    };
    const zoomed = zoomCamera(fitted, 2, anchor, bounds, viewport);
    const worldPointAfter = {
      x: (anchor.x - zoomed.x) / zoomed.scale,
      y: (anchor.y - zoomed.y) / zoomed.scale,
    };

    expect(worldPointAfter.x).toBeCloseTo(worldPointBefore.x);
    expect(worldPointAfter.y).toBeCloseTo(worldPointBefore.y);
    expect(zoomCamera(zoomed, 0, anchor, bounds, viewport)).toBe(zoomed);
    expect(zoomCamera(fitted, 100, anchor, bounds, viewport).scale).toBeCloseTo(
      fitted.scale * 8,
    );
    expect(zoomCamera(zoomed, 0.0001, anchor, bounds, viewport)).toEqual(
      fitted,
    );
  });

  it("preserves the viewed world center when the viewport changes", () => {
    const fitted = fitCamera(bounds, viewport);
    const camera = panCamera(
      zoomCamera(fitted, 3, { x: 600, y: 400 }, bounds, viewport),
      { x: -120, y: -80 },
      bounds,
      viewport,
    );
    const nextViewport = { width: 900, height: 600 };
    const resized = resizeCamera(camera, bounds, viewport, nextViewport);

    expect((nextViewport.width / 2 - resized.x) / resized.scale).toBeCloseTo(
      (viewport.width / 2 - camera.x) / camera.scale,
    );
    expect((nextViewport.height / 2 - resized.y) / resized.scale).toBeCloseTo(
      (viewport.height / 2 - camera.y) / camera.scale,
    );
  });

  it("updates in constant-sized camera state across an M0-scale input burst", () => {
    let camera = fitCamera(bounds, viewport);

    for (let index = 0; index < 10_000; index += 1) {
      camera = panCamera(camera, { x: index % 3, y: -(index % 2) }, bounds, viewport);
      camera = zoomCamera(camera, index % 2 === 0 ? 1.001 : 0.999, { x: 600, y: 400 }, bounds, viewport);
    }

    expect(Object.keys(camera)).toEqual(["x", "y", "scale"]);
    expect(Object.values(camera).every(Number.isFinite)).toBe(true);
  });
});
