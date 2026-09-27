import { BufferAttribute, BufferGeometry, CircleGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, type Camera } from "three";
import { toWorld } from "../../core/sim/api";
import { palette } from "../art/palette";
import { simToWorld } from "../coords";
import { RIBBON_LIFT_M } from "./ghostGeometry";

/**
 * The hover snap ring (issue #67 "Tool and input"): a screen-constant
 * billboard over the node the pointer or keyboard cursor snapped to, in the
 * snap green. Filled on an existing endpoint (the track continues from it),
 * hollow on a free lattice node, and with a turnout glyph (a fork) on
 * existing track, where a new track would leave the old one. It draws on top
 * of everything and never takes part in picking.
 */

export type SnapKind = "endpoint" | "track" | "node";

/** Outer radius on screen, CSS px. */
export const SNAP_RING_RADIUS_PX = 9;
/** Height above the node at which the ring floats, metres: 0.1 m over the ghost ribbon, so it clears rails and ghost (0.6 m). */
export const RING_LIFT_M = RIBBON_LIFT_M + 0.1;
const SNAP_ORDER = 20;

/** A fork glyph in the unit circle: a stem and two diverging legs, as thin quads (x right, y up). */
export function turnoutGlyph(): BufferGeometry {
  const w = 0.09;
  const bars: [number, number, number, number][] = [
    // x0, y0 → x1, y1
    [0, -0.55, 0, 0.05],
    [0, 0.05, 0, 0.55],
    [0, 0.05, 0.38, 0.5],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [x0, y0, x1, y1] of bars) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = (-(y1 - y0) / len) * w;
    const ny = ((x1 - x0) / len) * w;
    const base = pos.length / 3;
    pos.push(x0 - nx, y0 - ny, 0, x1 - nx, y1 - ny, 0, x1 + nx, y1 + ny, 0, x0 + nx, y0 + ny, 0);
    // Counter-clockwise seen from +z (the camera side of the billboard).
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

export class SnapRing {
  readonly group = new Group();
  private readonly material: MeshBasicMaterial;
  private readonly ring: Mesh;
  private readonly disc: Mesh;
  private readonly glyph: Mesh;
  private kind: SnapKind | null = null;

  constructor() {
    this.group.name = "snap ring";
    this.material = new MeshBasicMaterial({ color: palette.snap, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    this.ring = new Mesh(new RingGeometry(0.72, 1, 40), this.material);
    this.disc = new Mesh(new CircleGeometry(0.5, 32), this.material);
    this.glyph = new Mesh(turnoutGlyph(), this.material);
    for (const m of [this.ring, this.disc, this.glyph]) {
      m.renderOrder = SNAP_ORDER;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  get shownKind(): SnapKind | null {
    return this.kind;
  }

  /** Shows the ring at lattice node (q, r) at height `zMm`, or hides it for null. */
  set(snap: { readonly kind: SnapKind; readonly node: { readonly q: number; readonly r: number; readonly zMm: number } } | null): void {
    this.kind = snap?.kind ?? null;
    this.group.visible = snap !== null;
    if (!snap) return;
    const p = toWorld(snap.node);
    simToWorld(p.x, p.y, snap.node.zMm / 1000 + RING_LIFT_M, this.group.position);
    this.disc.visible = snap.kind === "endpoint";
    this.glyph.visible = snap.kind === "track";
  }

  /** Faces the camera at a constant screen size; call each frame while visible. */
  update(camera: Camera, ppm: number): void {
    if (!this.group.visible) return;
    this.group.quaternion.copy(camera.quaternion);
    this.group.scale.setScalar(SNAP_RING_RADIUS_PX / ppm);
  }

  dispose(): void {
    this.ring.geometry.dispose();
    this.disc.geometry.dispose();
    this.glyph.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
