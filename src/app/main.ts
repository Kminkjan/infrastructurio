import { Color, Ray, Scene, Vector3 } from "three";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../core/terrain";
import { SceneLighting } from "../render/art/lighting";
import { palette } from "../render/art/palette";
import { CameraController } from "../render/camera/CameraController";
import { IsoCamera } from "../render/camera/IsoCamera";
import { NAMED_ZOOMS, minLatticeLineSpacingPx } from "../render/camera/isoMath";
import { FrameScheduler } from "../render/core/FrameScheduler";
import { PerfMonitor } from "../render/core/PerfMonitor";
import { RendererHost } from "../render/core/RendererHost";
import { TerrainView } from "../render/terrain/TerrainView";
import { raycastTerrain } from "../render/terrain/heightfieldRay";
import { LatticeOverlay } from "../render/terrain/latticeMaterial";
import { terrainLodForPpm } from "../render/terrain/terrainGeometry";

// Composition root for D1: seeded terrain under an isometric, render-on-demand
// camera. There is no sim loop yet, so nothing sets `sim-running` or `ambient`:
// with no input the page draws zero frames.

const TERRAIN_SEED = "baltic-diorama";

const canvas = document.querySelector<HTMLCanvasElement>("#world");
const viewport = document.querySelector<HTMLDivElement>("#viewport");
if (!canvas || !viewport) throw new Error("missing #world canvas or #viewport");

const listeners = new AbortController();
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = (): boolean => reducedMotionQuery.matches;

const terrain = generateTerrain({ seed: TERRAIN_SEED, ...DEFAULT_TERRAIN_SIZE });

const scheduler = new FrameScheduler({
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  now: () => performance.now(),
  isHidden: () => document.hidden,
});
document.addEventListener("visibilitychange", () => scheduler.handleVisibilityChange(), { signal: listeners.signal });

const scene = new Scene();
scene.background = new Color(palette.haze);
const lattice = new LatticeOverlay(reducedMotion);
const terrainView = new TerrainView(terrain, lattice.material, lattice.waterMaterial);
scene.add(terrainView.group);
const lighting = new SceneLighting(scene);

const box = terrainView.box;
const home = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
const camera = new IsoCamera({ target: home, ppm: NAMED_ZOOMS.default, yawStep: 0, reducedMotion });

// Created after the camera and the overlay: the host reports the first size synchronously.
const host = new RendererHost(canvas, viewport, (size) => {
  camera.setViewport(size.cssWidth, size.cssHeight);
  lattice.setPixelRatio(size.pixelRatio);
  scheduler.requestFrame("resize");
});
const controller = new CameraController({ canvas, camera, scheduler, bounds: box, home, reducedMotion });
const perf = new PerfMonitor(document.body, host.renderer);

// Debug lattice cursor (D1 only; D3 replaces the G key with tool activation):
// the reveal circle follows the terrain point under the pointer.
const pointer = { x: 0, y: 0, inside: false };
const pickRay = new Ray();
const pickPoint = new Vector3();

function updateLatticeCursor(): void {
  if (!lattice.buildMode || !pointer.inside) return;
  camera.screenToGroundRay(pointer.x, pointer.y, pickRay);
  if (raycastTerrain(terrain, pickRay.origin, pickRay.direction, pickPoint)) lattice.setCursor(pickPoint.x, pickPoint.z);
  else lattice.clearCursor();
}

canvas.addEventListener(
  "pointermove",
  (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.inside = true;
    if (lattice.buildMode) {
      updateLatticeCursor();
      scheduler.requestFrame("hover");
    }
  },
  { signal: listeners.signal },
);
canvas.addEventListener(
  "pointerleave",
  () => {
    pointer.inside = false;
    lattice.clearCursor();
    if (lattice.buildMode) scheduler.requestFrame("hover");
  },
  { signal: listeners.signal },
);
window.addEventListener(
  "keydown",
  (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyG") {
      lattice.toggleBuildMode();
      updateLatticeCursor();
      scheduler.requestFrame("overlay");
    } else if (e.code === "F3") {
      e.preventDefault();
      perf.toggle();
      scheduler.requestFrame("overlay");
    }
  },
  { signal: listeners.signal },
);

scheduler.onFrame((frame) => {
  controller.update(frame);
  // The camera may have moved under a still pointer: keep the reveal on the terrain under it.
  if (lattice.buildMode) updateLatticeCursor();
  if (lattice.update(frame.nowMs, minLatticeLineSpacingPx(camera.yaw, camera.pitch, camera.ppm))) {
    scheduler.requestFrame("overlay");
  }
  terrainView.setLod(terrainLodForPpm(camera.ppm));
  lighting.update(camera, box);
  // Resize the buffer in the frame that draws into it, so no blank canvas is painted.
  host.syncSize();
  host.renderer.render(scene, camera.camera);
  perf.sample(frame);
});
scheduler.requestFrame("init");

if (import.meta.env.DEV) {
  // Handle for agent checks in a dev browser (frame counts, camera state); absent from builds.
  Object.assign(window, { __diorama: { scheduler, camera, perf, terrain } });
}

import.meta.hot?.dispose(() => {
  listeners.abort();
  scheduler.dispose();
  controller.dispose();
  perf.dispose();
  lighting.dispose();
  terrainView.dispose();
  lattice.dispose();
  host.dispose();
});
