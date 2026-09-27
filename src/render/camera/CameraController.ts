import type { ContinuousReason, FrameInfo, FrameReason } from "../core/FrameScheduler";
import type { IsoCamera } from "./IsoCamera";
import { KEY_PAN_MAX_DT_MS, type PanVelocity, stepKeyPan, wheelZoomFactor } from "./inputMath";
import {
  type GroundBounds,
  type GroundPoint,
  TARGET_MARGIN_M,
  clampTarget,
  nextNamedZoom,
  panByScreen,
  screenToWorldAtHeight,
  zoomAboutPoint,
} from "./isoMath";

/** The scheduler surface the controller needs. */
export interface FrameRequester {
  requestFrame(reason: FrameReason): void;
  setContinuous(reason: ContinuousReason, on: boolean): void;
}

export interface CameraControllerOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: IsoCamera;
  readonly scheduler: FrameRequester;
  /** The map's world XZ extent; the target stays within it ± 100 m. */
  readonly bounds: GroundBounds;
  /** Where Home recentres. */
  readonly home: GroundPoint;
  readonly reducedMotion: () => boolean;
}

/** Physical keys (KeyboardEvent.code), so WASD sits under the same fingers on any layout. */
const PAN_KEYS: Readonly<Record<string, "left" | "right" | "up" | "down">> = {
  KeyW: "up",
  KeyA: "left",
  KeyS: "down",
  KeyD: "right",
  // Arrows pan too, except while the track tool has them for the keyboard lattice cursor
  // (the app's InputRouter then never offers them here).
  ArrowUp: "up",
  ArrowLeft: "left",
  ArrowDown: "down",
  ArrowRight: "right",
};

/**
 * Camera input (architecture "Camera"): wheel zoom-to-cursor (×1.15 a notch,
 * pinch as ctrl-wheel), right/middle drag pan, left drag on empty ground pans
 * in Select, WASD/arrows at 700 px/s with a short glide, Q/E yaw steps, +/−
 * named zooms and Home to recentre. It mutates the `IsoCamera` state and asks
 * the scheduler for frames; the three camera catches up in `update`, which
 * the app calls first in every frame.
 *
 * Since D3 it attaches no listeners itself: the app's `InputRouter` owns the
 * DOM events and offers each gesture to the camera first (`handle*`, true
 * when taken), then to the active tool.
 */
export class CameraController {
  private readonly held = { left: false, right: false, up: false, down: false };
  private readonly heldCodes = new Set<string>();
  private readonly velocity: PanVelocity = { vx: 0, vy: 0 };
  private readonly scratchTarget: GroundPoint = { x: 0, z: 0 };
  private drag: { id: number; x: number; y: number } | undefined;

  constructor(private readonly options: CameraControllerOptions) {}

  /** True while a pointer drag is panning. */
  get panning(): boolean {
    return this.drag !== undefined;
  }

  /**
   * First step of every frame: integrates the keyboard pan, advances the yaw
   * ease, applies the state to the three camera, and keeps `camera-anim` on
   * exactly while something is still moving.
   */
  update(frame: FrameInfo): void {
    const { camera, scheduler, reducedMotion } = this.options;
    // After idle, dtMs measures the gap, not a frame: integrate nothing that frame.
    const dt = frame.consecutive ? Math.min(frame.dtMs, KEY_PAN_MAX_DT_MS) : 0;
    const panning = stepKeyPan(this.velocity, this.held, dt, reducedMotion());
    if (panning && dt > 0) {
      // View velocity (x right, y up) moves the content the opposite way.
      this.panContent((-this.velocity.vx * dt) / 1000, (this.velocity.vy * dt) / 1000);
    }
    const rotating = camera.update(frame.nowMs);
    scheduler.setContinuous("camera-anim", panning || rotating);
  }

  /** Home: back to the map centre at the current zoom and yaw. */
  recentre(): void {
    const { camera, home, scheduler } = this.options;
    camera.target.x = home.x;
    camera.target.z = home.z;
    this.velocity.vx = 0;
    this.velocity.vy = 0;
    scheduler.requestFrame("input");
  }

  dispose(): void {
    if (this.drag) this.releaseDrag(this.drag.id);
    this.releaseHeldKeys();
  }

  /** Moves the content by CSS px (y down), clamping the target to the map. */
  private panContent(dxPx: number, dyPx: number): void {
    const { camera, bounds } = this.options;
    panByScreen(camera.target, dxPx, dyPx, camera.ppm, camera.yaw, camera.pitch, this.scratchTarget);
    clampTarget(this.scratchTarget, bounds, TARGET_MARGIN_M, camera.target);
  }

  private zoomTo(newPpm: number, cssX: number, cssY: number): void {
    const { camera, bounds, scheduler } = this.options;
    // Any point on the cursor's view ray keeps its pixel, so the Y = 0 crossing
    // anchors the zoom exactly as well as the terrain hit would.
    const anchor = screenToWorldAtHeight(camera, cssX, cssY, 0);
    const next = zoomAboutPoint(camera, anchor, newPpm, camera.yaw, camera.pitch);
    camera.ppm = next.ppm;
    clampTarget(next.target, bounds, TARGET_MARGIN_M, camera.target);
    scheduler.requestFrame("input");
  }

  /** Wheel zoom to the cursor (pinch arrives as ctrl-wheel). */
  handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey);
    if (factor === 1) return;
    const rect = this.options.canvas.getBoundingClientRect();
    this.zoomTo(this.options.camera.ppm * factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  /** Starts a pan drag with this pointer; the router offers only the buttons that pan (right, middle, and left in Select). */
  handlePointerDown(e: PointerEvent): boolean {
    if (e.button > 2 || this.drag) return false;
    e.preventDefault();
    this.options.canvas.focus({ preventScroll: true });
    this.options.canvas.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    return true;
  }

  /** Pans while this pointer drags; false when the move is not the camera's. */
  handlePointerMove(e: PointerEvent): boolean {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.id) return false;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (dx === 0 && dy === 0) return true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    this.panContent(dx, dy);
    this.options.scheduler.requestFrame("input");
    return true;
  }

  handlePointerUp(e: PointerEvent): boolean {
    if (!this.drag || e.pointerId !== this.drag.id) return false;
    this.releaseDrag(e.pointerId);
    return true;
  }

  /** WASD/arrows, Q/E, +/− and Home; true when the key was the camera's. */
  handleKeyDown(e: KeyboardEvent): boolean {
    // macOS sends no keyup for keys released while Cmd is down, so a pan key
    // held into a Cmd chord would stick; drop held keys once Cmd goes down.
    if (e.metaKey && this.heldCodes.size > 0) this.releaseHeldKeys();
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return false;
    const { camera, scheduler } = this.options;
    if (PAN_KEYS[e.code]) {
      e.preventDefault();
      this.heldCodes.add(e.code);
      this.syncHeld();
      scheduler.setContinuous("camera-anim", true);
      return true;
    }
    if (e.code === "KeyQ" || e.code === "KeyE") {
      if (e.repeat) return true;
      // E steps yaw up (the camera orbits counter-clockwise seen from above), Q down.
      camera.rotate(e.code === "KeyE" ? 1 : -1);
      scheduler.setContinuous("camera-anim", true);
      scheduler.requestFrame("input");
      return true;
    }
    const zoomDirection = e.key === "+" || e.key === "=" || e.code === "NumpadAdd" ? 1 : e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" ? -1 : 0;
    if (zoomDirection !== 0) {
      e.preventDefault();
      this.zoomTo(nextNamedZoom(camera.ppm, zoomDirection), camera.cssWidth / 2, camera.cssHeight / 2);
      return true;
    }
    if (e.code === "Home") {
      e.preventDefault();
      this.recentre();
      return true;
    }
    return false;
  }

  handleKeyUp(e: KeyboardEvent): void {
    // Keys released during a Cmd chord never sent keyup (see handleKeyDown).
    if (e.key === "Meta") this.releaseHeldKeys();
    else if (this.heldCodes.delete(e.code)) this.syncHeld();
  }

  /** Stops panning with a key the router now gives to a tool (the arrows when Track activates). */
  releaseKey(code: string): void {
    if (this.heldCodes.delete(code)) this.syncHeld();
  }

  /** Keys released while the window is unfocused never send keyup; drop them. */
  handleBlur(): void {
    this.releaseHeldKeys();
    if (this.drag) this.releaseDrag(this.drag.id);
  }

  /**
   * Keeps a point that is drawn at `screen` (CSS px) at least `marginPx`
   * inside the viewport: the keyboard lattice cursor's camera request. Pans
   * only as far as needed.
   */
  keepInView(screen: { readonly x: number; readonly y: number }, marginPx: number): void {
    const { camera, scheduler } = this.options;
    const dx = screen.x < marginPx ? marginPx - screen.x : screen.x > camera.cssWidth - marginPx ? camera.cssWidth - marginPx - screen.x : 0;
    const dy = screen.y < marginPx ? marginPx - screen.y : screen.y > camera.cssHeight - marginPx ? camera.cssHeight - marginPx - screen.y : 0;
    if (dx === 0 && dy === 0) return;
    this.panContent(dx, dy);
    scheduler.requestFrame("input");
  }

  private releaseHeldKeys(): void {
    this.heldCodes.clear();
    this.syncHeld();
  }

  private syncHeld(): void {
    this.held.left = this.held.right = this.held.up = this.held.down = false;
    for (const code of this.heldCodes) {
      const direction = PAN_KEYS[code];
      if (direction) this.held[direction] = true;
    }
  }

  private releaseDrag(pointerId: number): void {
    const canvas = this.options.canvas;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    this.drag = undefined;
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}
