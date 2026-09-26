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
  // Arrows pan until D3 gives them to the keyboard lattice cursor.
  ArrowUp: "up",
  ArrowLeft: "left",
  ArrowDown: "down",
  ArrowRight: "right",
};

/**
 * Camera input (architecture "Camera"): wheel zoom-to-cursor (×1.15 a notch,
 * pinch as ctrl-wheel), right/middle drag pan, left drag on empty ground pans
 * too (D1 has no tools), WASD/arrows at 700 px/s with a short glide, Q/E yaw
 * steps, +/− named zooms and Home to recentre. It mutates the `IsoCamera`
 * state and asks the scheduler for frames; the three camera catches up in
 * `update`, which the app calls first in every frame.
 */
export class CameraController {
  private readonly held = { left: false, right: false, up: false, down: false };
  private readonly heldCodes = new Set<string>();
  private readonly velocity: PanVelocity = { vx: 0, vy: 0 };
  private readonly scratchTarget: GroundPoint = { x: 0, z: 0 };
  private drag: { id: number; x: number; y: number } | undefined;
  private readonly abort = new AbortController();

  constructor(private readonly options: CameraControllerOptions) {
    const { canvas } = options;
    const signal = this.abort.signal;
    canvas.addEventListener("wheel", this.onWheel, { passive: false, signal });
    canvas.addEventListener("pointerdown", this.onPointerDown, { signal });
    canvas.addEventListener("pointermove", this.onPointerMove, { signal });
    canvas.addEventListener("pointerup", this.onPointerUp, { signal });
    canvas.addEventListener("pointercancel", this.onPointerUp, { signal });
    canvas.addEventListener("contextmenu", this.onContextMenu, { signal });
    window.addEventListener("keydown", this.onKeyDown, { signal });
    window.addEventListener("keyup", this.onKeyUp, { signal });
    window.addEventListener("blur", this.onBlur, { signal });
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
    this.abort.abort();
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

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey);
    if (factor === 1) return;
    const rect = this.options.canvas.getBoundingClientRect();
    this.zoomTo(this.options.camera.ppm * factor, e.clientX - rect.left, e.clientY - rect.top);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    // Left, middle and right all pan in D1: there are no tools yet, so all ground is "empty".
    if (e.button > 2 || this.drag) return;
    e.preventDefault();
    this.options.canvas.focus({ preventScroll: true });
    this.options.canvas.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (dx === 0 && dy === 0) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    this.panContent(dx, dy);
    this.options.scheduler.requestFrame("input");
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.id) this.releaseDrag(e.pointerId);
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // macOS sends no keyup for keys released while Cmd is down, so a pan key
    // held into a Cmd chord would stick; drop held keys once Cmd goes down.
    if (e.metaKey && this.heldCodes.size > 0) this.releaseHeldKeys();
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
    const { camera, scheduler } = this.options;
    if (PAN_KEYS[e.code]) {
      e.preventDefault();
      this.heldCodes.add(e.code);
      this.syncHeld();
      scheduler.setContinuous("camera-anim", true);
      return;
    }
    if (e.code === "KeyQ" || e.code === "KeyE") {
      if (e.repeat) return;
      // E steps yaw up (the camera orbits counter-clockwise seen from above), Q down.
      camera.rotate(e.code === "KeyE" ? 1 : -1);
      scheduler.setContinuous("camera-anim", true);
      scheduler.requestFrame("input");
      return;
    }
    const zoomDirection = e.key === "+" || e.key === "=" || e.code === "NumpadAdd" ? 1 : e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" ? -1 : 0;
    if (zoomDirection !== 0) {
      e.preventDefault();
      this.zoomTo(nextNamedZoom(camera.ppm, zoomDirection), camera.cssWidth / 2, camera.cssHeight / 2);
      return;
    }
    if (e.code === "Home") {
      e.preventDefault();
      this.recentre();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    // Keys released during a Cmd chord never sent keyup (see onKeyDown).
    if (e.key === "Meta") this.releaseHeldKeys();
    else if (this.heldCodes.delete(e.code)) this.syncHeld();
  };

  /** Keys released while the window is unfocused never send keyup; drop them. */
  private readonly onBlur = (): void => {
    this.releaseHeldKeys();
    if (this.drag) this.releaseDrag(this.drag.id);
  };

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
