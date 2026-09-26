import { type Camera, Scene, Vector3 } from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { cssColor, cssRgba, palette } from "../art/palette";
import { type IsoView, worldToScreen } from "../camera/isoMath";
import { type LabelBox, declutter } from "./declutter";

/**
 * Place-name labels (art direction "Typography and labels", architecture
 * "Labels"): CSS2D elements in their own `labelScene`, drawn by a
 * `CSS2DRenderer` over the canvas, so they stay crisp at any zoom and screen
 * readers get the visible names. Town and landmark names use the self-hosted
 * EB Garamond. Labels are laid out again only when the camera (or the label
 * set, or a font load) changes, never per frame; a greedy declutter keeps the
 * higher-priority name where two collide. L toggles them.
 *
 * A label's box can only be measured once `CSS2DRenderer` has attached and
 * shown its element, so a layout that had to guess a size asks for one more
 * frame (`onInvalidate`) and lays out again from the real size; so does a
 * font load. Without that, an idle page (reduced motion) would keep the guesses.
 */

export interface PlaceLabel {
  readonly text: string;
  readonly kind: "town" | "landmark";
  /** World-space anchor: the label's bottom centre sits here. */
  readonly world: Vector3;
  readonly priority: number;
  readonly minPpm: number;
}

/** Town names hide below Far (0.9 ppm); landmark names below the mid band. */
export const TOWN_LABEL_MIN_PPM = 0.9;
export const LANDMARK_LABEL_MIN_PPM = 2;
/** Follow-up layouts after a guessed label size; newly shown labels normally need one. */
const MAX_REMEASURES = 4;

export class LabelLayer {
  readonly renderer = new CSS2DRenderer();
  readonly scene = new Scene();
  private readonly objects: CSS2DObject[] = [];
  private readonly boxes: LabelBox[];
  private readonly visible: Uint8Array;
  private readonly order: Int32Array;
  /** Last measured width and height per label; hidden labels measure 0, so keep what we saw. */
  private readonly sizes: Float32Array;
  private readonly screen = { x: 0, y: 0 };
  private readonly viewportSize = { width: 0, height: 0 };
  private readonly last = { x: Number.NaN, z: Number.NaN, ppm: Number.NaN, yaw: Number.NaN, w: 0, h: 0 };
  private dirty = true;
  private shown = true;
  private disposed = false;
  /** Re-measure frames asked for since the view last changed. */
  private remeasures = 0;
  private readonly onFontsLoaded = (): void => {
    if (this.disposed) return;
    this.remeasures = 0;
    this.sizes.fill(0);
    this.invalidate();
    this.onInvalidate?.();
  };

  /** `onInvalidate` asks the host for a frame when the layout must run again without a camera change. */
  constructor(
    private readonly container: HTMLElement,
    readonly labels: readonly PlaceLabel[],
    private readonly onInvalidate?: () => void,
  ) {
    const el = this.renderer.domElement;
    Object.assign(el.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "3" } satisfies Partial<CSSStyleDeclaration>);
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Place names");
    container.appendChild(el);
    for (const label of labels) {
      const div = document.createElement("div");
      div.textContent = label.text;
      Object.assign(div.style, labelStyle(label.kind));
      const object = new CSS2DObject(div);
      object.position.copy(label.world);
      object.center.set(0.5, 1);
      this.scene.add(object);
      this.objects.push(object);
    }
    this.boxes = labels.map((l) => ({ x: 0, y: 0, width: 0, height: 0, priority: l.priority, minPpm: l.minPpm }));
    this.visible = new Uint8Array(labels.length);
    this.order = new Int32Array(labels.length);
    this.sizes = new Float32Array(2 * labels.length);
    // Web fonts change the boxes once they arrive. `ready` can resolve before a later face
    // (the latin-ext subset for ē or ž) loads, so every finished load re-measures too.
    void document.fonts?.ready.then(this.onFontsLoaded);
    document.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
  }

  get enabled(): boolean {
    return this.shown;
  }

  /** L: shows or hides every label. */
  toggle(): boolean {
    this.shown = !this.shown;
    this.renderer.domElement.style.display = this.shown ? "" : "none";
    this.invalidate();
    return this.shown;
  }

  setSize(cssWidth: number, cssHeight: number): void {
    this.renderer.setSize(cssWidth, cssHeight);
    this.invalidate();
  }

  /** Forces a layout on the next update (label set, fonts or size changed). */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Call after the camera update. Lays the labels out and renders them only if
   * the view changed since last time; returns whether it did.
   */
  update(view: IsoView, camera: Camera): boolean {
    if (!this.shown) return false;
    const l = this.last;
    const moved = l.x !== view.target.x || l.z !== view.target.z || l.ppm !== view.ppm || l.yaw !== view.yaw || l.w !== view.cssWidth || l.h !== view.cssHeight;
    if (!this.dirty && !moved) return false;
    if (moved) this.remeasures = 0;
    this.dirty = false;
    l.x = view.target.x;
    l.z = view.target.z;
    l.ppm = view.ppm;
    l.yaw = view.yaw;
    l.w = view.cssWidth;
    l.h = view.cssHeight;
    for (let i = 0; i < this.objects.length; i++) {
      const object = this.objects[i] as CSS2DObject;
      const box = this.boxes[i] as LabelBox;
      worldToScreen(view, object.position, this.screen);
      box.x = this.screen.x;
      box.y = this.screen.y;
      const width = object.element.offsetWidth;
      if (width > 0) {
        this.sizes[2 * i] = width;
        this.sizes[2 * i + 1] = object.element.offsetHeight;
      }
      // Never measured (not yet rendered): a generous guess until the next layout.
      box.width = this.sizes[2 * i] || 8 * (this.labels[i]?.text.length ?? 8) + 16;
      box.height = this.sizes[2 * i + 1] || 22;
    }
    this.viewportSize.width = view.cssWidth;
    this.viewportSize.height = view.cssHeight;
    declutter(this.boxes, view.ppm, this.viewportSize, this.visible, this.order);
    let guessed = false;
    for (let i = 0; i < this.objects.length; i++) {
      const shown = this.visible[i] === 1;
      (this.objects[i] as CSS2DObject).visible = shown;
      if (shown && this.sizes[2 * i] === 0) guessed = true;
    }
    this.renderer.render(this.scene, camera);
    if (guessed && this.remeasures < MAX_REMEASURES) {
      // The render just attached and showed those labels: measure them next frame. Capped,
      // so a label that never gets a size cannot keep frames coming.
      this.remeasures += 1;
      this.dirty = true;
      this.onInvalidate?.();
    }
    return true;
  }

  dispose(): void {
    this.disposed = true;
    document.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    for (const object of this.objects) object.element.remove();
    this.scene.clear();
    this.renderer.domElement.remove();
  }
}

function labelStyle(kind: PlaceLabel["kind"]): Partial<CSSStyleDeclaration> {
  const town = kind === "town";
  return {
    font: town ? '500 17px "EB Garamond", Georgia, serif' : '500 13px "EB Garamond", Georgia, serif',
    letterSpacing: town ? "0.05em" : "0.02em",
    color: cssColor(palette.uiInk),
    background: cssRgba(palette.uiParchment, town ? 0.88 : 0.72),
    border: `1px solid ${cssColor(palette.uiBorder)}`,
    borderRadius: "2px",
    padding: town ? "0 8px 1px" : "0 5px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
    marginBottom: "4px",
  };
}
