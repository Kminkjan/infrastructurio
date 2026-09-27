import { Vector3 } from "three";
import type { Command, Diff, Drag, NodeRef, Result, Sim, Terrain, TrackPlan } from "../core/sim/api";
import { heightDmAt, toWorld } from "../core/sim/api";
import type { CameraController } from "../render/camera/CameraController";
import type { IsoCamera } from "../render/camera/IsoCamera";
import { worldToScreen } from "../render/camera/isoMath";
import { simToWorld } from "../render/coords";
import type { FrameReason } from "../render/core/FrameScheduler";
import { RingBuffer, p95 } from "../render/core/perfStats";
import type { LatticeOverlay } from "../render/terrain/latticeMaterial";
import type { FlashView, GhostView, HighlightView } from "../render/track/GhostView";
import type { SnapRing } from "../render/track/SnapRing";
import { type PreviewMemo, createPreviewMemo } from "../tools/previewMemo";
import { type TrackToolState, initialTrackState, reduceTrackTool } from "../tools/trackTool";
import type { ToolCtx, ToolEffect, ToolEvent, ToolSettings, TooltipModel } from "../tools/types";
import type { HudStore, HudTool } from "../ui/store";

/**
 * The construction side of the composition root: the active tool's state,
 * the interpreter for its effects, and the single command gateway
 * (architecture "Tools": tools never call `execute`; effects are data the app
 * interprets). Undo and redo run through the same gateway with a toast and a
 * 400 ms flash of the pieces they changed. Every `sim.preview` the tool asks
 * for goes through the revision-keyed LRU and is timed here, so the preview
 * p95 can be read (a p95 over 8 ms is the trigger for a sim-in-Worker ADR).
 */

/** One elevation step: 1 m (a tool default for the owner's feel check, not a sim rule). */
export const HEIGHT_STEP_MM = 1000;
/** The keyboard cursor keeps this far inside the viewport, CSS px. */
const CURSOR_MARGIN_PX = 80;
/** How long a toast stays in the store (its CSS fade lasts as long). */
const TOAST_MS = 2600;
const PREVIEW_SAMPLES = 512;

export interface ConstructionDeps {
  readonly sim: Sim;
  readonly terrain: Terrain;
  readonly store: HudStore;
  readonly ghost: GhostView;
  readonly highlight: HighlightView;
  readonly flash: FlashView;
  readonly snap: SnapRing;
  readonly lattice: LatticeOverlay;
  readonly camera: IsoCamera;
  readonly controller: CameraController;
  readonly canvas: HTMLCanvasElement;
  /** The HUD mount, where the tooltip's `--hud-pointer-x/y` live. */
  readonly hud: HTMLElement;
  readonly requestFrame: (reason: FrameReason) => void;
  readonly now: () => number;
  /** Precision currently held (the router tracks the keys), sent to the tool on activation. */
  readonly precisionHeld: () => boolean;
}

export interface PreviewStats {
  /** Timed `sim.preview` calls (memo misses). */
  readonly calls: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly memoHits: number;
  readonly memoMisses: number;
  /** `sim.planTrack` calls (every re-plan, not memoized), timed the same way. */
  readonly planCalls: number;
  readonly planP95Ms: number;
  readonly planMaxMs: number;
}

const scratchWorld = new Vector3();
const scratchScreen = { x: 0, y: 0 };

export class Construction {
  private tool: HudTool = "select";
  private state: TrackToolState = initialTrackState();
  private readonly queue: ToolEvent[] = [];
  private dispatching = false;
  private readonly memo: PreviewMemo;
  private readonly samples = new RingBuffer(PREVIEW_SAMPLES);
  private readonly scratch = new Float64Array(PREVIEW_SAMPLES);
  private previewCalls = 0;
  private previewMax = 0;
  private readonly planSamples = new RingBuffer(PREVIEW_SAMPLES);
  private planCalls = 0;
  private planMax = 0;
  private toastId = 0;
  private toastTimer: number | undefined;
  private tooltipAnchor: NodeRef | null = null;
  private readonly settings: ToolSettings = { heightStepMm: HEIGHT_STEP_MM, radiusCapM: undefined };

  constructor(private readonly d: ConstructionDeps) {
    const { sim } = d;
    const timed = (cmd: Command): Result => {
      const t0 = d.now();
      const result = sim.preview(cmd);
      const dt = d.now() - t0;
      this.samples.push(dt);
      this.previewCalls += 1;
      this.previewMax = Math.max(this.previewMax, dt);
      return result;
    };
    this.memo = createPreviewMemo(timed, () => sim.network().rev);
    this.syncHistory();
  }

  get activeTool(): HudTool {
    return this.tool;
  }

  get trackState(): TrackToolState {
    return this.state;
  }

  groundZmm = (q: number, r: number): number | undefined => {
    const h = heightDmAt(this.d.terrain, { q, r });
    return h === undefined ? undefined : h * 100;
  };

  previewStats(): PreviewStats {
    const n = this.samples.copyTo(this.scratch);
    const previewP95 = p95(this.scratch, n);
    const m = this.planSamples.copyTo(this.scratch);
    const memo = this.memo.stats();
    return {
      calls: this.previewCalls,
      p95Ms: previewP95,
      maxMs: this.previewMax,
      memoHits: memo.hits,
      memoMisses: memo.misses,
      planCalls: this.planCalls,
      planP95Ms: p95(this.scratch, m),
      planMaxMs: this.planMax,
    };
  }

  selectTool(tool: HudTool): void {
    if (tool === this.tool) return;
    // Deactivate while the track tool is still the active one, so its clearing effects apply.
    if (this.tool === "track") this.dispatch({ type: "deactivate" });
    this.tool = tool;
    this.d.store.set({ tool });
    this.d.lattice.setBuildMode(tool === "track");
    this.d.canvas.style.cursor = tool === "track" ? "crosshair" : "";
    if (tool === "track") {
      this.dispatch({ type: "activate" });
      if (this.d.precisionHeld()) this.dispatch({ type: "precision", held: true });
      this.announce("Track tool. Drag to lay track, or click to start and click again to lay it. Arrow keys move a cursor; Enter starts and lays. Esc steps back.");
    } else {
      this.announce("Select.");
    }
    this.d.requestFrame("overlay");
  }

  /** Feeds one event to the active tool and interprets its effects; events raised meanwhile queue behind it. */
  dispatch(event: ToolEvent): void {
    if (this.tool !== "track") return;
    this.queue.push(event);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      for (let e = this.queue.shift(); e; e = this.queue.shift()) {
        const [next, effects] = reduceTrackTool(this.state, e, this.ctx());
        this.state = next;
        for (const effect of effects) this.apply(effect);
      }
    } finally {
      this.dispatching = false;
    }
  }

  undo(): void {
    this.history("undo");
  }

  redo(): void {
    this.history("redo");
  }

  /** Per frame: keeps the tooltip over the keyboard cursor while it leads (the camera may have moved). */
  onFrame(): void {
    const anchor = this.tooltipAnchor;
    if (!anchor) return;
    const p = toWorld(anchor);
    simToWorld(p.x, p.y, anchor.zMm / 1000, scratchWorld);
    worldToScreen(this.d.camera, scratchWorld, scratchScreen);
    this.setTooltipPosition(scratchScreen.x, scratchScreen.y);
  }

  /** The pointer moved over the canvas: the tooltip follows it unless the keyboard cursor leads. */
  onPointer(x: number, y: number): void {
    if (!this.tooltipAnchor) this.setTooltipPosition(x, y);
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer);
  }

  private readonly timedPlan = (drag: Drag): TrackPlan => {
    const t0 = this.d.now();
    const plan = this.d.sim.planTrack(drag);
    const dt = this.d.now() - t0;
    this.planSamples.push(dt);
    this.planCalls += 1;
    this.planMax = Math.max(this.planMax, dt);
    return plan;
  };

  private ctx(): ToolCtx {
    const { sim } = this.d;
    return {
      network: sim.network(),
      planTrack: this.timedPlan,
      preview: this.memo.preview,
      groundZmm: this.groundZmm,
      settings: this.settings,
    };
  }

  private apply(effect: ToolEffect): void {
    const d = this.d;
    switch (effect.type) {
      case "execute": {
        this.run(effect.command);
        return;
      }
      case "ghost":
        d.ghost.set(effect.ghost);
        d.ghost.updateTags(d.camera);
        d.requestFrame("hover");
        return;
      case "snap": {
        d.snap.set(effect.snap);
        if (effect.snap) {
          const p = toWorld(effect.snap.node);
          simToWorld(p.x, p.y, effect.snap.node.zMm / 1000, scratchWorld);
          d.lattice.setCursor(scratchWorld.x, scratchWorld.z);
        } else {
          d.lattice.clearCursor();
        }
        d.requestFrame("hover");
        return;
      }
      case "tooltip":
        this.showTooltip(effect.tooltip);
        return;
      case "highlight":
        d.highlight.set(effect.keys, d.sim.network());
        d.requestFrame("hover");
        return;
      case "announce":
        this.announce(effect.text);
        return;
      case "camera": {
        const x = effect.focus.xMm / 1000;
        const y = effect.focus.yMm / 1000;
        const node = this.state.target?.node;
        simToWorld(x, y, node ? node.zMm / 1000 : 0, scratchWorld);
        worldToScreen(d.camera, scratchWorld, scratchScreen);
        d.controller.keepInView(scratchScreen, CURSOR_MARGIN_PX);
        return;
      }
      case "exit":
        this.selectTool("select");
        return;
    }
  }

  /** The single command gateway for tool commands. */
  private run(command: Command): Result {
    const result = this.d.sim.execute(command);
    if (result.ok) {
      this.afterChange();
    } else {
      // Preview and execute share one code path, so this means the network moved under the tool.
      this.toast(result.reason.message, "warn");
      this.dispatch({ type: "refresh" });
    }
    return result;
  }

  private history(direction: "undo" | "redo"): void {
    const result = this.d.sim.execute({ type: direction });
    if (!result.ok) {
      this.toast(result.reason.message, "warn");
      this.announce(result.reason.message);
      return;
    }
    const verb = direction === "undo" ? "Undone" : "Redone";
    const text = `${verb}: ${describeDiff(result.diff)}.`;
    this.toast(text, "info");
    this.d.flash.flash(
      result.diff.added.map((r) => r.key),
      result.diff.removed.map((r) => r.key),
    );
    this.afterChange();
  }

  private afterChange(): void {
    this.syncHistory();
    this.d.requestFrame("network");
    this.dispatch({ type: "refresh" });
  }

  private syncHistory(): void {
    const { sim, store } = this.d;
    store.set({ canUndo: sim.preview({ type: "undo" }).ok, canRedo: sim.preview({ type: "redo" }).ok });
  }

  private showTooltip(tooltip: TooltipModel | null): void {
    this.tooltipAnchor = tooltip?.anchor ?? null;
    this.d.store.set({ tooltip });
    if (this.tooltipAnchor) this.onFrame();
  }

  private setTooltipPosition(x: number, y: number): void {
    const rect = this.d.canvas.getBoundingClientRect();
    this.d.hud.style.setProperty("--hud-pointer-x", `${Math.round(rect.left + x)}px`);
    this.d.hud.style.setProperty("--hud-pointer-y", `${Math.round(rect.top + y)}px`);
  }

  private announce(text: string): void {
    this.d.store.set({ status: text });
  }

  private toast(text: string, tone: "info" | "warn"): void {
    this.toastId += 1;
    this.d.store.set({ toast: { id: this.toastId, text, tone } });
    window.clearTimeout(this.toastTimer);
    const id = this.toastId;
    this.toastTimer = window.setTimeout(() => {
      if (this.d.store.getSnapshot().toast?.id === id) this.d.store.set({ toast: null });
    }, TOAST_MS);
  }
}

/** "removed 4 pieces", "added 2 pieces", or both. */
export function describeDiff(diff: Diff): string {
  const plural = (n: number) => `${n} piece${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (diff.removed.length > 0) parts.push(`removed ${plural(diff.removed.length)}`);
  if (diff.added.length > 0) parts.push(`added ${plural(diff.added.length)}`);
  return parts.length > 0 ? parts.join(", ") : "no change";
}
