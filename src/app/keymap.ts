/**
 * Keyboard and wheel routing rules for `InputRouter` (issue #67 "Tool and
 * input"), pure so the conflicts are decided in one place and tested:
 *
 * - Undo Ctrl/Cmd+Z; redo Ctrl/Cmd+Shift+Z or Ctrl+Y; letters compared
 *   case-insensitively (Shift turns `z` into `Z`), by `key`, so they follow
 *   the keyboard layout. They work in every tool.
 * - 1 selects Track and 5 Straight line (the tool-set keys, architecture
 *   "Tools"; 2–4 stay reserved for Signal, Station and Depot and 7 for
 *   Demolish, unbound until those tools exist). Straight line took 5, Bridge's
 *   old key, when it replaced the Bridge (5) and Tunnel (6) tools (owner
 *   decision 2026-09-28, "One 'Straight line' tool"), so the planned 1–7 order
 *   keeps; 6 is unbound now. A digit matches by character (Shift allowed, for
 *   layouts like AZERTY that shift for digits), or unshifted by physical key
 *   (top row or numpad), except where that key types the camera's zoom
 *   characters (+ = − _: AZERTY's 6 key is its "−", which keeps zooming out;
 *   AZERTY's 5 key types "(", so it selects Straight line by physical key).
 *   Never with Ctrl, Cmd or Alt. Esc steps the track tool back one level, and
 *   from Idle returns to Select.
 * - Occlusion aids (D4), unmodified letters in every tool: H hides bridge
 *   decks, U toggles the underground x-ray, C cycles the stacked picks under
 *   the pointer (a track-family tool only). They match by character (`key`),
 *   case-insensitively, so they follow the layout like undo's letters, with
 *   two rules: the camera's physical keys win (WASD, Q/E by `code`), so a
 *   layout that types h, u or c on one of those keys (Workman types h on the
 *   D key) keeps panning; and a layout without Latin letters (Cyrillic, Greek)
 *   gets them by physical key. With Ctrl, Cmd or Alt held they are left to the
 *   browser (Ctrl+H is history, Ctrl+C copy) and never fire, so they never
 *   take precision's modifier either.
 * - While Track is active: arrows move the keyboard lattice cursor (instead
 *   of panning; WASD still pans), Enter starts and commits, PgUp/PgDn and
 *   `]`/`[` step the height. They also work with the precision modifier held
 *   (so a precision plan can be moved and committed from the keyboard), but
 *   not with any other modifier. The brackets match by character (`key`), so
 *   a layout that types something else on those physical keys keeps it
 *   (German QWERTZ types "+", the camera's zoom-in, where US has `]`). Only
 *   while precision is held do the physical keys count too: ⌥ changes the
 *   character on macOS, and the camera ignores modified keys, so nothing is
 *   taken from it. (Ctrl+PgUp/PgDn switch browser tabs on Windows and Linux,
 *   so under Ctrl precision the brackets or Shift+wheel step the height.)
 * - Enter and focused HUD buttons (`InputRouter`): a focused button keeps its
 *   own Enter, so Tab + Enter still works on the toolbar, unless Track is
 *   active and the arrows moved the lattice cursor since that button took
 *   focus: then the user is working the cursor, and Enter starts or commits
 *   the track. Toolbar buttons take no focus from a pointer click, so a
 *   clicked Track or Undo button never captures the Enter meant for the tool.
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

/** Tools a key selects. */
export type KeyTool = "track" | "straight";

export type KeyAction =
  | { readonly kind: "undo" }
  | { readonly kind: "redo" }
  | { readonly kind: "select-tool"; readonly tool: KeyTool }
  | { readonly kind: "toggle-decks" }
  | { readonly kind: "toggle-xray" }
  | { readonly kind: "cycle-pick" }
  | { readonly kind: "escape" }
  | { readonly kind: "enter" }
  | { readonly kind: "cursor"; readonly direction: CursorDirection }
  | { readonly kind: "height"; readonly delta: 1 | -1 }
  | { readonly kind: "end-heading"; readonly delta: 1 | -1 }
  | { readonly kind: "labels" }
  | { readonly kind: "perf" }
  /** Not ours: offer it to the camera. */
  | { readonly kind: "camera" };

/** The tool-set keys (architecture "Tools": Track 1, Straight line 5), by digit. */
const TOOL_KEYS: Readonly<Record<string, KeyTool>> = { "1": "track", "5": "straight" };
/** The camera's zoom characters (`CameraController`), which a digit's physical key never takes. */
const ZOOM_CHARS: ReadonlySet<string> = new Set(["+", "=", "-", "_"]);
/** The camera's physical keys (`CameraController`): pan and rotate. */
const CAMERA_CODES: ReadonlySet<string> = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
/** The occlusion aids by letter. */
const AID_KEYS: Readonly<Record<string, "toggle-decks" | "toggle-xray" | "cycle-pick">> = { h: "toggle-decks", u: "toggle-xray", c: "cycle-pick" };

/** An occlusion aid's letter: by character, or by physical key where the layout types no Latin letter there. */
function aidLetter(e: KeyInput): string | undefined {
  if (CAMERA_CODES.has(e.code)) return undefined;
  const ch = e.key.length === 1 ? e.key.toLowerCase() : "";
  if (ch in AID_KEYS) return ch;
  if (/^[a-z]$/.test(ch)) return undefined;
  const physical = /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase();
  return physical !== undefined && physical in AID_KEYS ? physical : undefined;
}

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
    // Only the precision modifier: Ctrl (Windows, Linux) or ⌥ (macOS), without the other or Cmd.
    const precisionOnly = ctx.precision && !e.metaKey && e.ctrlKey !== e.altKey;
    if ((!command && !e.altKey) || precisionOnly) {
      if (e.key === "Enter" || e.code === "NumpadEnter") return { kind: "enter" };
      const direction = ARROWS[e.key];
      if (direction) return { kind: "cursor", direction };
      if (e.key === "PageUp" || e.key === "]" || (precisionOnly && e.code === "BracketRight")) return { kind: "height", delta: 1 };
      if (e.key === "PageDown" || e.key === "[" || (precisionOnly && e.code === "BracketLeft")) return { kind: "height", delta: -1 };
    }
  }

  if (!command && !e.altKey) {
    const digit = e.shiftKey || ZOOM_CHARS.has(e.key) ? undefined : /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1];
    const tool = TOOL_KEYS[e.key] ?? (digit === undefined ? undefined : TOOL_KEYS[digit]);
    if (tool) return { kind: "select-tool", tool };
  }
  if (!command && !e.altKey && !e.shiftKey) {
    if (e.code === "KeyL") return { kind: "labels" };
    const aid = aidLetter(e);
    if (aid === "c") return ctx.trackActive ? { kind: "cycle-pick" } : { kind: "camera" };
    if (aid) return { kind: AID_KEYS[aid] as "toggle-decks" | "toggle-xray" };
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
