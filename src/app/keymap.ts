/**
 * Keyboard and wheel routing rules for `InputRouter` (issue #67 "Tool and
 * input"), pure so the conflicts are decided in one place and tested:
 *
 * - Undo Ctrl/Cmd+Z; redo Ctrl/Cmd+Shift+Z or Ctrl+Y; letters compared
 *   case-insensitively (Shift turns `z` into `Z`), by `key`, so they follow
 *   the keyboard layout. They work in every tool.
 * - 1 selects Track; Esc steps the track tool back one level, and from Idle
 *   returns to Select.
 * - While Track is active: arrows move the keyboard lattice cursor (instead
 *   of panning; WASD still pans), Enter starts and commits, PgUp/PgDn and
 *   `]`/`[` step the height.
 * - Precision is Ctrl, or ⌥ (Alt) on macOS. While it is held with Track
 *   active, Q/E turn the end heading instead of rotating the camera (the
 *   camera ignores modified keys anyway) and the wheel picks the radius
 *   class instead of zooming. A trackpad pinch also arrives as a Ctrl+wheel
 *   event, but without a Control keydown, so precision is taken from the
 *   physical key state the router tracks, never from the wheel event's flag:
 *   a pinch keeps zooming.
 * - Shift+wheel steps the height while Track is active (browsers may report
 *   it as horizontal scroll, so deltaX counts too); otherwise the wheel zooms.
 * - Everything else goes to the camera first (WASD, Q/E, +/−, Home), then L
 *   (labels) and F3 (perf overlay).
 */

export interface KeyInput {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
}

export interface KeyContext {
  readonly trackActive: boolean;
  /** Precision held (Ctrl, or ⌥ on macOS), from the tracked key state. */
  readonly precision: boolean;
}

export type CursorDirection = "up" | "down" | "left" | "right";

export type KeyAction =
  | { readonly kind: "undo" }
  | { readonly kind: "redo" }
  | { readonly kind: "select-track" }
  | { readonly kind: "escape" }
  | { readonly kind: "enter" }
  | { readonly kind: "cursor"; readonly direction: CursorDirection }
  | { readonly kind: "height"; readonly delta: 1 | -1 }
  | { readonly kind: "end-heading"; readonly delta: 1 | -1 }
  | { readonly kind: "labels" }
  | { readonly kind: "perf" }
  /** Not ours: offer it to the camera. */
  | { readonly kind: "camera" };

const ARROWS: Readonly<Record<string, CursorDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function classifyKey(e: KeyInput, ctx: KeyContext): KeyAction {
  const letter = e.key.length === 1 ? e.key.toLowerCase() : "";
  const command = e.ctrlKey || e.metaKey;
  if (command && !e.altKey) {
    if (letter === "z") return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
    if (letter === "y" && e.ctrlKey && !e.shiftKey) return { kind: "redo" };
  }
  if (e.key === "Escape") return { kind: "escape" };

  if (ctx.trackActive) {
    if (ctx.precision && !e.shiftKey && (e.code === "KeyQ" || e.code === "KeyE")) {
      return { kind: "end-heading", delta: e.code === "KeyE" ? 1 : -1 };
    }
    if (!command && !e.altKey) {
      if (e.key === "Enter" || e.code === "NumpadEnter") return { kind: "enter" };
      const direction = ARROWS[e.key];
      if (direction) return { kind: "cursor", direction };
      if (e.key === "PageUp" || e.code === "BracketRight" || e.key === "]") return { kind: "height", delta: 1 };
      if (e.key === "PageDown" || e.code === "BracketLeft" || e.key === "[") return { kind: "height", delta: -1 };
    }
  }

  if (!command && !e.altKey && !e.shiftKey) {
    if (e.key === "1" || e.code === "Digit1" || e.code === "Numpad1") return { kind: "select-track" };
    if (e.code === "KeyL") return { kind: "labels" };
  }
  if (e.code === "F3") return { kind: "perf" };
  return { kind: "camera" };
}

export type WheelAction = { readonly kind: "height" | "radius"; readonly steps: number } | { readonly kind: "camera" };

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly shiftKey: boolean;
}

/** Pixels per notch; a line counts a third of one (as the camera's zoom does). */
const WHEEL_NOTCH_PX = 100;

/**
 * Turns wheel events into whole steps for the height and radius controls:
 * a mouse notch or a line/page event is one step, a trackpad's small
 * deltas accumulate until they add up to a notch. Scrolling up (negative
 * delta) is +1: a higher end or a larger radius.
 */
export class WheelStepper {
  private accumulated = 0;
  private kind: "height" | "radius" | undefined;

  classify(e: WheelInput, ctx: KeyContext): WheelAction {
    if (!ctx.trackActive) return this.reset();
    let kind: "height" | "radius";
    if (e.shiftKey) kind = "height";
    else if (ctx.precision) kind = "radius";
    else return this.reset();
    if (kind !== this.kind) {
      this.kind = kind;
      this.accumulated = 0;
    }
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (e.deltaMode !== 0) {
      this.accumulated = 0;
      return { kind, steps: delta < 0 ? 1 : delta > 0 ? -1 : 0 };
    }
    this.accumulated -= delta;
    const steps = Math.trunc(this.accumulated / WHEEL_NOTCH_PX);
    this.accumulated -= steps * WHEEL_NOTCH_PX;
    return { kind, steps };
  }

  private reset(): WheelAction {
    this.kind = undefined;
    this.accumulated = 0;
    return { kind: "camera" };
  }
}

/** Precision is Ctrl, or ⌥ on macOS. */
export function precisionHeld(keys: { readonly ctrl: boolean; readonly alt: boolean }, mac: boolean): boolean {
  return mac ? keys.alt : keys.ctrl;
}

/** Whether the platform is macOS (⌥ for precision, Cmd for undo), from `navigator`-style strings. */
export function isMacPlatform(platform: string, userAgent: string): boolean {
  return /mac/i.test(platform) || (/mac os x/i.test(userAgent) && !/iphone|ipad/i.test(userAgent));
}
