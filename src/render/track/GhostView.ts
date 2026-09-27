import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { type NetworkView, type PieceKey, type PieceSpec, pieceFromKey, resolvePiece } from "../../core/sim/api";
import { cssColor, palette } from "../art/palette";
import { type IsoView, worldToScreen } from "../camera/isoMath";
import { simToWorld } from "../coords";
import { type RibbonPiece, buildRibbons, elevationMarks, heightTagText } from "./ghostGeometry";
import type { TrackCentreline } from "./trackGeometry";

/**
 * The construction ghost and its relatives (art direction "Overlays and
 * construction feedback", issue #67 "Presentation"):
 * - `OverlayRibbons`: translucent ribbons drawn in two passes, depth-tested
 *   at one opacity and see-through (no depth test) at another, so a plan
 *   behind a hill or under a bridge still shows faintly;
 * - `GhostView`: the planned track, new `ghostValid` white, reused
 *   `ghostReused` cyan, invalid `ghostInvalid` red and dashed; an elevated
 *   ghost adds drop lines every 20 m and end-height tags;
 * - `HighlightView`: existing pieces a rejection names, in red;
 * - `FlashView`: the pieces an undo or redo changed, for 400 ms.
 * All colours are palette tokens; materials skip tone mapping so the
 * information colours read as specified.
 */

export const GHOST_DEPTH_OPACITY = 0.7;
export const GHOST_THROUGH_OPACITY = 0.2;
/** Undo/redo flash length. */
export const FLASH_MS = 400;

/** Draw after the world and the track; the see-through pass first, the depth-tested pass over it. */
const THROUGH_ORDER = 10;
const DEPTH_ORDER = 11;

export class OverlayRibbons {
  readonly group = new Group();
  private geometry = new BufferGeometry();
  private readonly meshes: Mesh[];
  readonly depthMaterial: MeshBasicMaterial;
  readonly throughMaterial: MeshBasicMaterial;

  constructor(name: string, depthOpacity = GHOST_DEPTH_OPACITY, throughOpacity = GHOST_THROUGH_OPACITY) {
    this.group.name = name;
    const common = { vertexColors: true, transparent: true, depthWrite: false, toneMapped: false } as const;
    this.depthMaterial = new MeshBasicMaterial({ ...common, opacity: depthOpacity, depthTest: true });
    this.throughMaterial = new MeshBasicMaterial({ ...common, opacity: throughOpacity, depthTest: false });
    const through = new Mesh(this.geometry, this.throughMaterial);
    through.renderOrder = THROUGH_ORDER;
    const depth = new Mesh(this.geometry, this.depthMaterial);
    depth.renderOrder = DEPTH_ORDER;
    this.meshes = [through, depth];
    for (const m of this.meshes) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /**
   * Replaces the ribbons; an empty list hides them. Each change gets a fresh
   * geometry and disposes the old one, so its GPU buffers are freed (three
   * frees buffers on geometry disposal, not when an attribute is swapped).
   */
  set(pieces: readonly RibbonPiece[], dashed = false): void {
    const data = buildRibbons(pieces, dashed);
    const old = this.geometry;
    const geometry = new BufferGeometry();
    if (data.vertexCount > 0) {
      geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
      geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
      geometry.setIndex(new BufferAttribute(data.indices, 1));
    }
    this.geometry = geometry;
    for (const m of this.meshes) m.geometry = geometry;
    old.dispose();
    this.group.visible = data.vertexCount > 0;
  }

  clear(): void {
    this.set([]);
  }

  setOpacity(depth: number, through: number): void {
    this.depthMaterial.opacity = depth;
    this.throughMaterial.opacity = through;
  }

  dispose(): void {
    this.geometry.dispose();
    this.depthMaterial.dispose();
    this.throughMaterial.dispose();
    this.group.clear();
  }
}

/** A spec or key resolved to its centreline; undefined when it does not resolve. */
export function centrelineOfSpec(spec: PieceSpec): TrackCentreline | undefined {
  const res = resolvePiece(spec);
  if (!res.ok) return undefined;
  return { prims: res.piece.prims, z0M: res.piece.ends[0].node.zMm / 1000, z1M: res.piece.ends[1].node.zMm / 1000 };
}

export function centrelineOfKey(key: PieceKey): TrackCentreline | undefined {
  const piece = pieceFromKey(key);
  return piece ? { prims: piece.prims, z0M: piece.ends[0].node.zMm / 1000, z1M: piece.ends[1].node.zMm / 1000 } : undefined;
}

/** What the ghost draws (the track tool's `GhostModel` has this shape). */
export interface GhostInput {
  readonly pieces: readonly { readonly spec: PieceSpec; readonly status: "new" | "reused" }[];
  readonly valid: boolean;
}

const tagWorld = new Vector3();
const tagScreen = { x: 0, y: 0 };

export class GhostView {
  readonly group = new Group();
  private readonly ribbons = new OverlayRibbons("ghost ribbons");
  private dropGeometry = new BufferGeometry();
  private readonly dropMaterial: LineBasicMaterial;
  private readonly drops: LineSegments;
  private readonly tags: HTMLDivElement[];
  private readonly tagAnchors: Vector3[] = [new Vector3(), new Vector3()];
  private tagsShown = false;

  constructor(
    tagParent: HTMLElement,
    private readonly groundM: (x: number, y: number) => number | undefined,
  ) {
    this.group.name = "ghost";
    this.dropMaterial = new LineBasicMaterial({
      color: palette.ghostValid,
      transparent: true,
      opacity: GHOST_DEPTH_OPACITY,
      depthWrite: false,
      toneMapped: false,
    });
    this.drops = new LineSegments(this.dropGeometry, this.dropMaterial);
    this.drops.renderOrder = DEPTH_ORDER;
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    this.group.add(this.ribbons.group, this.drops);
    this.tags = [0, 1].map(() => {
      const el = document.createElement("div");
      el.setAttribute("aria-hidden", "true");
      el.className = "ghost-height-tag";
      Object.assign(el.style, {
        position: "absolute",
        left: "0",
        top: "0",
        display: "none",
        padding: "1px 5px",
        font: "600 11px/1.3 system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
        color: cssColor(palette.uiInk),
        background: cssColor(palette.uiParchment),
        border: `1px solid ${cssColor(palette.uiBorder)}`,
        borderRadius: "3px",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        zIndex: "4",
        willChange: "transform",
      } satisfies Partial<CSSStyleDeclaration>);
      tagParent.appendChild(el);
      return el;
    });
  }

  get visible(): boolean {
    return this.ribbons.group.visible;
  }

  /** Shows a plan, or hides the ghost for null. */
  set(ghost: GhostInput | null): void {
    const pieces: RibbonPiece[] = [];
    const lines: TrackCentreline[] = [];
    if (ghost) {
      for (const p of ghost.pieces) {
        const c = centrelineOfSpec(p.spec);
        if (!c) continue;
        lines.push(c);
        pieces.push({
          centreline: c,
          color: !ghost.valid ? palette.ghostInvalid : p.status === "reused" ? palette.ghostReused : palette.ghostValid,
        });
      }
    }
    this.ribbons.set(pieces, ghost !== null && !ghost.valid);
    const marks = elevationMarks(lines, this.groundM);
    const old = this.dropGeometry;
    this.dropGeometry = new BufferGeometry();
    if (marks.dropLines.length > 0) this.dropGeometry.setAttribute("position", new BufferAttribute(marks.dropLines, 3));
    this.drops.geometry = this.dropGeometry;
    old.dispose();
    this.drops.visible = marks.dropLines.length > 0;
    this.tagsShown = marks.elevated && marks.ends.length === 2;
    marks.ends.forEach((end, i) => {
      const el = this.tags[i];
      const anchor = this.tagAnchors[i];
      if (!el || !anchor) return;
      el.textContent = heightTagText(end.aboveM);
      simToWorld(end.x, end.y, end.z, anchor);
    });
    for (const el of this.tags) el.style.display = this.tagsShown ? "block" : "none";
  }

  /** Places the end-height tags over the ghost's ends; call after the camera moved while the ghost shows. */
  updateTags(view: IsoView): void {
    if (!this.tagsShown) return;
    for (let i = 0; i < this.tags.length; i++) {
      const el = this.tags[i];
      const anchor = this.tagAnchors[i];
      if (!el || !anchor) continue;
      tagWorld.copy(anchor);
      tagWorld.y += 1.2;
      worldToScreen(view, tagWorld, tagScreen);
      el.style.transform = `translate(${Math.round(tagScreen.x)}px, ${Math.round(tagScreen.y)}px) translate(-50%, -100%)`;
    }
  }

  dispose(): void {
    this.ribbons.dispose();
    this.dropGeometry.dispose();
    this.dropMaterial.dispose();
    for (const el of this.tags) el.remove();
    this.group.clear();
  }
}

/** Existing pieces the current rejection names, in red. */
export class HighlightView {
  readonly ribbons = new OverlayRibbons("rejection highlight");

  get group(): Group {
    return this.ribbons.group;
  }

  set(keys: readonly PieceKey[], network: NetworkView): void {
    const known = new Map(network.pieces.map((p) => [p.key, p]));
    const pieces: RibbonPiece[] = [];
    for (const key of keys) {
      const p = known.get(key);
      if (p) pieces.push({ centreline: { prims: p.prims, z0M: p.z0Mm / 1000, z1M: p.z1Mm / 1000 }, color: palette.ghostInvalid });
    }
    this.ribbons.set(pieces);
  }

  dispose(): void {
    this.ribbons.dispose();
  }
}

/**
 * The 400 ms flash after an undo or redo: added pieces in the snap green,
 * removed ones in red where they were. It fades out, or holds and then
 * vanishes under reduced motion. `update` returns true while it runs, so the
 * app keeps asking for frames.
 */
export class FlashView {
  readonly ribbons = new OverlayRibbons("undo flash", 0.85, 0.35);
  private startMs: number | undefined;
  private active = false;

  constructor(private readonly reducedMotion: () => boolean) {}

  get group(): Group {
    return this.ribbons.group;
  }

  flash(added: readonly PieceKey[], removed: readonly PieceKey[]): void {
    const pieces: RibbonPiece[] = [];
    for (const [keys, color] of [
      [added, palette.snap],
      [removed, palette.ghostInvalid],
    ] as const) {
      for (const key of keys) {
        const c = centrelineOfKey(key);
        if (c) pieces.push({ centreline: c, color });
      }
    }
    this.ribbons.set(pieces);
    this.ribbons.setOpacity(0.85, 0.35);
    this.startMs = undefined;
    this.active = pieces.length > 0;
  }

  update(nowMs: number): boolean {
    if (!this.active) return false;
    if (this.startMs === undefined) this.startMs = nowMs;
    const t = (nowMs - this.startMs) / FLASH_MS;
    if (t >= 1) {
      this.active = false;
      this.ribbons.clear();
      return false;
    }
    const k = this.reducedMotion() ? 1 : 1 - t;
    this.ribbons.setOpacity(0.85 * k, 0.35 * k);
    return true;
  }

  dispose(): void {
    this.ribbons.dispose();
  }
}
