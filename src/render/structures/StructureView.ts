import { BoxGeometry, BufferAttribute, BufferGeometry, Group, type Material, Matrix4, Mesh, MeshBasicMaterial, type Ray, Raycaster, Scene, Vector3 } from "three";
import { centrelineIndex, nearestOnCentreline, sampleCentrelineEvery } from "../../core/geometry/sample";
import type { GroundQuery, NetworkPiece, NetworkView, Terrain } from "../../core/sim/api";
import type { AssetRegistry } from "../art/AssetRegistry";
import { EARTHWORK_ATTRIBUTE, EARTHWORK_ITEM_SIZE } from "../art/shaderChunks/earthwork";
import { palette } from "../art/palette";
import { PICK_LAYER } from "../picking/layers";
import { FORMATION_HALF_WIDTH_M, lodLattice, naturalHeightM } from "../terrain/earthworks";
import type { WaterPlane } from "../terrain/heightfieldRay";
import type { TerrainShading } from "../terrain/terrainShading";
import { OverlayRibbons } from "../track/GhostView";
import type { RibbonPiece } from "../track/ghostGeometry";
import {
  ABUTMENT_KIND,
  ARCH_KIND,
  GIRDER_KIND,
  PIER_KIND,
  PORTAL_KIND,
  TRUSS_KIND,
  abutmentVariant,
  archVariant,
  pierVariant,
  portalSkylineV,
  portalVariant,
  spanVariant,
  unpackArch,
  unpackPortal,
} from "./assets";
import { BORE_HALF_M, BORE_SPRING_V, DECK_HALF_M, FOOT_SINK_M, PARAPET_TOP_V, PORTAL_HALF_WIDTH_M, PORTAL_MAX_WING_M, PORTAL_WING_SPLAY_SIN } from "./dimensions";
import { type BridgeLayout, type LayoutEnv, layoutBridge } from "./layout";
import { GeometrySink, bend, place } from "./place";
import { HillPlug, type PlugRegion, PlugSurface, type PortalApproach, type PortalFrame, portalWings } from "./plug";
import { BACKFILL_REACH_S_M, BACKFILL_REACH_U_M, type PortalWings, WING_PIER_ALONG_M, wingAcross } from "./portalOutline";
import { type PathPoint, RunPath } from "./runPath";
import { type StructureRun, isPortalEnd, structureRuns } from "./runs";

/**
 * Bridges and tunnels as period structures (issue #68 "Render"; art direction
 * "Structures"), kept in step with `NetworkView` snapshots like `TrackView`
 * and `EarthworksView`: on a new revision the network's bridge and tunnel runs
 * (`runs.ts`) are diffed by a signature (their pieces, what lies beyond their
 * ends and, for a bridge, the other tracks near it, which move its piers and
 * choose its girders), removed runs leave at once, and changed or new runs
 * queue for building, a few per frame within the slice budget (8 ms, at least
 * one run a frame). A bridge run is laid out by `layout.ts` and assembled from
 * the `AssetRegistry` templates (`assets.ts`), bent along the run
 * (`place.ts`); a tunnel run gets a portal and a hill plug (`plug.ts`) at each
 * end that opens to daylight. Each run is one mesh in the shared `built`
 * material; each plug one mesh in the terrain's material.
 *
 * Occlusion aids (presentation state, never commands): `setDecksHidden` (H)
 * hides every bridge and shows the hidden decks' outlines; `setXray` (U) shows
 * the tunnels through the ground as see-through ribbons. The never-rendered
 * `pickScene` holds box proxies per piece on the DECK and TUNNEL layers
 * (`picking/layers.ts`), raycast by `pickProxies` under the tool's mask.
 */

export const STRUCTURE_BUDGET_MS = 8;

export interface StructureViewOptions {
  readonly terrain: Terrain;
  readonly registry: AssetRegistry;
  /** The shared `built` material (vertex colours, flat shading, grain, edge fade). */
  readonly material: Material;
  /** The terrain's material, for hill plugs. */
  readonly plugMaterial: Material;
  readonly shading: TerrainShading;
  readonly water: WaterPlane;
  readonly requestFrame: () => void;
  readonly now: () => number;
  readonly budgetMs?: number;
  /**
   * The ground as the terrain mesh draws it (the conformed surface; behind a tunnel portal the underlay under its
   * plug): piers and abutments stand on it, wings see it in front of them, plugs draw only over it. The natural
   * ground when omitted.
   */
  readonly groundM?: (x: number, y: number) => number;
  /**
   * The core's effective ground over a plan box (`EarthworksView.effectiveIn`): behind a tunnel portal the hill the
   * portal retains, which the plug draws. The drawn ground when omitted.
   */
  readonly effectiveIn?: (box: Box) => (x: number, y: number) => number;
  /**
   * The other tracks' lowest cut envelope over a plan box, leaving out the chains clipped at the node keys in
   * `except` (a run's portal nodes: both approaches; `EarthworksView.cutEnvelopeIn`): the plugs' backfill stays under
   * it, and the wings retain the hill as it leaves it. None when omitted.
   */
  readonly cutEnvelopeIn?: (box: Box, except: readonly string[]) => (x: number, y: number) => number;
  /** The terrain mesh's earthwork attribute over a plan box (`EarthworksView.attributeIn`), for the plugs' outlines. */
  readonly attributeIn?: (box: Box) => (x: number, y: number, natural: number, drawn: number, out: Float64Array) => void;
  /** The plan box of the underlay's notch behind the tunnel plane at node key `key` (`EarthworksView.notchBox`). */
  readonly notchBox?: (key: string) => Box | undefined;
  /** The core's effective ground at nodes, for the portal definition at buffer ends (`isPortal`); the natural terrain when omitted. */
  readonly ground?: GroundQuery;
  /** False draws no structures (`?structures=0`, for before/after checks). */
  readonly enabled?: boolean;
}

export interface StructureStats {
  /** The network revision fully applied, or −1 while runs are pending. */
  readonly appliedRev: number;
  readonly pending: number;
  readonly bridges: number;
  readonly tunnels: number;
  readonly spans: { readonly arch: number; readonly solid: number; readonly truss: number; readonly girder: number };
  readonly piers: number;
  readonly abutments: number;
  readonly portals: number;
  readonly triangles: number;
  /** Highest structure point (m), for shadow bounds. */
  readonly topZ: number;
  readonly lastRebuild: { readonly runs: number; readonly slices: number; readonly totalMs: number; readonly longestSliceMs: number };
}

interface QueuedRun {
  readonly run: StructureRun;
  readonly signature: string;
  /** Keys of the other pieces near a bridge run (its layout reads their centrelines). */
  readonly neighbours: readonly string[];
  /**
   * A tunnel run's ends that open to daylight (`isPortalEnd`, over the core's effective ground when it was signed):
   * part of the signature, since a later cutting can move a buffer end's ground without touching the run.
   */
  readonly portalEnds: readonly (0 | 1)[];
}

interface BuiltRun extends QueuedRun {
  readonly mesh: Mesh | undefined;
  readonly plugs: readonly HillPlug[];
  /** Each plug's drawn-ground signature when it was built (`HillPlug.groundSignature`). */
  readonly plugGround: readonly string[];
  readonly plugMeshes: readonly Mesh[];
  readonly proxies: readonly Mesh[];
  readonly layout: BridgeLayout | undefined;
  /** Footprint samples of piers and abutments: x, y, the foot height (m). */
  readonly feet: Float64Array;
  readonly counts: { arch: number; solid: number; truss: number; girder: number; piers: number; abutments: number; portals: number };
  readonly triangles: number;
  readonly topZ: number;
}

function samePortalEnds(a: readonly (0 | 1)[], b: readonly (0 | 1)[]): boolean {
  return a.length === b.length && a.every((end, i) => end === b[i]);
}

/** What a pick proxy carries: its piece and its chord on the sim plan with the track heights at both ends. */
interface ProxyData {
  readonly pieceKey: string;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly za: number;
  readonly zb: number;
}

/** How near another track has to come for a bridge's layout to depend on it. */
const NEIGHBOUR_MARGIN_M = 12;
/** Other tracks are sampled this often for the layout's clearance tests. */
const OTHER_SAMPLE_M = 0.5;
/** Proxy boxes follow a curve in chords no longer than this. */
const PROXY_CHORD_M = 6;

const P: PathPoint = { x: 0, y: 0, z: 0, tx: 1, ty: 0 };

type Box = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };

/** A plug reaches at most this far behind its face (the underlay's notch under a tall hill), and this far across it. */
const PLUG_MAX_REACH_M = 60;
/** The underlay's notch lies within this of the track behind a portal (where the retained skyline tops the section). */
const NOTCH_HALF_WIDTH_M = 12;

export class StructureView {
  readonly group = new Group();
  /** Hidden under H. */
  private readonly bridgeGroup = new Group();
  private readonly tunnelGroup = new Group();
  /** Proxies only; never rendered. */
  readonly pickScene = new Scene();
  private readonly proxyGeometry = new BoxGeometry(1, 1, 1);
  private readonly proxyMaterial = new MeshBasicMaterial();
  private readonly raycaster = new Raycaster();
  private readonly xrayRibbons = new OverlayRibbons("tunnel x-ray", 0.6, 0.42);
  private readonly hiddenDecks = new OverlayRibbons("hidden decks", 0.55, 0.3);
  private readonly built = new Map<string, BuiltRun>();
  private queue: QueuedRun[] = [];
  private targetRev = -1;
  private overlayKey = "";
  private decksHidden = false;
  private xray = false;
  private rebuild = { runs: 0, slices: 0, totalMs: 0, longestSliceMs: 0 };
  private readonly boundsCache = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  private readonly budgetMs: number;
  private registry: AssetRegistry;
  private shading: TerrainShading;
  private material: Material;
  private network: NetworkView | undefined;
  private readonly lat;

  constructor(private readonly options: StructureViewOptions) {
    this.group.name = "structures";
    this.bridgeGroup.name = "bridges";
    this.tunnelGroup.name = "tunnels";
    this.group.add(this.bridgeGroup, this.tunnelGroup, this.xrayRibbons.group, this.hiddenDecks.group);
    this.budgetMs = options.budgetMs ?? STRUCTURE_BUDGET_MS;
    this.registry = options.registry;
    this.shading = options.shading;
    this.material = options.material;
    this.lat = lodLattice(options.terrain, 0);
    this.syncAids();
  }

  get enabled(): boolean {
    return this.options.enabled !== false;
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  get stats(): StructureStats {
    const spans = { arch: 0, solid: 0, truss: 0, girder: 0 };
    let piers = 0;
    let abutments = 0;
    let portals = 0;
    let bridges = 0;
    let tunnels = 0;
    let triangles = 0;
    let topZ = -Infinity;
    for (const b of this.built.values()) {
      if (b.run.structure === "bridge") bridges += 1;
      else tunnels += 1;
      spans.arch += b.counts.arch;
      spans.solid += b.counts.solid;
      spans.truss += b.counts.truss;
      spans.girder += b.counts.girder;
      piers += b.counts.piers;
      abutments += b.counts.abutments;
      portals += b.counts.portals;
      triangles += b.triangles;
      topZ = Math.max(topZ, b.topZ);
    }
    return {
      appliedRev: this.queue.length === 0 ? this.targetRev : -1,
      pending: this.queue.length,
      bridges,
      tunnels,
      spans,
      piers,
      abutments,
      portals,
      triangles,
      topZ,
      lastRebuild: { ...this.rebuild },
    };
  }

  /** The laid-out bridge runs, for checks and tests. */
  get layouts(): readonly { readonly run: StructureRun; readonly layout: BridgeLayout }[] {
    const out: { run: StructureRun; layout: BridgeLayout }[] = [];
    for (const b of this.built.values()) if (b.layout) out.push({ run: b.run, layout: b.layout });
    return out;
  }

  /** H: hides every bridge (its structure; `TrackView` hides its track) and outlines the hidden decks. */
  setDecksHidden(hidden: boolean): void {
    this.decksHidden = hidden;
    this.syncAids();
  }

  /** U: shows the tunnels through the ground. */
  setXray(on: boolean): void {
    this.xray = on;
    this.syncAids();
  }

  get aids(): { readonly decksHidden: boolean; readonly xray: boolean } {
    return { decksHidden: this.decksHidden, xray: this.xray };
  }

  /**
   * Brings the structures toward `network`. Call once per frame; it costs a revision compare when nothing changed.
   * Returns true when the scene changed.
   */
  sync(network: NetworkView, budgetMs = this.budgetMs): boolean {
    if (!this.enabled) return false;
    let changed = false;
    if (network.rev !== this.targetRev) {
      this.targetRev = network.rev;
      this.network = network;
      changed = this.applyRevision(network);
      this.rebuild = { runs: 0, slices: 0, totalMs: 0, longestSliceMs: 0 };
    }
    if (this.queue.length === 0) return changed;
    const start = this.options.now();
    let elapsed = 0;
    do {
      const next = this.queue.shift();
      if (!next) break;
      this.buildRun(next);
      this.rebuild.runs += 1;
      elapsed = this.options.now() - start;
    } while (this.queue.length > 0 && elapsed < budgetMs);
    this.rebuild.slices += 1;
    this.rebuild.totalMs += elapsed;
    this.rebuild.longestSliceMs = Math.max(this.rebuild.longestSliceMs, elapsed);
    if (this.queue.length > 0) this.options.requestFrame();
    return true;
  }

  /**
   * Re-checks every pier and abutment foot, and every hill plug, against the ground as drawn now, and every tunnel
   * buffer end's portal decision against the core's effective ground; a run whose feet would show (a cutting beside
   * it landed after it was built), whose plug's ground changed (the approach's cutting landed), or whose dead end now
   * opens or closes, is rebuilt. The app calls it when the earthworks finish a revision. Returns
   * true when anything was queued.
   */
  refreshGround(): boolean {
    const groundM = this.options.groundM;
    const network = this.network;
    if (!network) return false;
    let queued = false;
    for (const b of this.built.values()) {
      // A buffer end's portal decision reads the effective ground there, which a cutting beyond the neighbour margin
      // can move (verification fix, 2026-09-29): re-signed, so the next revision's diff agrees with what is built.
      if (b.run.ends.includes("buffer") && !samePortalEnds(this.portalEndsOf(b.run), b.portalEnds)) {
        this.queue.push(this.signatureOf(b.run, network));
        queued = true;
        continue;
      }
      if (!groundM) continue;
      if (b.plugs.some((p, i) => p.groundSignature() !== b.plugGround[i])) {
        this.queue.push(b);
        queued = true;
        continue;
      }
      const f = b.feet;
      for (let i = 0; i + 2 < f.length; i += 3) {
        const g = groundM(f[i] ?? 0, f[i + 1] ?? 0);
        if (Number.isFinite(g) && g - FOOT_SINK_M / 2 < (f[i + 2] ?? 0)) {
          this.queue.push(b);
          queued = true;
          break;
        }
      }
    }
    if (queued) this.options.requestFrame();
    return queued;
  }

  /** Rebuilds everything on a new registry, shading and material (after the tweak panel rebuilt them). */
  retarget(registry: AssetRegistry, shading: TerrainShading, material: Material = this.material): void {
    this.registry = registry;
    this.shading = shading;
    this.material = material;
    for (const b of this.built.values()) this.queue.push(b);
    if (this.queue.length > 0) this.options.requestFrame();
  }

  /**
   * Piece keys whose proxies the view ray crosses on the layers in `mask`, nearest first (one hit per piece),
   * with the track height (m) of that piece where the ray crosses it.
   */
  pickProxies(ray: Ray, mask: number): { readonly key: string; readonly zM: number; readonly distance: number }[] {
    this.raycaster.ray.copy(ray);
    this.raycaster.layers.mask = mask;
    this.raycaster.far = Infinity;
    const hits = this.raycaster.intersectObjects(this.pickScene.children, false);
    const seen = new Set<string>();
    const out: { key: string; zM: number; distance: number }[] = [];
    for (const h of hits) {
      const u = h.object.userData as Partial<ProxyData>;
      if (!u.pieceKey || seen.has(u.pieceKey)) continue;
      seen.add(u.pieceKey);
      // The hit's plan position (world x, −z) projected onto the proxy's chord gives the track height there.
      const ex = (u.bx ?? 0) - (u.ax ?? 0);
      const ey = (u.by ?? 0) - (u.ay ?? 0);
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((h.point.x - (u.ax ?? 0)) * ex + (-h.point.z - (u.ay ?? 0)) * ey) / len2)) : 0;
      out.push({ key: u.pieceKey, zM: (u.za ?? 0) + ((u.zb ?? 0) - (u.za ?? 0)) * t, distance: h.distance });
    }
    return out;
  }

  /** Each built portal's frame and its wings as drawn (checks and e2e: the masonry's outline). */
  get portalOutlines(): readonly { readonly frame: PortalFrame; readonly wings: PortalWings }[] {
    const out: { frame: PortalFrame; wings: PortalWings }[] = [];
    for (const b of this.built.values()) for (const p of b.plugs) out.push({ frame: p.frame, wings: p.wings });
    return out;
  }

  /** The highest hill plug surface at sim plan (x, y), or NaN where no plug is; picking marches it with the terrain. */
  plugHeightAt(x: number, y: number): number {
    let best = Number.NaN;
    for (const b of this.built.values()) {
      for (const p of b.plugs) {
        if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
        const h = p.heightAt(x, y);
        if (!Number.isNaN(h) && !(h <= best)) best = h;
      }
    }
    return best;
  }

  /** Highest plug surface, for the ray march's box. */
  get plugTopZ(): number {
    let top = -Infinity;
    for (const b of this.built.values()) for (const p of b.plugs) top = Math.max(top, p.maxZ);
    return top;
  }

  dispose(): void {
    for (const b of this.built.values()) this.disposeRun(b);
    this.built.clear();
    this.queue = [];
    this.proxyGeometry.dispose();
    this.proxyMaterial.dispose();
    this.xrayRibbons.dispose();
    this.hiddenDecks.dispose();
    this.pickScene.clear();
    this.group.clear();
  }

  private syncAids(): void {
    this.bridgeGroup.visible = !this.decksHidden;
    this.hiddenDecks.group.visible = this.decksHidden && this.overlayHas("bridge");
    this.xrayRibbons.group.visible = this.xray && this.overlayHas("tunnel");
  }

  private overlayHas(kind: "bridge" | "tunnel"): boolean {
    return this.overlayKey.includes(`${kind}:`);
  }

  private applyRevision(network: NetworkView): boolean {
    let changed = false;
    const runs = structureRuns(network);
    const keys = new Set<string>();
    const wanted: QueuedRun[] = [];
    // Plan boxes of every piece, for the neighbour signature (piece keys never change their geometry).
    const live = new Set<string>();
    for (const p of network.pieces) {
      live.add(p.key);
      if (!this.boundsCache.has(p.key)) {
        const c = centrelineIndex(p);
        this.boundsCache.set(p.key, { minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY });
      }
    }
    for (const key of this.boundsCache.keys()) if (!live.has(key)) this.boundsCache.delete(key);
    for (const run of runs) {
      keys.add(run.key);
      wanted.push(this.signatureOf(run, network));
    }
    for (const [key, b] of this.built) {
      const w = wanted.find((x) => x.run.key === key);
      if (w && w.signature === b.signature) continue;
      this.disposeRun(b);
      this.built.delete(key);
      changed = true;
    }
    this.queue = wanted.filter((w) => !this.built.has(w.run.key));
    this.syncOverlays(network);
    return changed || this.queue.length > 0;
  }

  /**
   * A run's identity plus what its build reads: its ends and the other tracks near it (a bridge's piers and girders
   * keep clear of them; a tunnel's wings stop short of them and its plugs stay under their cuttings).
   */
  private signatureOf(run: StructureRun, network: NetworkView): QueuedRun {
    const ends = run.ends.join(",");
    const own = new Set(run.pieces.map((p) => p.piece.key));
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of run.pieces) {
      const b = this.boundsCache.get(p.piece.key);
      if (!b) continue;
      box.minX = Math.min(box.minX, b.minX);
      box.minY = Math.min(box.minY, b.minY);
      box.maxX = Math.max(box.maxX, b.maxX);
      box.maxY = Math.max(box.maxY, b.maxY);
    }
    const m = NEIGHBOUR_MARGIN_M;
    const near: string[] = [];
    for (const p of network.pieces) {
      if (own.has(p.key)) continue;
      const b = this.boundsCache.get(p.key);
      if (!b || b.maxX < box.minX - m || b.minX > box.maxX + m || b.maxY < box.minY - m || b.minY > box.maxY + m) continue;
      near.push(p.key);
    }
    near.sort();
    const portalEnds = this.portalEndsOf(run);
    return { run, signature: `${run.key}|${ends}|${portalEnds.join("")}|${near.join(";")}`, neighbours: near, portalEnds };
  }

  /** A tunnel run's ends that open to daylight now (the core's portal definition, over its effective ground). */
  private portalEndsOf(run: StructureRun): (0 | 1)[] {
    if (run.structure !== "tunnel") return [];
    return ([0, 1] as const).filter((end) => isPortalEnd(this.options.terrain, run, end, this.options.ground ?? null));
  }

  private buildRun(q: QueuedRun): void {
    const old = this.built.get(q.run.key);
    if (old) {
      this.disposeRun(old);
      this.built.delete(q.run.key);
    }
    this.built.set(q.run.key, q.run.structure === "bridge" ? this.buildBridge(q) : this.buildTunnel(q));
  }

  private groundM(x: number, y: number): number {
    const natural = naturalHeightM(this.options.terrain, this.lat, x, y);
    const drawn = this.options.groundM?.(x, y) ?? Number.NaN;
    return Number.isNaN(drawn) ? natural : Number.isNaN(natural) ? drawn : Math.min(natural, drawn);
  }

  private buildBridge(q: QueuedRun): BuiltRun {
    const { run } = q;
    const path = RunPath.ofRun(run.pieces);
    const neighbourKeys = new Set(q.neighbours);
    const others: number[] = [];
    for (const p of this.network?.pieces ?? []) {
      if (!neighbourKeys.has(p.key)) continue;
      const samples = sampleCentrelineEvery(p, OTHER_SAMPLE_M);
      const length = samples[samples.length - 1]?.sM ?? 0;
      for (const q of samples) others.push(q.x, q.y, (p.z0Mm + ((p.z1Mm - p.z0Mm) * (length > 0 ? q.sM / length : 0))) / 1000);
    }
    const water = this.options.water;
    const env: LayoutEnv = {
      groundM: (x, y) => this.groundM(x, y),
      wetAt: (x, y) => water.covers(x, y),
      waterLevelM: water.levelM,
      others: Float64Array.from(others),
    };
    const layout = layoutBridge(path, run.ends, env);
    const sink = new GeometrySink();
    const counts = { arch: 0, solid: 0, truss: 0, girder: 0, piers: 0, abutments: 0, portals: 0 };
    for (const span of layout.spans) {
      const length = span.b - span.a;
      let kind: string;
      let variant: number;
      let modelLength: number;
      if (span.type === "arch") {
        variant = archVariant(length, span.riseM, span.solidDepthM);
        modelLength = unpackArch(variant).lengthM;
        kind = ARCH_KIND;
        if (span.riseM > 0) counts.arch += 1;
        else counts.solid += 1;
      } else {
        variant = spanVariant(length);
        modelLength = variant / 10;
        kind = span.type === "truss" ? TRUSS_KIND : GIRDER_KIND;
        counts[span.type] += 1;
      }
      const asset = this.registry.get(kind, variant, 0);
      for (const g of Object.values(asset.slots)) if (g) bend(sink, g, path, span.a, 1, modelLength > 0 ? length / modelLength : 1);
    }
    const feet: number[] = [];
    const last = layout.supports.length - 1;
    layout.supports.forEach((support, i) => {
      if (support.kind === "portal" || support.buried) return;
      path.at(support.s, P);
      if (support.kind === "pier") {
        const height = P.z + support.topV - support.footZ;
        const asset = this.registry.get(PIER_KIND, pierVariant(height, support.wet), 0);
        // The template's height is whole decimetres: stand it so its top meets the seat exactly.
        const modelHeight = (pierVariant(height, support.wet) & 2047) / 10;
        for (const g of Object.values(asset.slots)) if (g) place(sink, g, { x: P.x, y: P.y, z: P.z + support.topV - modelHeight, tx: P.tx, ty: P.ty });
        counts.piers += 1;
      } else {
        const depth = P.z - support.footZ;
        const asset = this.registry.get(ABUTMENT_KIND, abutmentVariant(depth), 0);
        const dir = i === last ? -1 : 1;
        for (const g of Object.values(asset.slots)) if (g) place(sink, g, { x: P.x, y: P.y, z: P.z, tx: dir * P.tx, ty: dir * P.ty });
        counts.abutments += 1;
      }
      const f = support.footprint;
      for (let k = 0; k + 1 < f.length; k += 2) feet.push(f[k] ?? 0, f[k + 1] ?? 0, support.footZ);
    });
    const mesh = this.meshOf(sink, `bridge ${run.pieces.length} pieces`, this.bridgeGroup);
    let topZ = -Infinity;
    for (let i = 0; i < path.zs.length; i++) topZ = Math.max(topZ, (path.zs[i] ?? 0) + layout.topV);
    const proxies = run.pieces.map((rp) => this.proxiesFor(rp.piece, PICK_LAYER.DECK, -1.6, Math.max(layout.topV, PARAPET_TOP_V + 0.2), DECK_HALF_M + 0.3)).flat();
    return { ...q, mesh, plugs: [], plugGround: [], plugMeshes: [], proxies, layout, feet: Float64Array.from(feet), counts, triangles: sink.triangleCount, topZ };
  }

  private buildTunnel(q: QueuedRun): BuiltRun {
    const { run } = q;
    const path = RunPath.ofRun(run.pieces);
    const sink = new GeometrySink();
    const plugs: HillPlug[] = [];
    const plugMeshes: Mesh[] = [];
    const counts = { arch: 0, solid: 0, truss: 0, girder: 0, piers: 0, abutments: 0, portals: 0 };
    let topZ = -Infinity;
    const terrain = this.options.terrain;
    const drawn = this.options.groundM;
    // The ends that open to daylight, as signed (the core's portal definition, over its effective ground), each with
    // its frame.
    const portals = q.portalEnds.map((end) => {
      path.at(end === 0 ? 0 : path.lengthM, P);
      const dir = end === 0 ? 1 : -1;
      const frame: PortalFrame = { x: P.x, y: P.y, z: P.z, tx: dir * P.tx, ty: dir * P.ty };
      const node = run.nodes[end];
      const key = `${node.q},${node.r},${node.zMm}`;
      // Behind the face the plug reaches its backfill's reach and the approach's underlay notch (the 45° headwall's
      // cut the terrain mesh draws under it), at most PLUG_MAX_REACH_M.
      const notch = this.options.notchBox?.(key);
      let notchS = 0;
      if (notch) {
        for (const [x, y] of [
          [notch.minX, notch.minY],
          [notch.minX, notch.maxY],
          [notch.maxX, notch.minY],
          [notch.maxX, notch.maxY],
        ] as const) notchS = Math.max(notchS, (x - frame.x) * frame.tx + (y - frame.y) * frame.ty);
      }
      return { end, frame, key, notchS: Math.min(PLUG_MAX_REACH_M, notchS + 1) };
    });
    const except = portals.map((p) => p.key);
    // What a portal reads lies within this of its node; two portals whose squares meet share one set of readers.
    const radius = (p: (typeof portals)[number]) => Math.max(BACKFILL_REACH_S_M, BACKFILL_REACH_U_M, p.notchS, PORTAL_HALF_WIDTH_M + PORTAL_MAX_WING_M) + 2;
    const squares = portals.map((p) => ({ minX: p.frame.x - radius(p), minY: p.frame.y - radius(p), maxX: p.frame.x + radius(p), maxY: p.frame.y + radius(p) }));
    const a = squares[0];
    const b = squares[1];
    const shared = a !== undefined && b !== undefined && !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
    const groups = shared && a && b ? [{ box: { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }, members: [0, 1] }] : squares.map((box, i) => ({ box, members: [i] }));
    for (const group of groups) {
      const effectiveM = this.options.effectiveIn?.(group.box);
      const cutM = this.options.cutEnvelopeIn?.(group.box, except);
      const attributeM = this.options.attributeIn?.(group.box);
      const members = group.members.map((i) => {
        const p = portals[i] as (typeof portals)[number];
        const kind = run.ends[p.end];
        const approach: PortalApproach = kind === "ground" ? "ground" : kind === "bridge" ? "bridge" : "buffer";
        const f = p.frame;
        // The wings retain the hill as the other tracks' cuttings leave it (the approach's own is not).
        const wings = portalWings(terrain, f, approach, drawn ? (x, y) => drawn(x, y) : undefined, this.otherFormations(run, p.end, f.x, f.y), cutM);
        // The face reaches under the ground in front: a bridge or a low approach needs it deeper.
        const front = naturalHeightM(terrain, this.lat, f.x - f.tx * 3, f.y - f.ty * 3);
        const depth = approach === "ground" ? 1.5 : Math.min(12.7, Math.max(1.5, f.z - (Number.isNaN(front) ? f.z : front) + 1.2));
        const variant = portalVariant(wings.left, wings.right, depth, wings.steepLeft, wings.steepRight);
        const asset = this.registry.get(PORTAL_KIND, variant, 0);
        for (const g of Object.values(asset.slots)) if (g) place(sink, g, f);
        counts.portals += 1;
        // The wings as drawn (whole decimetres), so the plug's outline follows the masonry.
        const drawnWings = unpackPortal(variant);
        return { portal: p, wings: { left: drawnWings.wingLeftM, right: drawnWings.wingRightM, steepLeft: drawnWings.steepLeft, steepRight: drawnWings.steepRight } };
      });
      // A two-portal run's plugs meet at its middle, square to the track there (one surface, so the seam is exact).
      let split: { x: number; y: number; tx: number; ty: number } | undefined;
      if (members.length === 2) {
        path.at(path.lengthM / 2, P);
        split = { x: P.x, y: P.y, tx: P.tx, ty: P.ty };
      }
      const regions: PlugRegion[] = members.map((m, i) => {
        const longest = Math.max(m.wings.left, m.wings.right);
        const across = wingAcross(longest + (WING_PIER_ALONG_M[1] ?? 0)) + 1;
        return {
          portal: i,
          // In front of the face: the fill behind the splayed wings and the bank beyond their ends.
          sMin: -(PORTAL_WING_SPLAY_SIN * (longest + 1) + BACKFILL_REACH_U_M * PORTAL_WING_SPLAY_SIN + 1),
          sMax: Math.min(PLUG_MAX_REACH_M, Math.max(BACKFILL_REACH_S_M + 0.5, m.portal.notchS)),
          uMax: Math.max(BACKFILL_REACH_U_M + 0.5, NOTCH_HALF_WIDTH_M, across),
          // The end 0 portal keeps the side before the middle, the end 1 portal the side after it.
          ...(split ? { split: m.portal.end === 0 ? split : { x: split.x, y: split.y, tx: -split.tx, ty: -split.ty } } : {}),
        };
      });
      // The surface comes down to the drawn ground toward the regions' edges, so no plug is cut off at its box.
      const surface = new PlugSurface(
        terrain,
        members.map((m) => ({ frame: m.portal.frame, wings: m.wings })),
        { ...(drawn ? { drawnM: drawn } : {}), ...(effectiveM ? { effectiveM } : {}), ...(cutM ? { cutM } : {}), ...(attributeM ? { attributeM } : {}) },
        regions,
      );
      members.forEach((m, i) => {
        const f = m.portal.frame;
        const region = regions[i] as PlugRegion;
        const plug = new HillPlug(terrain, this.shading, surface, region);
        plugs.push(plug);
        const pm = this.plugMesh(plug);
        if (pm) plugMeshes.push(pm);
        topZ = Math.max(topZ, f.z + portalSkylineV(0) + 1, plug.maxZ);
      });
    }
    const mesh = this.meshOf(sink, `tunnel portals ${run.pieces.length} pieces`, this.tunnelGroup);
    const proxies = run.pieces.map((rp) => this.proxiesFor(rp.piece, PICK_LAYER.TUNNEL, -0.4, BORE_SPRING_V + BORE_HALF_M, BORE_HALF_M + 0.3)).flat();
    return { ...q, mesh, plugs, plugGround: plugs.map((p) => p.groundSignature()), plugMeshes, proxies, layout: undefined, feet: new Float64Array(0), counts, triangles: sink.triangleCount, topZ };
  }

  /**
   * Whether a point lies on another track's formation (within FORMATION_HALF_WIDTH_M + 0.5 m of its centreline), for
   * the tracks near a portal other than the run itself and the approach that meets it there: a wing wall stops short
   * of them (it ran onto a neighbour's track 10 m away, 2026-09-28).
   */
  private otherFormations(run: StructureRun, end: 0 | 1, x: number, y: number): (x: number, y: number) => boolean {
    const network = this.network;
    if (!network) return () => false;
    const node = run.nodes[end];
    const own = new Set(run.pieces.map((p) => p.piece.key));
    const at = new Set([...node.ports.a, ...node.ports.b].map((port) => network.pieces[port.piece]?.key));
    const reach = PORTAL_HALF_WIDTH_M + 30;
    const others = network.pieces
      .filter((p) => !own.has(p.key) && !at.has(p.key))
      .map((p) => centrelineIndex(p))
      .filter((c) => !(c.maxX < x - reach || c.minX > x + reach || c.maxY < y - reach || c.minY > y + reach));
    if (others.length === 0) return () => false;
    const near = { d: 0, s: 0 };
    const limit = FORMATION_HALF_WIDTH_M + 0.5;
    return (px, py) => others.some((c) => nearestOnCentreline(c, px, py, near).d < limit);
  }

  private meshOf(sink: GeometrySink, name: string, parent: Group): Mesh | undefined {
    if (sink.triangleCount === 0) return undefined;
    const mesh = new Mesh(sink.build(), this.material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    return mesh;
  }

  private plugMesh(plug: HillPlug): Mesh | undefined {
    const d = plug.data;
    if (d.triangleCount === 0) return undefined;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(d.positions, 3));
    g.setAttribute("normal", new BufferAttribute(d.normals, 3));
    g.setAttribute("color", new BufferAttribute(d.colors, 3));
    g.setAttribute(EARTHWORK_ATTRIBUTE, new BufferAttribute(d.earthwork, EARTHWORK_ITEM_SIZE));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new Mesh(g, this.options.plugMaterial);
    mesh.name = "hill plug";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.tunnelGroup.add(mesh);
    return mesh;
  }

  /** Box proxies along a piece on one pick layer: chords of at most PROXY_CHORD_M from `below` to `above` the track, `half` wide each side. */
  private proxiesFor(piece: NetworkPiece, layer: number, below: number, above: number, half: number): Mesh[] {
    const samples = sampleCentrelineEvery(piece, PROXY_CHORD_M);
    const length = samples[samples.length - 1]?.sM ?? 0;
    const out: Mesh[] = [];
    const m = new Matrix4();
    const axisX = new Vector3();
    const axisY = new Vector3(0, 1, 0);
    const axisZ = new Vector3();
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      if (!a || !b) continue;
      const za = (piece.z0Mm + ((piece.z1Mm - piece.z0Mm) * (length > 0 ? a.sM / length : 0))) / 1000;
      const zb = (piece.z0Mm + ((piece.z1Mm - piece.z0Mm) * (length > 0 ? b.sM / length : 0))) / 1000;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      // World: along (dx, 0, −dy), up, and across (right of travel) = along × up.
      axisX.set(dx / len, 0, -dy / len);
      axisZ.crossVectors(axisX, axisY);
      m.makeBasis(axisX, axisY, axisZ);
      m.scale(new Vector3(len, above - below, 2 * half));
      m.setPosition((a.x + b.x) / 2, (za + zb) / 2 + (above + below) / 2, -(a.y + b.y) / 2);
      const mesh = new Mesh(this.proxyGeometry, this.proxyMaterial);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      mesh.matrixWorld.copy(m);
      mesh.layers.set(layer);
      const data: ProxyData = { pieceKey: piece.key, ax: a.x, ay: a.y, bx: b.x, by: b.y, za, zb };
      Object.assign(mesh.userData, data);
      this.pickScene.add(mesh);
      out.push(mesh);
    }
    return out;
  }

  private disposeRun(b: BuiltRun): void {
    if (b.mesh) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
    }
    for (const m of b.plugMeshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    for (const p of b.proxies) p.removeFromParent();
  }

  /** The x-ray ribbons over every tunnel piece and the outlines of every deck, rebuilt when those pieces change. */
  private syncOverlays(network: NetworkView): void {
    const tunnels: NetworkPiece[] = [];
    const bridges: NetworkPiece[] = [];
    for (const p of network.pieces) {
      if (p.structure === "tunnel") tunnels.push(p);
      else if (p.structure === "bridge") bridges.push(p);
    }
    const key = `${tunnels.map((p) => `tunnel:${p.key}`).join(";")}|${bridges.map((p) => `bridge:${p.key}`).join(";")}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const line = (p: NetworkPiece) => ({ prims: p.prims, z0M: p.z0Mm / 1000, z1M: p.z1Mm / 1000 });
    const xray: RibbonPiece[] = [];
    for (const p of tunnels) {
      xray.push({ centreline: line(p), color: palette.xray, halfWidthM: 1.3 });
      for (const side of [1, -1]) xray.push({ centreline: line(p), color: palette.xray, halfWidthM: 0.14, offsetM: side * BORE_HALF_M, dash: [1.5, 1] });
    }
    this.xrayRibbons.set(xray);
    const decks: RibbonPiece[] = [];
    for (const p of bridges) {
      for (const side of [1, -1]) decks.push({ centreline: line(p), color: palette.xray, halfWidthM: 0.14, offsetM: side * DECK_HALF_M, dash: [2, 1.2] });
    }
    this.hiddenDecks.set(decks);
    this.syncAids();
  }
}
