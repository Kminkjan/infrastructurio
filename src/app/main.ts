import { Color, Ray, Scene, Vector3 } from "three";
import { DIORAMA_SEED, generateDiorama } from "../core/scenarios/baltic-diorama";
import { createSim } from "../core/sim/api";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../core/terrain";
import { AssetRegistry } from "../render/art/AssetRegistry";
import { TweakPanel } from "../render/art/TweakPanel";
import { SceneLighting } from "../render/art/lighting";
import {
  createArtUniforms,
  createTrackMaterials,
  createWorldMaterials,
  setSwayEnabled,
  syncArtColors,
  terrainChunks,
  waterChunks,
} from "../render/art/materials";
import { palette } from "../render/art/palette";
import { Vignette } from "../render/art/vignette";
import { CameraController } from "../render/camera/CameraController";
import { IsoCamera } from "../render/camera/IsoCamera";
import { dioramaBookmarks, focusTarget, parseLookdevParams, showTweakPanel } from "../render/camera/bookmarks";
import { NAMED_ZOOMS, minLatticeLineSpacingPx, worldToScreen } from "../render/camera/isoMath";
import { simToWorld, worldToSim } from "../render/coords";
import { FrameScheduler } from "../render/core/FrameScheduler";
import { PerfMonitor } from "../render/core/PerfMonitor";
import { RendererHost } from "../render/core/RendererHost";
import { LabelLayer } from "../render/labels/LabelLayer";
import { dioramaLabels } from "../render/labels/placeLabels";
import { pickTrack } from "../render/picking/trackPicker";
import { SceneryView, registerSceneryAssets } from "../render/scenery/SceneryView";
import { TerrainView } from "../render/terrain/TerrainView";
import { raycastTerrain, sampleTerrainHeightM } from "../render/terrain/heightfieldRay";
import { LatticeOverlay } from "../render/terrain/latticeMaterial";
import { terrainLodForPpm, terrainWorldBounds } from "../render/terrain/terrainGeometry";
import { FlashView, GhostView, HighlightView } from "../render/track/GhostView";
import { SnapRing } from "../render/track/SnapRing";
import { TrackView } from "../render/track/TrackView";
import { pickOfNetworkNode, planPointOfNode } from "../tools/picks";
import type { ToolPick } from "../tools/types";
import { mountHud } from "../ui/Hud";
import { createHudStore } from "../ui/store";
import { Construction } from "./construction";
import { applyHudTheme } from "./hudTheme";
import { InputRouter } from "./InputRouter";
import { isMacPlatform } from "./keymap";

// Composition root: the seeded terrain and the static Baltic diorama (D11a)
// under the isometric, render-on-demand camera, plus construction (D3): the
// sim (track only, no step loop yet), the track tool behind InputRouter, the
// track meshes, the ghost and the React HUD. Ambient animation (tree sway,
// windmill sails) keeps the `ambient` reason at 30 fps unless reduced motion
// is on, in which case an idle page draws zero frames.
// URL: ?bookmark=1..4 (Look Gate A views), ?pitch=30 (pitch A/B), ?tweak=1 or 0,
// ?trackBatch=chunked (force the multi-draw fallback, for checks).

const canvas = document.querySelector<HTMLCanvasElement>("#world");
const viewport = document.querySelector<HTMLDivElement>("#viewport");
const hudRoot = document.querySelector<HTMLDivElement>("#hud");
if (!canvas || !viewport || !hudRoot) throw new Error("missing #world canvas, #viewport or #hud");

const params = parseLookdevParams(window.location.search);
const forceChunkedTrack = new URLSearchParams(window.location.search).get("trackBatch") === "chunked";
const listeners = new AbortController();
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = (): boolean => reducedMotionQuery.matches;

const terrainParams = { seed: DIORAMA_SEED, ...DEFAULT_TERRAIN_SIZE };
const terrain = generateTerrain(terrainParams);
const scenery = generateDiorama(terrain, DIORAMA_SEED);
// The sim regenerates the same terrain from the same parameters (its own copy; the core owns its state).
const sim = createSim({ terrain: terrainParams });

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
const trackMaterials = createTrackMaterials(uniforms);
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

// Track and construction overlays.
const multiDraw = !forceChunkedTrack && host.renderer.extensions.has("WEBGL_multi_draw");
const trackView = new TrackView({
  materials: trackMaterials,
  multiDraw,
  requestFrame: () => scheduler.requestFrame("rebuild"),
  now: () => performance.now(),
});
const groundM = (x: number, y: number): number | undefined => sampleTerrainHeightM(terrain, x, y);
const ghost = new GhostView(viewport, groundM);
const highlight = new HighlightView();
const flash = new FlashView(reducedMotion);
const snapRing = new SnapRing();
scene.add(trackView.group, highlight.group, ghost.group, flash.group, snapRing.group);

// The HUD: React outside the frame loop, fed by the store the app alone writes.
applyHudTheme(hudRoot);
const store = createHudStore();

const pickRay = new Ray();
const pickPoint = new Vector3();
const simHit = { x: 0, y: 0, z: 0 };

/** The construction pick at a canvas CSS pixel: an existing node, a piece, or the terrain's lattice node. */
function pickAt(x: number, y: number): ToolPick | null {
  camera.screenToGroundRay(x, y, pickRay);
  const ground = raycastTerrain(terrain, pickRay.origin, pickRay.direction, pickPoint) ? worldToSim(pickPoint, simHit) : null;
  const network = sim.network();
  const pick = pickTrack(network, camera, x, y, ground);
  if (!pick) return null;
  switch (pick.kind) {
    case "node":
      return pickOfNetworkNode(network, pick.node);
    case "piece": {
      const n = pick.node;
      return { kind: "track", node: { q: n.q, r: n.r, zMm: n.zMm }, pointMm: planPointOfNode(n.q, n.r), pieceKey: pick.piece.key };
    }
    case "ground": {
      const zMm = construction.groundZmm(pick.q, pick.r);
      if (zMm === undefined) return null;
      return { kind: "node", node: { q: pick.q, r: pick.r, zMm }, pointMm: { xMm: Math.round(pick.xM * 1000), yMm: Math.round(pick.yM * 1000) } };
    }
  }
}

const mac = isMacPlatform(navigator.platform, navigator.userAgent);
let router: InputRouter | undefined;
const construction = new Construction({
  sim,
  terrain,
  store,
  ghost,
  highlight,
  flash,
  snap: snapRing,
  lattice,
  camera,
  controller,
  canvas,
  hud: hudRoot,
  requestFrame: (reason) => scheduler.requestFrame(reason),
  now: () => performance.now(),
  precisionHeld: () => router?.precisionHeld ?? false,
});

function selectTrack(): void {
  construction.selectTool("track");
  router?.handToTool();
}

router = new InputRouter({
  canvas,
  camera: controller,
  mac,
  yawStep: () => camera.yawStep,
  pick: pickAt,
  centreNode: () => {
    const p = pickAt(camera.cssWidth / 2, camera.cssHeight / 2);
    return p?.node ?? { q: 0, r: 0, zMm: 0 };
  },
  trackActive: () => construction.activeTool === "track",
  dispatch: (event) => construction.dispatch(event),
  onPointer: (x, y, inside) => {
    if (inside) construction.onPointer(x, y);
  },
  actions: {
    undo: () => construction.undo(),
    redo: () => construction.redo(),
    selectTrack,
    toggleLabels: () => {
      labels.toggle();
      scheduler.requestFrame("overlay");
    },
    togglePerf: () => {
      perf.toggle();
      scheduler.requestFrame("overlay");
    },
  },
});

const unmountHud = mountHud(hudRoot, store, {
  selectTool: (tool) => (tool === "track" ? selectTrack() : construction.selectTool("select")),
  undo: () => construction.undo(),
  redo: () => construction.redo(),
});

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
  trackMaterials.stripe.uTrackStripeColor.value.setHex(palette.sleeper);
  trackView.invalidate();
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

// The camera state last frame, so a still pointer re-picks when the view moves under it.
const lastView = { x: Number.NaN, z: Number.NaN, ppm: Number.NaN, yaw: Number.NaN };

scheduler.onFrame((frame) => {
  controller.update(frame);
  const moved = camera.target.x !== lastView.x || camera.target.z !== lastView.z || camera.ppm !== lastView.ppm || camera.yaw !== lastView.yaw;
  if (moved) {
    lastView.x = camera.target.x;
    lastView.z = camera.target.z;
    lastView.ppm = camera.ppm;
    lastView.yaw = camera.yaw;
    router?.repick();
  }
  // Static diffs by revision (time-sliced past 8 ms), then the track LOD.
  trackView.sync(sim.network());
  trackView.setLod(camera.ppm);
  if (flash.update(frame.nowMs)) scheduler.requestFrame("overlay");
  snapRing.update(camera.camera, camera.ppm);
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
  ghost.updateTags(camera);
  construction.onFrame();
  perf.sample(frame);
});
scheduler.requestFrame("init");

if (import.meta.env.DEV) {
  // Dev and test only (absent from builds): a handle for agent checks and the Playwright
  // projection hook (screen positions of lattice nodes, the network, preview timing).
  const nodeScreen = (q: number, r: number, zMm?: number): { x: number; y: number } => {
    const p = planPointOfNode(q, r);
    const z = zMm ?? construction.groundZmm(q, r) ?? 0;
    const s = worldToScreen(camera, simToWorld(p.xMm / 1000, p.yMm / 1000, z / 1000, new Vector3()));
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + s.x, y: rect.top + s.y };
  };
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
      sim,
      construction,
      /** Centres the ground at sim plan (x, y) metres at a zoom (agent checks). */
      lookAt(xM: number, yM: number, ppm: number) {
        const t = focusTarget(terrain, xM, yM, camera.pitch, camera.yaw);
        camera.target.x = t.x;
        camera.target.z = t.z;
        camera.ppm = ppm;
        scheduler.requestFrame("input");
      },
      /** Centres lattice node (q, r) at a zoom. */
      lookAtNode(q: number, r: number, ppm: number) {
        const p = planPointOfNode(q, r);
        this.lookAt(p.xMm / 1000, p.yMm / 1000, ppm);
      },
      /** Page CSS px of lattice node (q, r) at height zMm (default: the terrain there). */
      nodeScreen,
      network: () => sim.network(),
      groundZmm: (q: number, r: number) => construction.groundZmm(q, r),
      previewStats: () => construction.previewStats(),
      trackStats: () => trackView.stats,
      tool: () => ({ active: construction.activeTool, phase: construction.trackState.phase, heightSteps: construction.trackState.heightSteps }),
      hud: () => store.getSnapshot(),
      /** True once a frame has rendered and no track rebuild is pending. */
      get ready() {
        return scheduler.frameCount > 0 && !trackView.busy;
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
  router?.dispose();
  construction.dispose();
  unmountHud();
  scheduler.dispose();
  controller.dispose();
  perf.dispose();
  tweak?.dispose();
  labels.dispose();
  vignette.dispose();
  lighting.dispose();
  ghost.dispose();
  highlight.dispose();
  flash.dispose();
  snapRing.dispose();
  trackView.dispose();
  trackMaterials.dispose();
  sceneryView.dispose();
  registry.dispose();
  materials.dispose();
  terrainView.dispose();
  lattice.dispose();
  host.dispose();
});
