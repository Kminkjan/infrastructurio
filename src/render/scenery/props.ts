import { Color, Group, InstancedMesh, type Material, Matrix4, Quaternion, Vector3 } from "three";
import type { DioramaScenery, Terrain } from "../../core/sim/api";
import type { AssetData, AssetLod, AssetRegistry } from "../art/AssetRegistry";
import { palette } from "../art/palette";
import { simToWorld } from "../coords";
import { sampleTerrainHeightM } from "../terrain/heightfieldRay";
import { type ClearableLayer, commitClearedMeshes, writeClearedInstance } from "./clearance";
import { MeshBuilder } from "./meshBuilder";
import { planYaw } from "./placement";

/**
 * Props (art direction "Trees and scenery"): telegraph poles every 50 m along
 * one road, street lamps, fence panels and haystacks, each one `InstancedMesh`
 * for the whole map (a handful of draws). Poles turn their cross-arm across
 * the line; fence runs are cut into equal panels about 2.5 m long.
 */

export const PROP_KINDS = ["telegraph-pole", "lamp", "fence-panel", "haystack"] as const;
export type PropKind = (typeof PROP_KINDS)[number];
export const PROP_BUDGET = 80;
/** Nominal fence panel length; runs are split into whole panels and stretched to fit. */
export const FENCE_PANEL_M = 2.5;

function telegraphPole(): MeshBuilder {
  const b = new MeshBuilder().ao({ floor: 0.75, heightM: 1.5 });
  b.color(palette.timberDark).prism({ x: 0, z: 0, y0: -0.3, y1: 7.2, radius: 0.13, radiusTop: 0.09, sides: 5 });
  // Cross-arm across the line (model Z), with four white insulators.
  b.color(palette.timber).box({ x: 0, z: 0, y0: 6.55, y1: 6.7, sx: 0.12, sz: 1.5 });
  b.color(palette.limeWhite);
  for (const z of [-0.6, -0.2, 0.2, 0.6]) b.prism({ x: 0, z, y0: 6.7, y1: 6.86, radius: 0.045, sides: 3 });
  return b;
}

function lamp(): MeshBuilder {
  const b = new MeshBuilder().ao({ floor: 0.8, heightM: 1 });
  b.color(palette.loco).prism({ x: 0, z: 0, y0: -0.2, y1: 3.4, radius: 0.07, sides: 5 });
  b.color(palette.rock).prism({ x: 0, z: 0, y0: -0.2, y1: 0.35, radius: 0.16, sides: 5 });
  // The lantern: a pale glass box under a small dark cap.
  b.color(palette.creamPanel).box({ x: 0, z: 0, y0: 3.4, y1: 3.85, sx: 0.32, sz: 0.32 });
  b.color(palette.loco).cone({ x: 0, z: 0, y0: 3.85, y1: 4.1, radius: 0.28, sides: 4, phase: Math.PI / 4, bottom: true });
  return b;
}

/** One panel from x = 0 to FENCE_PANEL_M: a post at the start and two rails (the next panel supplies the far post). */
function fencePanel(): MeshBuilder {
  const b = new MeshBuilder().ao({ floor: 0.8, heightM: 1 });
  b.color(palette.timber).box({ x: 0.05, z: 0, y0: -0.2, y1: 1.15, sx: 0.12, sz: 0.12 });
  b.color(palette.timberDark);
  for (const y of [0.45, 0.9]) b.box({ x: FENCE_PANEL_M / 2, z: 0, y0: y, y1: y + 0.1, sx: FENCE_PANEL_M, sz: 0.06 });
  return b;
}

function haystack(): MeshBuilder {
  const b = new MeshBuilder().ao({ floor: 0.7, heightM: 2 });
  b.color(palette.hay).prism({ x: 0, z: 0, y0: -0.2, y1: 1.3, radius: 1.5, radiusTop: 1.65, sides: 8, top: false });
  b.cone({ x: 0, z: 0, y0: 1.3, y1: 3.4, radius: 1.65, sides: 8 });
  return b;
}

const BUILDERS: Readonly<Record<PropKind, () => MeshBuilder>> = {
  "telegraph-pole": telegraphPole,
  lamp,
  "fence-panel": fencePanel,
  haystack,
};

export function buildProp(kind: PropKind): MeshBuilder {
  return BUILDERS[kind]();
}

export function registerPropAssets(registry: AssetRegistry): void {
  for (const kind of PROP_KINDS) {
    registry.register(kind, (_variant: number, _lod: AssetLod): AssetData => ({
      slots: { trim: buildProp(kind).build() },
      anchors: {},
      footprint: [
        [0.5, 0.5],
        [0.5, -0.5],
        [-0.5, -0.5],
        [-0.5, 0.5],
      ],
      triangleBudget: PROP_BUDGET,
    }));
  }
}

/** One prop instance: sim plan position (m), yaw about +Y, length stretch along X and uniform scale. */
export interface PropPlacement {
  readonly xM: number;
  readonly yM: number;
  readonly yaw: number;
  readonly stretch: number;
  readonly scale: number;
}

/** Placements for every prop in a scenery layout, per kind. Pure, so it can be tested without WebGL. */
export function propPlacements(s: DioramaScenery): Record<PropKind, PropPlacement[]> {
  const out: Record<PropKind, PropPlacement[]> = { "telegraph-pole": [], lamp: [], "fence-panel": [], haystack: [] };
  for (const pole of s.telegraphPoles) {
    out["telegraph-pole"].push({ xM: pole.xMm / 1000, yM: pole.yMm / 1000, yaw: planYaw(pole.dirX, pole.dirY), stretch: 1, scale: 1 });
  }
  for (const p of s.lamps) out.lamp.push({ xM: p.xMm / 1000, yM: p.yMm / 1000, yaw: 0, stretch: 1, scale: 1 });
  for (const run of s.fences) {
    const x0 = run.from.xMm / 1000;
    const y0 = run.from.yMm / 1000;
    const dx = run.to.xMm / 1000 - x0;
    const dy = run.to.yMm / 1000 - y0;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;
    const panels = Math.max(1, Math.round(length / FENCE_PANEL_M));
    const yaw = planYaw(dx, dy);
    for (let k = 0; k < panels; k++) {
      out["fence-panel"].push({ xM: x0 + (dx * k) / panels, yM: y0 + (dy * k) / panels, yaw, stretch: length / panels / FENCE_PANEL_M, scale: 1 });
    }
  }
  for (const h of s.haystacks) {
    out.haystack.push({ xM: h.xMm / 1000, yM: h.yMm / 1000, yaw: ((h.seed & 0xffff) / 65536) * 2 * Math.PI, stretch: 1, scale: 0.8 + ((h.seed >>> 16) & 0xff) / 640 });
  }
  return out;
}

/** All props as one `InstancedMesh` per kind. */
export class PropLayer implements ClearableLayer {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  /** Every placed prop in kind order, with its mesh and instance, for earthworks clearing. */
  private readonly placed: { readonly xM: number; readonly yM: number; readonly mesh: InstancedMesh; readonly k: number }[] = [];
  /** Per placed prop: its placed instance matrix (16 floats), to restore after earthworks clear it. */
  private readonly matrices: Float32Array;
  private readonly cleared: Uint8Array;
  private readonly dirty = new Set<InstancedMesh>();

  constructor(scenery: DioramaScenery, terrain: Terrain, registry: AssetRegistry, material: Material) {
    this.group.name = "props";
    const placements = propPlacements(scenery);
    this.matrices = new Float32Array(16 * PROP_KINDS.reduce((n, kind) => n + placements[kind].length, 0));
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const tint = new Color();
    for (const kind of PROP_KINDS) {
      const list = placements[kind];
      const geometry = registry.get(kind, 0, 0).slots.trim;
      if (list.length === 0 || !geometry) continue;
      const mesh = new InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => {
        const h = sampleTerrainHeightM(terrain, p.xM, p.yM) ?? terrain.waterLevelDm / 10;
        simToWorld(p.xM, p.yM, h, position);
        rotation.setFromAxisAngle(up, p.yaw);
        scale.set(p.stretch * p.scale, p.scale, p.scale);
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
        matrix.toArray(this.matrices, 16 * this.placed.length);
        this.placed.push({ xM: p.xM, yM: p.yM, mesh, k: i });
        if (kind === "haystack") mesh.setColorAt(i, tint.setScalar(0.92 + 0.16 * (((i * 2654435761) >>> 24) / 255)));
      });
      mesh.name = `props ${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.cleared = new Uint8Array(this.placed.length);
  }

  get clearableCount(): number {
    return this.placed.length;
  }

  clearablePosition(i: number, out: { x: number; y: number }): void {
    const p = this.placed[i];
    out.x = p?.xM ?? 0;
    out.y = p?.yM ?? 0;
  }

  /** Hides (or restores) prop `i` where earthworks clear the ground; see `TreeLayer.setCleared`. */
  setCleared(i: number, cleared: boolean): boolean {
    const p = this.placed[i];
    if (!p || (this.cleared[i] === 1) === cleared) return false;
    this.cleared[i] = cleared ? 1 : 0;
    writeClearedInstance(p.mesh, p.k, this.matrices, 16 * i, cleared);
    this.dirty.add(p.mesh);
    return true;
  }

  commitCleared(): void {
    commitClearedMeshes(this.dirty);
  }

  isCleared(i: number): boolean {
    return this.cleared[i] === 1;
  }

  get instanceCount(): number {
    return this.meshes.reduce((n, m) => n + m.count, 0);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
