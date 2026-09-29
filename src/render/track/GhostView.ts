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
import { type NetworkPiece, type NetworkView, type PieceKey, type PieceSpec, type Structure, pieceFromKey, resolvePiece } from "../../core/sim/api";
import { cssColor, palette } from "../art/palette";
import { type IsoView, worldToScreen } from "../camera/isoMath";
import { simToWorld } from "../coords";
import { type GhostCentreline, type RibbonPiece, buildRibbons, elevationMarks, heightTagText, heldEndLine } from "./ghostGeometry";
import type { TrackCentreline } from "./trackGeometry";

/**
 * The construction ghost and its relatives (art direction "Overlays and
 * construction feedback", issue #67 "Presentation"):
 * - `OverlayRibbons`: translucent ribbons drawn in two passes, depth-tested
 *   at one opacity and see-through (no depth test) at another, so a plan
 *   behind a hill or under a bridge still shows faintly;
 * - `GhostView`: the planned track, new `ghostValid` white, reused
 *   `ghostReused` cyan, invalid `ghostInvalid` red and dashed; an elevated
 *   ghost adds drop lines every 20 m and end-height tags; an end the 3.5 %
 *   limit holds off the ground adds its own drop line in `signalAmber`
 *   (the grade band's amber), drawn see-through too, so it shows inside a hill;
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

/**
 * A spec resolved to its centreline, marked `reversed` when the resolved piece's canonical direction runs from the
 * spec's far end back to its `from` (the ghost's end marks read it in travel order); undefined when it does not resolve.
 */
export function centrelineOfSpec(spec: PieceSpec): GhostCentreline | undefined {
  const res = resolvePiece(spec);
  if (!res.ok) return undefined;
  const [a, b] = res.piece.ends;
  const reversed = a.node.q !== spec.from.q || a.node.r !== spec.from.r || a.node.zMm !== spec.from.zMm;
  return { prims: res.piece.prims, z0M: a.node.zMm / 1000, z1M: b.node.zMm / 1000, reversed };
}

export function centrelineOfKey(key: PieceKey): TrackCentreline | undefined {
  const piece = pieceFromKey(key);
  return piece ? { prims: piece.prims, z0M: piece.ends[0].node.zMm / 1000, z1M: piece.ends[1].node.zMm / 1000 } : undefined;
}

/** What the ghost draws (the track tool's `GhostModel` has this shape). */
export interface GhostInput {
  readonly pieces: readonly { readonly spec: PieceSpec; readonly status: "new" | "reused"; readonly structure?: Structure }[];
  readonly valid: boolean;
  /** The 3.5 % limit holds the plan's end off the ground: draw the held-end drop line (owner decision 2026-09-28). */
  readonly endHeld?: boolean;
}

/** The held-end line's opacities: depth-tested, and see-through for the part inside a hill (a 1 px line at 0.5 did not read on the terrain; agent capture, 2026-09-29). */
export const HELD_DEPTH_OPACITY = 0.95;
export const HELD_THROUGH_OPACITY = 0.85;

/**
 * The ghost's structure marks (D4), in the piece's ghost colour: a bridge shows its deck's edges (solid
 * bands at the parapets' outer faces, ±3 m), a tunnel its bore (dashed bands at ±2.6 m, 1.2 m on and
 * 0.8 m off). They draw in their own two passes, stronger see-through than the ribbon's, so a tunnel's
 * outline reads through the hill it will run under.
 */
export const GHOST_DECK_EDGE_M = 3;
export const GHOST_BORE_EDGE_M = 2.6;
export const GHOST_MARK_HALF_M = 0.16;
export const GHOST_BORE_DASH: readonly [number, number] = [1.2, 0.8];

export function structureMarks(pieces: readonly { readonly centreline: TrackCentreline; readonly color: number; readonly structure: Structure }[]): RibbonPiece[] {
  const out: RibbonPiece[] = [];
  for (const p of pieces) {
    if (p.structure === "ground") continue;
    const edge = p.structure === "bridge" ? GHOST_DECK_EDGE_M : GHOST_BORE_EDGE_M;
    for (const side of [1, -1]) {
      out.push({
        centreline: p.centreline,
        color: p.color,
        halfWidthM: GHOST_MARK_HALF_M,
        offsetM: side * edge,
        ...(p.structure === "tunnel" ? { dash: GHOST_BORE_DASH } : {}),
      });
    }
  }
  return out;
}

const tagWorld = new Vector3();
const tagScreen = { x: 0, y: 0 };

export class GhostView {
  readonly group = new Group();
  private readonly ribbons = new OverlayRibbons("ghost ribbons");
  private readonly marks = new OverlayRibbons("ghost structure marks", 0.85, 0.55);
  private dropGeometry = new BufferGeometry();
  private readonly dropMaterial: LineBasicMaterial;
  private readonly drops: LineSegments;
  private heldGeometry = new BufferGeometry();
  private readonly heldMaterials: readonly [LineBasicMaterial, LineBasicMaterial];
  /** The held-end line: the see-through pass, then the depth-tested one over it. */
  private readonly heldLines: readonly [LineSegments, LineSegments];
  private endHeld = false;
  private readonly tags: HTMLDivElement[];
  private readonly tagAnchors: Vector3[] = [new Vector3(), new Vector3()];
  /** Each tag's last written CSS px position; NaN forces the next write. */
  private readonly tagPx: { x: number; y: number }[] = [
    { x: Number.NaN, y: Number.NaN },
    { x: Number.NaN, y: Number.NaN },
  ];
  private tagsShown = false;
  /** The centrelines the ghost shows, kept so its elevation marks can be measured again (`refreshGround`). */
  private lines: readonly GhostCentreline[] = [];

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
    const held = { color: palette.signalAmber, transparent: true, depthWrite: false, toneMapped: false } as const;
    this.heldMaterials = [
      new LineBasicMaterial({ ...held, opacity: HELD_THROUGH_OPACITY, depthTest: false }),
      new LineBasicMaterial({ ...held, opacity: HELD_DEPTH_OPACITY, depthTest: true }),
    ];
    this.heldLines = [new LineSegments(this.heldGeometry, this.heldMaterials[0]), new LineSegments(this.heldGeometry, this.heldMaterials[1])];
    this.heldLines.forEach((line, i) => {
      line.name = i === 0 ? "ghost held end (through)" : "ghost held end";
      // Over the white drop line an elevated end already has at the same place.
      line.renderOrder = i === 0 ? THROUGH_ORDER : DEPTH_ORDER + 1;
      line.frustumCulled = false;
      line.visible = false;
    });
    this.group.add(this.ribbons.group, this.drops, this.marks.group, ...this.heldLines);
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

  /** Whether structure marks show (a bridge's deck edges or a tunnel's bore), for checks. */
  get marksVisible(): boolean {
    return this.marks.group.visible;
  }

  /** Whether the held-end drop line shows (the 3.5 % limit holds a Straight line's end off the ground), for checks. */
  get heldVisible(): boolean {
    return this.heldLines[1].visible;
  }

  /** Shows a plan, or hides the ghost for null. */
  set(ghost: GhostInput | null): void {
    const pieces: RibbonPiece[] = [];
    const lines: GhostCentreline[] = [];
    const structured: { centreline: TrackCentreline; color: number; structure: Structure }[] = [];
    if (ghost) {
      for (const p of ghost.pieces) {
        const c = centrelineOfSpec(p.spec);
        if (!c) continue;
        lines.push(c);
        const color = !ghost.valid ? palette.ghostInvalid : p.status === "reused" ? palette.ghostReused : palette.ghostValid;
        pieces.push({ centreline: c, color });
        structured.push({ centreline: c, color, structure: p.structure ?? "ground" });
      }
    }
    this.ribbons.set(pieces, ghost !== null && !ghost.valid);
    this.marks.set(structureMarks(structured));
    this.lines = lines;
    this.endHeld = ghost?.endHeld === true;
    this.measure();
  }

  /**
   * Measures the drop lines and end-height tags again on the ghost's centrelines, against the ground as it is drawn
   * now; returns false when no ghost shows. The app calls it when the earthworks finish drawing a revision: a
   * commit sets the chained ghost before the time-sliced conform lands, so its marks measured the ground from before
   * the build, and a ghost whose plan did not change was never measured again (PR #83 re-review).
   */
  refreshGround(): boolean {
    if (this.lines.length === 0) return false;
    this.measure();
    return true;
  }

  private measure(): void {
    const marks = elevationMarks(this.lines, this.groundM);
    const old = this.dropGeometry;
    this.dropGeometry = new BufferGeometry();
    if (marks.dropLines.length > 0) this.dropGeometry.setAttribute("position", new BufferAttribute(marks.dropLines, 3));
    this.drops.geometry = this.dropGeometry;
    old.dispose();
    this.drops.visible = marks.dropLines.length > 0;
    const heldLine = this.endHeld ? heldEndLine(this.lines, this.groundM) : new Float32Array(0);
    const oldHeld = this.heldGeometry;
    this.heldGeometry = new BufferGeometry();
    if (heldLine.length > 0) this.heldGeometry.setAttribute("position", new BufferAttribute(heldLine, 3));
    for (const line of this.heldLines) {
      line.geometry = this.heldGeometry;
      line.visible = heldLine.length > 0;
    }
    oldHeld.dispose();
    this.tagsShown = marks.elevated && marks.ends.length === 2;
    marks.ends.forEach((end, i) => {
      const el = this.tags[i];
      const anchor = this.tagAnchors[i];
      const px = this.tagPx[i];
      if (!el || !anchor || !px) return;
      el.textContent = heightTagText(end.aboveM);
      simToWorld(end.x, end.y, end.z, anchor);
      px.x = Number.NaN;
      px.y = Number.NaN;
    });
    for (const el of this.tags) el.style.display = this.tagsShown ? "block" : "none";
  }

  /**
   * Places the end-height tags over the ghost's ends: call after `set` and
   * when the view moved. A tag's style is written (and its string built) only
   * when its rounded screen position changed, so an unchanged view costs two
   * projections and no allocation (render guide "Frame loop").
   */
  updateTags(view: IsoView): void {
    if (!this.tagsShown) return;
    for (let i = 0; i < this.tags.length; i++) {
      const el = this.tags[i];
      const anchor = this.tagAnchors[i];
      const px = this.tagPx[i];
      if (!el || !anchor || !px) continue;
      tagWorld.copy(anchor);
      tagWorld.y += 1.2;
      worldToScreen(view, tagWorld, tagScreen);
      const x = Math.round(tagScreen.x);
      const y = Math.round(tagScreen.y);
      if (x === px.x && y === px.y) continue;
      px.x = x;
      px.y = y;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  dispose(): void {
    this.ribbons.dispose();
    this.marks.dispose();
    this.dropGeometry.dispose();
    this.dropMaterial.dispose();
    this.heldGeometry.dispose();
    for (const m of this.heldMaterials) m.dispose();
    for (const el of this.tags) el.remove();
    this.group.clear();
  }
}

/** Pieces by key, built once per network revision (a `NetworkView` is the same object until the revision changes). */
const piecesByKey = new WeakMap<NetworkView, ReadonlyMap<PieceKey, NetworkPiece>>();

function pieceIndex(network: NetworkView): ReadonlyMap<PieceKey, NetworkPiece> {
  let index = piecesByKey.get(network);
  if (!index) {
    index = new Map(network.pieces.map((p) => [p.key, p]));
    piecesByKey.set(network, index);
  }
  return index;
}

/** Existing pieces the current rejection names, in red. */
export class HighlightView {
  readonly ribbons = new OverlayRibbons("rejection highlight");
  private keys: readonly PieceKey[] = [];
  private rev = -1;

  get group(): Group {
    return this.ribbons.group;
  }

  /**
   * Shows the pieces `keys` names in `network`. The tool sends this on every
   * re-plan, mostly with no keys, so an empty set while nothing shows, or the
   * same keys against the same revision, does no work.
   */
  set(keys: readonly PieceKey[], network: NetworkView): void {
    if (keys.length === 0 && this.keys.length === 0) return;
    if (network.rev === this.rev && sameKeys(keys, this.keys)) return;
    this.keys = keys;
    this.rev = network.rev;
    const known = pieceIndex(network);
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

function sameKeys(a: readonly PieceKey[], b: readonly PieceKey[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
