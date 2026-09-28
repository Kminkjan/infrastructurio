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
import { type PickVisibility, trackToolMask } from "../render/picking/layers";
import { type ScreenPick, pickTrackStack } from "../render/picking/trackPicker";
import { SceneryView, registerSceneryAssets } from "../render/scenery/SceneryView";
import { SceneryClearance } from "../render/scenery/clearance";
import { StructureView } from "../render/structures/StructureView";
import { registerStructureAssets } from "../render/structures/assets";
import { EarthworksView } from "../render/terrain/EarthworksView";
import { TerrainView } from "../render/terrain/TerrainView";
import { raycastTerrain, visibleGroundM, waterPlane } from "../render/terrain/heightfieldRay";
import { LatticeOverlay } from "../render/terrain/latticeMaterial";
import { terrainLodForPpm, terrainWorldBounds } from "../render/terrain/terrainGeometry";
import { TERRAIN_LOOKS, applyTerrainLook, setTerrainAnisotropy, terrainChunkOptions } from "../render/terrain/terrainLook";
import { FlashView, GhostView, HighlightView } from "../render/track/GhostView";
import { SnapRing } from "../render/track/SnapRing";
import { TrackView } from "../render/track/TrackView";
import { pickOfNetworkNode, planPointOfNode } from "../tools/picks";
import type { ToolPick } from "../tools/types";
import { mountHud } from "../ui/Hud";
import { createHudStore, isTrackTool } from "../ui/store";
import { Construction } from "./construction";
import { applyHudTheme } from "./hudTheme";
import { InputRouter } from "./InputRouter";
import { type KeyTool, isMacPlatform } from "./keymap";

// Composition root: the seeded terrain and the static Baltic diorama (D11a)
// under the isometric, render-on-demand camera, plus construction (D3): the
// sim (track only, no step loop yet), the track tool behind InputRouter, the
// track meshes, the ghost and the React HUD. Ambient animation (tree sway,
// windmill sails) keeps the `ambient` reason at 30 fps unless reduced motion
// is on, in which case an idle page draws zero frames.
// URL: ?bookmark=1..4 (Look Gate A views), ?pitch=30 (pitch A/B), ?tweak=1 or 0,
// ?trackBatch=chunked (force the multi-draw fallback, for checks), ?earthworks=0
// (draw the natural terrain under track, for before/after checks), ?structures=0 (draw no
// bridges or tunnel portals, for before/after checks; D4).

const canvas = document.querySelector<HTMLCanvasElement>("#world");
const viewport = document.querySelector<HTMLDivElement>("#viewport");
const hudRoot = document.querySelector<HTMLDivElement>("#hud");
if (!canvas || !viewport || !hudRoot) throw new Error("missing #world canvas, #viewport or #hud");

const params = parseLookdevParams(window.location.search);
const forceChunkedTrack = new URLSearchParams(window.location.search).get("trackBatch") === "chunked";
const earthworksOn = new URLSearchParams(window.location.search).get("earthworks") !== "0";
const structuresOn = new URLSearchParams(window.location.search).get("structures") !== "0";
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
// ?terrain=d11a|a|b|c: the terrain look variant (d11a is the look Look Gate A scored, where no track is built; see terrainLook.ts).
const look = TERRAIN_LOOKS[params.terrain];
const uniforms = createArtUniforms(terrainWorldBounds(terrain));
applyTerrainLook(uniforms, look, terrain.waterLevelDm / 10);
const materials = createWorldMaterials(uniforms);
const trackMaterials = createTrackMaterials(uniforms);
const lattice = new LatticeOverlay(reducedMotion, { terrain: terrainChunks(uniforms, terrainChunkOptions(look)), water: waterChunks(uniforms) });
let registry = new AssetRegistry();
registerSceneryAssets(registry);
registerStructureAssets(registry);
let terrainView = new TerrainView(terrain, lattice.material, lattice.waterMaterial, look.colours);
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
/** The terrain look's filtering on the splat and AO maps; before their first upload (the first frame). */
function applyTerrainFiltering(): void {
  setTerrainAnisotropy([uniforms.splat.uSplatMap.value, uniforms.splat.uAoMap.value], look, host.renderer.capabilities.getMaxAnisotropy());
}
applyTerrainFiltering();

// Track and construction overlays.
const multiDraw = !forceChunkedTrack && host.renderer.extensions.has("WEBGL_multi_draw");
const trackView = new TrackView({
  materials: trackMaterials,
  multiDraw,
  requestFrame: () => scheduler.requestFrame("rebuild"),
  now: () => performance.now(),
});
// Earthworks-lite (2026-09-27): render-only cuttings and embankments under ground track, kept in step with the
// network like the track, clearing trees and props they claim. Picking marches the drawn (conformed) surface.
const clearanceOf = (view: SceneryView) => new SceneryClearance(terrain, [view.trees, view.props]);
const earthworks = new EarthworksView({
  terrain,
  target: terrainView,
  requestFrame: () => scheduler.requestFrame("rebuild"),
  now: () => performance.now(),
  scenery: clearanceOf(sceneryView),
  enabled: earthworksOn,
});
const water = waterPlane(terrain, terrainView.shading.waterDistance);
// D4: bridges and tunnel portals (with hill plugs in the terrain's material), kept in step with the network like the
// track; piers stand on the drawn ground. The occlusion aids H and U and the pick proxies live here too.
const structures = new StructureView({
  terrain,
  registry,
  material: materials.built,
  plugMaterial: lattice.material,
  shading: terrainView.shading,
  water,
  requestFrame: () => scheduler.requestFrame("rebuild"),
  now: () => performance.now(),
  groundM: (x, y) => earthworks.heightfield.heightAtM(x, y),
  enabled: structuresOn,
});
/**
 * The ground as drawn: the earthworks' conformed LOD0 surface, raised by any hill plug behind a portal. Construction
 * picks march it, so the cursor lands on the ground the player sees; a picked node keeps its sim height.
 */
const drawnSurface = {
  heightAtM(x: number, y: number): number {
    const h = earthworks.heightfield.heightAtM(x, y);
    const plug = structures.plugHeightAt(x, y);
    return Number.isNaN(plug) || plug <= h ? h : plug;
  },
  get minZ(): number {
    return earthworks.heightfield.minZ;
  },
  get maxZ(): number {
    return Math.max(earthworks.heightfield.maxZ, structures.plugTopZ);
  },
};
/**
 * The surface under the ghost's drop lines and end-height tags: the drawn terrain (the earthworks' conformed LOD0
 * surface, which picking marches too), or the water plane where it is drawn over a lower surface, so a line meets a
 * cutting's floor where it is drawn and a tag over water reads the height above the water (PR #83 review and
 * re-review). Off earthworks it is the tool's ground at nodes (`groundMmAt`), which stays the sim-facing height.
 */
const groundM = (x: number, y: number): number | undefined => visibleGroundM(drawnSurface, water, x, y);
const ghost = new GhostView(viewport, groundM);
const highlight = new HighlightView();
const flash = new FlashView(reducedMotion);
const snapRing = new SnapRing();
scene.add(trackView.group, structures.group, highlight.group, ghost.group, flash.group, snapRing.group);
/** The terrain box grown to the structures' tops, for the shadow fit (a truss over a valley stands above the hills). */
const shadowBox = { ...box };

// The HUD: React outside the frame loop, fed by the store the app alone writes.
applyHudTheme(hudRoot);
const store = createHudStore();

const pickRay = new Ray();
const pickPoint = new Vector3();
const simHit = { x: 0, y: 0, z: 0 };

/** The occlusion aids (presentation state, never commands): H hides decks, U shows the underground x-ray. */
const aids = { decksHidden: false, xray: false };
const visibility = (): PickVisibility => ({ decks: !aids.decksHidden, tunnels: aids.xray });
/**
 * C: which of the stacked picks under the pointer is taken. It resets when the pointer moves more than a few
 * pixels, so a click right after C lands on the chosen level.
 */
const pickCycle = { index: 0, x: Number.NaN, y: Number.NaN, size: 0 };
const PICK_CYCLE_SLOP_PX = 4;

/** Every pick under a canvas CSS pixel, front first: stacked track levels, then the terrain's lattice node. */
function pickStackAt(x: number, y: number): ScreenPick[] {
  camera.screenToGroundRay(x, y, pickRay);
  const ground = raycastTerrain(terrain, pickRay.origin, pickRay.direction, pickPoint, drawnSurface) ? worldToSim(pickPoint, simHit) : null;
  const proxies = structures.pickProxies(pickRay, trackToolMask(visibility()));
  return pickTrackStack(sim.network(), camera, x, y, ground, { visibility: visibility(), proxies });
}

/** The construction pick at a canvas CSS pixel: an existing node, a piece, or the terrain's lattice node (C picks deeper). */
function pickAt(x: number, y: number): ToolPick | null {
  if (!(Math.hypot(x - pickCycle.x, y - pickCycle.y) <= PICK_CYCLE_SLOP_PX)) {
    pickCycle.index = 0;
    pickCycle.x = x;
    pickCycle.y = y;
  }
  const stack = pickStackAt(x, y);
  pickCycle.size = stack.length;
  const pick = stack[pickCycle.index % Math.max(1, stack.length)];
  return pick ? toToolPick(pick) : null;
}

function toToolPick(pick: ScreenPick): ToolPick | null {
  const network = sim.network();
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

function selectTool(tool: KeyTool): void {
  construction.selectTool(tool);
  router?.handToTool();
}

/** Describes a tool pick for the status line. */
function describePick(p: ToolPick): string {
  const where = `(${p.node.q}, ${p.node.r}) at ${(p.node.zMm / 1000).toFixed(1)} m`;
  if (p.kind === "node") return `ground ${where}`;
  const structure = p.pieceKey ? sim.network().pieces.find((piece) => piece.key === p.pieceKey)?.structure : undefined;
  const on = structure === "bridge" ? "bridge" : structure === "tunnel" ? "tunnel" : "track";
  return p.kind === "endpoint" ? `the ${on} end ${where}` : `the ${on} ${where}`;
}

function toggleDecks(): void {
  aids.decksHidden = !aids.decksHidden;
  trackView.setDecksHidden(aids.decksHidden);
  structures.setDecksHidden(aids.decksHidden);
  store.set({ views: Object.freeze({ ...aids }) });
  construction.announce(aids.decksHidden ? "Bridge decks hidden: the track under them can be picked. H shows them." : "Bridge decks shown.");
  router?.repick();
  scheduler.requestFrame("overlay");
}

function toggleXray(): void {
  aids.xray = !aids.xray;
  structures.setXray(aids.xray);
  store.set({ views: Object.freeze({ ...aids }) });
  construction.announce(aids.xray ? "Underground x-ray on: tunnels show through the ground and can be picked. U hides them." : "Underground x-ray off.");
  router?.repick();
  scheduler.requestFrame("overlay");
}

function cyclePick(): void {
  if (!construction.trackToolActive) return;
  if (construction.trackState.cursor || !router?.pointerState.inside) {
    construction.announce("C picks the next of the stacked tracks and ground under the pointer.");
    return;
  }
  pickCycle.index += 1;
  router.repick();
  const size = Math.max(1, pickCycle.size);
  const target = construction.trackState.target;
  construction.announce(`Pick ${(pickCycle.index % size) + 1} of ${size}${target ? `: ${describePick(target)}` : ""}.`);
  scheduler.requestFrame("hover");
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
  trackActive: () => construction.trackToolActive,
  cursorLeads: () => construction.trackState.cursor,
  dispatch: (event) => construction.dispatch(event),
  onPointer: (x, y, inside) => {
    if (inside) construction.onPointer(x, y);
  },
  actions: {
    undo: () => construction.undo(),
    redo: () => construction.redo(),
    selectTool,
    toggleDecks,
    toggleXray,
    cyclePick,
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
  selectTool: (tool) => (isTrackTool(tool) ? selectTool(tool) : construction.selectTool("select")),
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
  registerStructureAssets(registry);
  terrainView = new TerrainView(terrain, lattice.material, lattice.waterMaterial, look.colours);
  sceneryView = new SceneryView(scenery, terrain, registry, materials, uniforms);
  applyTerrainFiltering();
  scene.add(terrainView.group, sceneryView.group);
  trackMaterials.stripe.uTrackStripeColor.value.setHex(palette.sleeper);
  trackView.invalidate();
  earthworks.retarget(terrainView, clearanceOf(sceneryView));
  structures.retarget(registry, terrainView.shading);
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

// The camera state last frame, so a still pointer re-picks when the view moves under it, and the
// screen-anchored overlays (end-height tags, the cursor's tooltip) move only when the projection changed.
const lastView = { x: Number.NaN, z: Number.NaN, ppm: Number.NaN, yaw: Number.NaN, width: Number.NaN, height: Number.NaN };
/** The earthworks revision the ghost's drop lines and height tags last measured (`GhostView.refreshGround`). */
let ghostSurfaceRev = -1;

scheduler.onFrame((frame) => {
  controller.update(frame);
  const moved = camera.target.x !== lastView.x || camera.target.z !== lastView.z || camera.ppm !== lastView.ppm || camera.yaw !== lastView.yaw;
  const resized = camera.cssWidth !== lastView.width || camera.cssHeight !== lastView.height;
  if (moved) {
    lastView.x = camera.target.x;
    lastView.z = camera.target.z;
    lastView.ppm = camera.ppm;
    lastView.yaw = camera.yaw;
    router?.repick();
  }
  if (resized) {
    lastView.width = camera.cssWidth;
    lastView.height = camera.cssHeight;
  }
  // Static diffs by revision (time-sliced past 8 ms: the earthworks, then the structures, get what the track left),
  // then the track LOD.
  const syncStart = performance.now();
  const network = sim.network();
  trackView.sync(network);
  earthworks.sync(network, sim.ground(), Math.max(1, 8 - (performance.now() - syncStart)));
  if (structures.sync(network, Math.max(1, 8 - (performance.now() - syncStart)))) shadowBox.maxY = Math.max(box.maxY, structures.stats.topZ);
  // Once the conformed LOD0 surface of a revision is drawn, the ghost measures its marks again: a commit sets the
  // chained ghost before the earthworks land (PR #83 re-review), and this frame draws the refreshed marks. Piers
  // standing where a new cutting lowered the ground are rebuilt deeper (D4).
  const surfaceRev = earthworks.surfaceRev;
  if (surfaceRev !== ghostSurfaceRev) {
    ghostSurfaceRev = surfaceRev;
    if (surfaceRev >= 0 && ghost.refreshGround()) ghost.updateTags(camera);
    if (surfaceRev >= 0) structures.refreshGround();
  }
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
  uniforms.relief.uReliefPpm.value = camera.ppm;
  lighting.update(camera, shadowBox);
  // Resize the buffer in the frame that draws into it, so no blank canvas is painted.
  host.syncSize();
  host.renderer.render(scene, camera.camera);
  labels.update(camera, camera.camera);
  if (moved || resized) {
    ghost.updateTags(camera);
    construction.onViewChange();
  }
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
      scene,
      camera,
      /** The shared art uniforms (agent lookdev probes; the terrain look's relief and detail live here). */
      uniforms,
      look,
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
      /** Page CSS px of sim plan point (x, y) at height z, metres. */
      planScreen(xM: number, yM: number, zM: number): { x: number; y: number } {
        const s = worldToScreen(camera, simToWorld(xM, yM, zM, new Vector3()));
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + s.x, y: rect.top + s.y };
      },
      network: () => sim.network(),
      groundZmm: (q: number, r: number) => construction.groundZmm(q, r),
      previewStats: () => construction.previewStats(),
      trackStats: () => trackView.stats,
      earthworks,
      earthworksStats: () => earthworks.stats,
      structures,
      structureStats: () => structures.stats,
      /** The bridge runs' span layouts (type, rule and supports per span), for agent checks. */
      structureLayouts: () =>
        structures.layouts.map(({ run, layout }) => ({
          pieces: run.pieces.map((p) => p.piece.key),
          spans: layout.spans.map((s) => ({ a: s.a, b: s.b, type: s.type, rule: s.rule, riseM: s.riseM, overWater: s.overWater, overTrack: s.overTrack })),
          supports: layout.supports.map((p) => ({ s: p.s, kind: p.kind, wet: p.wet, buried: p.buried, footprint: [...p.footprint] })),
        })),
      aids: () => ({ ...aids }),
      /** The tool pick at canvas CSS px (x, y) and the size of the stack there, as the pointer would get it (read-only). */
      pickAt(x: number, y: number) {
        return { pick: pickAt(x, y), stack: pickCycle.size, index: pickCycle.index };
      },
      trackBridgeShown: () => trackView.bridgeTrackShown,
      ghostMarks: () => ghost.marksVisible,
      /** Drawn (conformed) and natural terrain height (m) at sim plan (x, y), LOD0 or LOD1. */
      drawnHeightM: (x: number, y: number, lod: 0 | 1 = 0) => (lod === 0 ? earthworks.heightfield : earthworks.heightfieldLod1).heightAtM(x, y),
      naturalHeightM: (x: number, y: number, lod: 0 | 1 = 0) => (lod === 0 ? earthworks.heightfield : earthworks.heightfieldLod1).naturalAtM(x, y),
      tool: () => {
        const t = construction.trackState;
        const target = t.target ? { kind: t.target.kind, q: t.target.node.q, r: t.target.node.r, zMm: t.target.node.zMm, pieceKey: t.target.pieceKey ?? null } : null;
        return { active: construction.activeTool, phase: t.phase, heightSteps: t.heightSteps, cursor: t.cursor, structure: t.structure, target };
      },
      hud: () => store.getSnapshot(),
      /** True once a frame has rendered and the track and earthworks match the current network revision. */
      get ready() {
        const rev = sim.network().rev;
        return (
          scheduler.frameCount > 0 &&
          trackView.stats.appliedRev === rev &&
          (!earthworks.enabled || earthworks.stats.appliedRev === rev) &&
          (!structures.enabled || structures.stats.appliedRev === rev)
        );
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
  structures.dispose();
  trackView.dispose();
  trackMaterials.dispose();
  sceneryView.dispose();
  registry.dispose();
  materials.dispose();
  terrainView.dispose();
  lattice.dispose();
  host.dispose();
});
