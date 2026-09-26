/**
 * Render on demand (ADR 0009, architecture "Frame scheduler").
 *
 * A frame runs only when someone asked for one (`requestFrame`) or a named
 * continuous reason is active, so an idle diorama draws zero frames. The host
 * APIs are injected so the whole policy runs under test in Node; this is the
 * only place that may call `requestAnimationFrame`.
 */

/** Reasons that keep frames coming until switched off. */
export type ContinuousReason = "sim-running" | "camera-anim" | "ambient" | "particles-alive";

/** One-shot reasons: every request names why it wants a frame. */
export type FrameReason =
  | "init"
  | "input"
  | "hover"
  | "resize"
  | "dpr"
  | "network"
  | "overlay"
  | "rebuild"
  | "context-restore";

export interface SchedulerHost {
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  now(): number;
  isHidden(): boolean;
}

/** Passed to every frame listener. One object, reused: read it, don't keep it. */
export interface FrameInfo {
  /** Host time of this frame in ms. */
  nowMs: number;
  /** Time since the previous rendered frame, 0 for the first. */
  dtMs: number;
  /**
   * True when the previous frame queued this one (a continuous run or a request
   * made during the frame). False after idle or a hidden page, when `dtMs`
   * measures a gap rather than a frame, so integrators should not use it.
   */
  consecutive: boolean;
  /** 1-based count of rendered frames. */
  frame: number;
}

/** `ambient` alone is throttled to this rate. */
export const AMBIENT_FPS = 30;
const AMBIENT_INTERVAL_MS = 1000 / AMBIENT_FPS;
/** rAF timestamps jitter; without slack a 60 Hz display would drop to 20 fps. */
const AMBIENT_SLACK_MS = 1;

export class FrameScheduler {
  private readonly continuous = new Set<ContinuousReason>();
  private readonly listeners: ((frame: FrameInfo) => void)[] = [];
  private readonly info: FrameInfo = { nowMs: 0, dtMs: 0, consecutive: false, frame: 0 };
  private readonly tick = (): void => this.runFrame();
  private pending = false;
  private handle: number | undefined;
  private chained = false;
  private inFrame = false;
  private disposed = false;
  private lastFrameMs: number | undefined;
  private rendered = 0;

  constructor(private readonly host: SchedulerHost) {}

  /** Frames rendered so far. Flat while idle. */
  get frameCount(): number {
    return this.rendered;
  }

  /** Whether a frame is queued or a continuous reason is active. */
  get active(): boolean {
    return this.pending || this.continuous.size > 0;
  }

  /** Asks for one frame; requests before it runs coalesce. */
  requestFrame(_reason: FrameReason): void {
    this.pending = true;
    this.schedule();
  }

  setContinuous(reason: ContinuousReason, on: boolean): void {
    if (on) this.continuous.add(reason);
    else this.continuous.delete(reason);
    this.schedule();
  }

  isContinuous(reason: ContinuousReason): boolean {
    return this.continuous.has(reason);
  }

  /** Registers a frame listener; returns its unsubscribe. */
  onFrame(listener: (frame: FrameInfo) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Call from `visibilitychange`: stops the loop when hidden, resumes when visible. */
  handleVisibilityChange(): void {
    this.chained = false;
    if (this.host.isHidden()) {
      if (this.handle !== undefined) this.host.cancelAnimationFrame(this.handle);
      this.handle = undefined;
    } else {
      this.schedule();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.handle !== undefined) this.host.cancelAnimationFrame(this.handle);
    this.handle = undefined;
    this.listeners.length = 0;
    this.continuous.clear();
    this.pending = false;
  }

  private schedule(): void {
    // Inside a frame, runFrame decides at the end whether to queue the next one.
    if (this.disposed || this.inFrame || this.handle !== undefined) return;
    if (!this.active || this.host.isHidden()) return;
    this.handle = this.host.requestAnimationFrame(this.tick);
  }

  private onlyAmbient(): boolean {
    return !this.pending && this.continuous.size === 1 && this.continuous.has("ambient");
  }

  private runFrame(): void {
    this.handle = undefined;
    if (this.disposed) return;
    if (this.host.isHidden() || !this.active) {
      this.chained = false;
      return;
    }
    const now = this.host.now();
    if (this.onlyAmbient() && this.lastFrameMs !== undefined && now - this.lastFrameMs < AMBIENT_INTERVAL_MS - AMBIENT_SLACK_MS) {
      // Too soon for the ambient rate: wait for the next vsync without rendering.
      this.handle = this.host.requestAnimationFrame(this.tick);
      return;
    }

    this.pending = false;
    this.rendered += 1;
    this.info.nowMs = now;
    this.info.dtMs = this.lastFrameMs === undefined ? 0 : now - this.lastFrameMs;
    this.info.consecutive = this.chained;
    this.info.frame = this.rendered;
    this.lastFrameMs = now;

    this.inFrame = true;
    try {
      for (let i = 0; i < this.listeners.length; i++) this.listeners[i]?.(this.info);
    } finally {
      this.inFrame = false;
      this.chained = false;
      this.schedule();
      this.chained = this.handle !== undefined;
    }
  }
}
