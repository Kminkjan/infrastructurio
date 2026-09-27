import { Color, Ray, Scene, Vector3 } from "three";
import { DIORAMA_SEED, generateDiorama } from "../core/scenarios/baltic-diorama";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../core/terrain";
import { AssetRegistry } from "../render/art/AssetRegistry";
import { TweakPanel } from "../render/art/TweakPanel";
import { SceneLighting } from "../render/art/lighting";
import { createArtUniforms, createWorldMaterials, setSwayEnabled, syncArtColors, terrainChunks, waterChunks } from "../render/art/materials";
import { palette } from "../render/art/palette";
import { Vignette } from "../render/art/vignette";
import { CameraController } from "../render/camera/CameraController";
import { IsoCamera } from "../render/camera/IsoCamera";
import { dioramaBookmarks, focusTarget, parseLookdevParams, showTweakPanel } from "../render/camera/bookmarks";
import { NAMED_ZOOMS, minLatticeLineSpacingPx } from "../render/camera/isoMath";
import { FrameScheduler } from "../render/core/FrameScheduler";
import { PerfMonitor } from "../render/core/PerfMonitor";
import { RendererHost } from "../render/core/RendererHost";
import { LabelLayer } from "../render/labels/LabelLayer";
import { dioramaLabels } from "../render/labels/placeLabels";
import { SceneryView, registerSceneryAssets } from "../render/scenery/SceneryView";
import { TerrainView } from "../render/terrain/TerrainView";
import { raycastTerrain } from "../render/terrain/heightfieldRay";
import { LatticeOverlay } from "../render/terrain/latticeMaterial";
import { terrainLodForPpm, terrainWorldBounds } from "../render/terrain/terrainGeometry";

// Composition root for the D11a lookdev spike: the seeded terrain and the
// static Baltic diorama (scenery kit, splat, labels) under the isometric,
// render-on-demand camera. There is no sim loop. Ambient animation (tree sway,
// windmill sails) keeps the `ambient` reason at 30 fps unless reduced motion
// is on, in which case an idle page draws zero frames.
// URL: ?bookmark=1..4 (Look Gate A views), ?pitch=30 (pitch A/B), ?tweak=1 or 0.

const canvas = document.querySelector<HTMLCanvasElement>("#world");
const viewport = document.querySelector<HTMLDivElement>("#viewport");
if (!canvas || !viewport) throw new Error("missing #world canvas or #viewport");

const params = parseLookdevParams(window.location.search);
const listeners = new AbortController();
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = (): boolean => reducedMotionQuery.matches;

const terrain = generateTerrain({ seed: DIORAMA_SEED, ...DEFAULT_TERRAIN_SIZE });
const scenery = generateDiorama(terrain, DIORAMA_SEED);

const scheduler = new FrameScheduler({
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  now: () => performance.now(),
  isHidden: () => document.hidden,
});
document.addEventListener("visibilitychange", () => scheduler.handleVisibilityChange(), { signal: listeners.signal });

const scene = new Scene();
scene.background = new Color(palette.haze);
const uniforms = createArtUniforms(terrainWorldBounds(terrain));
const materials = createWorldMaterials(uniforms);
const lattice = new LatticeOverlay(reducedMotion, { terrain: terrainChunks(uniforms), water: waterChunks(uniforms) });
let registry = new AssetRegistry();
registerSceneryAssets(registry);
let terrainView = new TerrainView(terrain, lattice.material, lattice.waterMaterial);
let sceneryView = new SceneryView(scenery, terrain, registry, materials, uniforms);
scene.add(terrainView.group, sceneryView.group);
const lighting = new SceneLighting(scene);

const box = terrainView.box;
const home = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
const bookmarks = dioramaBookmarks(scenery, terrain, params.pitch);
const start = params.bookmark === undefined ? undefined : bookmarks[params.bookmark - 1];
const camera = new IsoCamera({
  target: start?.target ?? home,
  ppm: start?.ppm ?? NAMED_ZOOMS.default,
  yawStep: start?.yawStep ?? 0,
  pitch: params.pitch,
  reducedMotion,
});

const vignette = new Vignette(viewport);
const labels = new LabelLayer(viewport, dioramaLabels(scenery, terrain), () => scheduler.requestFrame("overlay"));

// Created after the camera and the overlays: the host reports the first size synchronously.
const host = new RendererHost(canvas, viewport, (size) => {
  camera.setViewport(size.cssWidth, size.cssHeight);
  lattice.setPixelRatio(size.pixelRatio);
  labels.setSize(size.cssWidth, size.cssHeight);
  scheduler.requestFrame("resize");
});
const controller = new CameraController({ canvas, camera, scheduler, bounds: box, home, reducedMotion });
const perf = new PerfMonitor(document.body, host.renderer);

// Ambient animation: sway and sails advance only while the `ambient` reason
// runs, which reduced motion switches off (and the sway with it).
let ambientTimeS = 0;
function syncAmbient(): void {
  setSwayEnabled(uniforms, !reducedMotion());
  scheduler.setContinuous("ambient", !reducedMotion() && sceneryView.animated);
}
reducedMotionQuery.addEventListener(
  "change",
  () => {
    syncAmbient();
    scheduler.requestFrame("overlay");
  },
  { signal: listeners.signal },
);
syncAmbient();

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
    if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
    if (e.code === "KeyG") {
      lattice.toggleBuildMode();
      updateLatticeCursor();
      scheduler.requestFrame("overlay");
    } else if (e.code === "KeyL") {
      labels.toggle();
      scheduler.requestFrame("overlay");
    } else if (e.code === "F3") {
      e.preventDefault();
      perf.toggle();
      scheduler.requestFrame("overlay");
    }
  },
  { signal: listeners.signal },
);

// The lookdev tweak panel: only with ?tweak=1, in any build.
let rebuildTimer: number | undefined;
function rebuildBakedColours(): void {
  // Terrain vertex colours and every procedural asset bake palette values: rebuild them.
  scene.remove(terrainView.group, sceneryView.group);
  terrainView.dispose();
  sceneryView.dispose();
  registry.dispose();
  registry = new AssetRegistry();
  registerSceneryAssets(registry);
  terrainView = new TerrainView(terrain, lattice.material, lattice.waterMaterial);
  sceneryView = new SceneryView(scenery, terrain, registry, materials, uniforms);
  scene.add(terrainView.group, sceneryView.group);
  scheduler.requestFrame("rebuild");
}
const tweak = showTweakPanel(params)
  ? new TweakPanel(document.body, {
      lighting,
      renderer: host.renderer,
      vignette,
      onPaletteChange: () => {
        syncArtColors(uniforms, host.renderer.toneMappingExposure);
        lighting.syncColors();
        (scene.background as Color).setHex(palette.haze);
        lattice.uniforms.uLineColor.value.setHex(palette.latticeLine);
        window.clearTimeout(rebuildTimer);
        rebuildTimer = window.setTimeout(rebuildBakedColours, 300);
        scheduler.requestFrame("overlay");
      },
      onChange: () => {
        syncArtColors(uniforms, host.renderer.toneMappingExposure);
        scheduler.requestFrame("overlay");
      },
    })
  : undefined;

scheduler.onFrame((frame) => {
  controller.update(frame);
  // The camera may have moved under a still pointer: keep the reveal on the terrain under it.
  if (lattice.buildMode) updateLatticeCursor();
  if (lattice.update(frame.nowMs, minLatticeLineSpacingPx(camera.yaw, camera.pitch, camera.ppm))) {
    scheduler.requestFrame("overlay");
  }
  if (scheduler.isContinuous("ambient") && frame.consecutive) ambientTimeS += Math.min(frame.dtMs, 100) / 1000;
  uniforms.sway.uTime.value = ambientTimeS;
  sceneryView.update(camera.ppm, ambientTimeS);
  terrainView.setLod(terrainLodForPpm(camera.ppm));
  lighting.update(camera, box);
  // Resize the buffer in the frame that draws into it, so no blank canvas is painted.
  host.syncSize();
  host.renderer.render(scene, camera.camera);
  labels.update(camera, camera.camera);
  perf.sample(frame);
});
scheduler.requestFrame("init");

if (import.meta.env.DEV) {
  // Handle for agent checks in a dev browser (frame counts, camera state, draw calls); absent from builds.
  Object.assign(window, {
    __diorama: {
      scheduler,
      camera,
      perf,
      terrain,
      scenery,
      bookmarks,
      labels,
      renderer: host.renderer,
      /** Centres the ground at sim plan (x, y) metres at a zoom (agent checks). */
      lookAt(xM: number, yM: number, ppm: number) {
        const t = focusTarget(terrain, xM, yM, camera.pitch, camera.yaw);
        camera.target.x = t.x;
        camera.target.z = t.z;
        camera.ppm = ppm;
        scheduler.requestFrame("input");
      },
      get sceneryView() {
        return sceneryView;
      },
    },
  });
}

import.meta.hot?.dispose(() => {
  listeners.abort();
  window.clearTimeout(rebuildTimer);
  scheduler.dispose();
  controller.dispose();
  perf.dispose();
  tweak?.dispose();
  labels.dispose();
  vignette.dispose();
  lighting.dispose();
  sceneryView.dispose();
  registry.dispose();
  materials.dispose();
  terrainView.dispose();
  lattice.dispose();
  host.dispose();
});
