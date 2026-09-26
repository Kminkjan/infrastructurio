import type { WebGLRenderer } from "three";
import { cssColor, palette } from "../art/palette";
import type { FrameInfo } from "./FrameScheduler";
import { RingBuffer, p95 } from "./perfStats";

/** Frame intervals kept for the p95 readout (about 4 s at 60 fps). */
const INTERVAL_SAMPLES = 240;
/** The overlay text refreshes at most this often, so it costs nothing per frame. */
const OVERLAY_REFRESH_MS = 250;

/**
 * Development readout (F3): rendered frames, the p95 frame interval and draw
 * calls from `renderer.info`. With render-on-demand, the gap before a frame
 * that followed idle is not a frame time, so only consecutive frames count
 * toward the interval. Never cite these numbers against the acceptance gates.
 */
export class PerfMonitor {
  private readonly intervals = new RingBuffer(INTERVAL_SAMPLES);
  private readonly scratch = new Float64Array(INTERVAL_SAMPLES);
  private overlay: HTMLDivElement | undefined;
  private lastRefreshMs = Number.NEGATIVE_INFINITY;
  private frames = 0;

  constructor(
    private readonly parent: HTMLElement,
    private readonly renderer: WebGLRenderer,
  ) {}

  get frameCount(): number {
    return this.frames;
  }

  get visible(): boolean {
    return this.overlay !== undefined;
  }

  /** Call once per rendered frame, after `renderer.render`. */
  sample(frame: FrameInfo): void {
    this.frames = frame.frame;
    if (frame.consecutive) this.intervals.push(frame.dtMs);
    if (this.overlay && frame.nowMs - this.lastRefreshMs >= OVERLAY_REFRESH_MS) {
      this.lastRefreshMs = frame.nowMs;
      this.refresh();
    }
  }

  /** Shows or hides the overlay; returns whether it is now visible. */
  toggle(): boolean {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = undefined;
      return false;
    }
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "fixed",
      top: "8px",
      left: "8px",
      padding: "4px 8px",
      font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
      fontVariantNumeric: "tabular-nums",
      color: cssColor(palette.uiInk),
      background: cssColor(palette.uiParchment),
      border: `1px solid ${cssColor(palette.uiBorder)}`,
      borderRadius: "3px",
      pointerEvents: "none",
      whiteSpace: "pre",
      zIndex: "10",
    } satisfies Partial<CSSStyleDeclaration>);
    this.parent.appendChild(el);
    this.overlay = el;
    this.refresh();
    return true;
  }

  dispose(): void {
    this.overlay?.remove();
    this.overlay = undefined;
  }

  private refresh(): void {
    if (!this.overlay) return;
    const n = this.intervals.copyTo(this.scratch);
    const p = p95(this.scratch, n);
    const { calls, triangles } = this.renderer.info.render;
    const interval = Number.isNaN(p) ? "–" : `${p.toFixed(1)} ms`;
    this.overlay.textContent = `frames ${this.frames}\np95 interval ${interval} (${n})\ndraw calls ${calls} · tris ${triangles}`;
  }
}
