import type { Heading, NodeRef } from "../core/sim/api";
import type { CameraController } from "../render/camera/CameraController";
import type { ToolEvent, ToolPick } from "../tools/types";
import { type CursorDirection, type KeyContext, type KeyTool, WheelStepper, classifyKey, precisionHeld } from "./keymap";

/**
 * DOM input → camera and tool events (architecture "Tools", issue #67 "Tool
 * and input"). The single owner of the canvas and window input listeners:
 * each gesture goes to the camera first (right/middle drag, wheel zoom,
 * WASD, Q/E, +/−, Home; left drag too while no tool is active), and the rest
 * becomes interpreted tool events that carry the pick under the pointer and
 * the precision modifier. Undo/redo, tool selection, the occlusion aids
 * (H, U, C), labels and the perf overlay go to app actions. The key and wheel
 * rules live in `keymap.ts`.
 */

export interface InputRouterActions {
  undo(): void;
  redo(): void;
  selectTool(tool: KeyTool): void;
  /** H: hide or show bridge decks. */
  toggleDecks(): void;
  /** U: the underground x-ray. */
  toggleXray(): void;
  /** C: the next stacked pick under the pointer. */
  cyclePick(): void;
  toggleLabels(): void;
  togglePerf(): void;
}

export interface InputRouterOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraController;
  /** macOS: precision is ⌥ rather than Ctrl. */
  readonly mac: boolean;
  /** The logical camera yaw step (0–5), to turn arrow keys into lattice headings. */
  readonly yawStep: () => number;
  /** The pick under a canvas CSS pixel, or null off the map. */
  readonly pick: (x: number, y: number) => ToolPick | null;
  /** Where the keyboard cursor starts when it has no position: the node at the viewport centre. */
  readonly centreNode: () => NodeRef;
  readonly trackActive: () => boolean;
  /** Whether the keyboard cursor, not the pointer, placed the track tool's target. */
  readonly cursorLeads: () => boolean;
  readonly dispatch: (event: ToolEvent) => void;
  /** The pointer moved over the canvas (CSS px) or left it; for the tooltip position. */
  readonly onPointer: (x: number, y: number, inside: boolean) => void;
  readonly actions: InputRouterActions;
}

/** Screen direction → lattice heading at yaw step k: right is 2k, up 2k + 3 (30° headings, CCW). */
export function cursorHeading(direction: CursorDirection, yawStep: number): Heading {
  const offset = direction === "right" ? 0 : direction === "up" ? 3 : direction === "left" ? 6 : 9;
  return ((((2 * yawStep + offset) % 12) + 12) % 12) as Heading;
}

const ARROW_CODES = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

export class InputRouter {
  private readonly abort = new AbortController();
  private readonly keys = { ctrl: false, alt: false };
  private readonly wheel = new WheelStepper();
  private readonly pointer = { x: 0, y: 0, inside: false };
  private toolPointer: number | undefined;
  private precision = false;
  /** The arrows moved the lattice cursor since the focused element took focus (see `keymap.ts`, Enter). */
  private cursorSinceFocus = false;

  constructor(private readonly o: InputRouterOptions) {
    const { canvas } = o;
    const signal = this.abort.signal;
    canvas.addEventListener("wheel", this.onWheel, { passive: false, signal });
    canvas.addEventListener("pointerdown", this.onPointerDown, { signal });
    canvas.addEventListener("pointermove", this.onPointerMove, { signal });
    canvas.addEventListener("pointerup", this.onPointerUp, { signal });
    canvas.addEventListener("pointercancel", this.onPointerUp, { signal });
    canvas.addEventListener("pointerleave", this.onPointerLeave, { signal });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });
    window.addEventListener("keydown", this.onKeyDown, { signal });
    window.addEventListener("keyup", this.onKeyUp, { signal });
    window.addEventListener("blur", this.onBlur, { signal });
    window.addEventListener("focusin", this.onFocusIn, { signal });
  }

  get precisionHeld(): boolean {
    return this.precision;
  }

  /** The pointer's last canvas position and whether it is over the canvas. */
  get pointerState(): { readonly x: number; readonly y: number; readonly inside: boolean } {
    return this.pointer;
  }

  /** The track tool took over: stop any arrow-key pan so the arrows belong to the cursor. */
  handToTool(): void {
    for (const code of ARROW_CODES) this.o.camera.releaseKey(code);
  }

  /**
   * Re-picks under a still pointer after the camera moved (or C chose another stacked pick, or H or U
   * changed what can be picked), so the ghost follows what is under it. Not while the keyboard cursor
   * leads: a camera move (its own keep-in-view pan included) never hands the target back to the mouse; a
   * real pointer move does. Returns whether it re-picked.
   */
  repick(): boolean {
    if (!this.pointer.inside || !this.o.trackActive() || this.o.camera.panning || this.o.cursorLeads()) return false;
    this.o.dispatch({ type: "pointer-move", pick: this.o.pick(this.pointer.x, this.pointer.y), screen: { x: this.pointer.x, y: this.pointer.y } });
    return true;
  }

  dispose(): void {
    this.abort.abort();
  }

  private context(): KeyContext {
    return { trackActive: this.o.trackActive(), precision: this.precision };
  }

  /** Tracks Ctrl/Alt from key events (never from wheel flags: a pinch fakes ctrlKey) and reports precision changes. */
  private syncModifiers(e: { key?: string; type?: string; ctrlKey: boolean; altKey: boolean }): void {
    if (e.key === "Control") this.keys.ctrl = e.type === "keydown";
    else this.keys.ctrl = e.ctrlKey;
    if (e.key === "Alt") this.keys.alt = e.type === "keydown";
    else this.keys.alt = e.altKey;
    const held = precisionHeld(this.keys, this.o.mac);
    if (held === this.precision) return;
    this.precision = held;
    if (this.o.trackActive()) this.o.dispatch({ type: "precision", held });
  }

  private screen(e: MouseEvent): { x: number; y: number } {
    const rect = this.o.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.syncModifiers(e);
    if (isEditable(e.target)) return;
    const action = classifyKey(e, this.context());
    // A focused HUD button handles its own Enter (and Space), unless the arrows have moved the cursor since it took focus.
    if (action.kind === "enter" && e.target instanceof HTMLButtonElement && !this.cursorSinceFocus) return;
    const { actions, dispatch } = this.o;
    switch (action.kind) {
      case "undo":
        e.preventDefault();
        actions.undo();
        return;
      case "redo":
        e.preventDefault();
        actions.redo();
        return;
      case "select-tool":
        if (!e.repeat) actions.selectTool(action.tool);
        return;
      case "toggle-decks":
        if (!e.repeat) actions.toggleDecks();
        return;
      case "toggle-xray":
        if (!e.repeat) actions.toggleXray();
        return;
      case "cycle-pick":
        e.preventDefault();
        if (!e.repeat) actions.cyclePick();
        return;
      case "escape":
        if (this.o.trackActive() && !e.repeat) dispatch({ type: "escape" });
        return;
      case "enter":
        e.preventDefault();
        if (!e.repeat) dispatch({ type: "enter" });
        return;
      case "cursor":
        e.preventDefault();
        this.cursorSinceFocus = true;
        dispatch({ type: "cursor-step", heading: cursorHeading(action.direction, this.o.yawStep()), origin: this.o.centreNode() });
        return;
      case "height":
        e.preventDefault();
        dispatch({ type: "height", delta: action.delta });
        return;
      case "end-heading":
        e.preventDefault();
        if (!e.repeat) dispatch({ type: "end-heading-step", delta: action.delta });
        return;
      case "labels":
        if (!e.repeat) actions.toggleLabels();
        return;
      case "perf":
        e.preventDefault();
        if (!e.repeat) actions.togglePerf();
        return;
      case "camera":
        this.o.camera.handleKeyDown(e);
        return;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.syncModifiers(e);
    this.o.camera.handleKeyUp(e);
  };

  private readonly onFocusIn = (): void => {
    this.cursorSinceFocus = false;
  };

  private readonly onBlur = (): void => {
    this.keys.ctrl = false;
    this.keys.alt = false;
    this.syncModifiers({ ctrlKey: false, altKey: false });
    this.o.camera.handleBlur();
    if (this.toolPointer !== undefined) {
      this.toolPointer = undefined;
      this.o.dispatch({ type: "escape" });
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    const action = this.wheel.classify(e, this.context());
    if (action.kind === "camera") {
      this.o.camera.handleWheel(e);
      return;
    }
    e.preventDefault();
    const delta = action.steps > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(action.steps); i++) {
      this.o.dispatch(action.kind === "height" ? { type: "height", delta } : { type: "radius-step", delta });
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.syncModifiers(e);
    if (e.button === 0 && this.o.trackActive()) {
      if (this.toolPointer !== undefined) return;
      e.preventDefault();
      this.o.canvas.focus({ preventScroll: true });
      this.o.canvas.setPointerCapture(e.pointerId);
      this.toolPointer = e.pointerId;
      const screen = this.screen(e);
      this.o.dispatch({ type: "pointer-down", pick: this.o.pick(screen.x, screen.y), screen });
      return;
    }
    // Right and middle always pan; left pans while no tool is active.
    this.o.camera.handlePointerDown(e);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const screen = this.screen(e);
    // A move event that did not move (browsers send them after layout changes) leaves the keyboard cursor's target alone.
    const still = this.pointer.inside && screen.x === this.pointer.x && screen.y === this.pointer.y;
    this.pointer.x = screen.x;
    this.pointer.y = screen.y;
    this.pointer.inside = true;
    this.o.onPointer(screen.x, screen.y, true);
    if (this.o.camera.handlePointerMove(e)) return;
    if (e.pointerType === "mouse" && this.toolPointer === undefined) this.syncModifiers(e);
    if (this.o.trackActive() && !(still && this.o.cursorLeads())) this.o.dispatch({ type: "pointer-move", pick: this.o.pick(screen.x, screen.y), screen });
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.o.camera.handlePointerUp(e)) return;
    if (e.pointerId !== this.toolPointer) return;
    this.toolPointer = undefined;
    if (this.o.canvas.hasPointerCapture(e.pointerId)) this.o.canvas.releasePointerCapture(e.pointerId);
    if (e.type === "pointercancel") {
      this.o.dispatch({ type: "escape" });
      return;
    }
    const screen = this.screen(e);
    this.o.dispatch({ type: "pointer-up", pick: this.o.pick(screen.x, screen.y), screen });
  };

  private readonly onPointerLeave = (): void => {
    this.pointer.inside = false;
    this.o.onPointer(this.pointer.x, this.pointer.y, false);
    if (this.toolPointer === undefined && this.o.trackActive()) this.o.dispatch({ type: "pointer-leave" });
  };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}
