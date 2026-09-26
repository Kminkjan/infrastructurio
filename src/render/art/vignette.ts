import { cssRgba, palette } from "./palette";

/**
 * The CSS vignette (art direction "Light": Medium and High frame the view with
 * it, and the base look needs no post pass). A radial gradient in a
 * non-interactive overlay above the canvas and below the labels, darkening the
 * corners toward the UI ink colour.
 */

export const VIGNETTE_STRENGTH = 0.2;

/** The overlay's CSS background for a strength (corner opacity) in 0–1. */
export function vignetteBackground(strength: number): string {
  const a = Math.min(1, Math.max(0, strength));
  return `radial-gradient(ellipse 75% 70% at 50% 46%, ${cssRgba(palette.uiInk, 0)} 55%, ${cssRgba(palette.uiInk, a)} 100%)`;
}

export class Vignette {
  readonly element: HTMLDivElement;
  private value: number;

  constructor(parent: HTMLElement, strength = VIGNETTE_STRENGTH) {
    this.value = strength;
    this.element = document.createElement("div");
    this.element.setAttribute("aria-hidden", "true");
    Object.assign(this.element.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "2" } satisfies Partial<CSSStyleDeclaration>);
    this.element.style.background = vignetteBackground(strength);
    parent.appendChild(this.element);
  }

  get strength(): number {
    return this.value;
  }

  setStrength(strength: number): void {
    this.value = strength;
    this.element.style.background = vignetteBackground(strength);
  }

  dispose(): void {
    this.element.remove();
  }
}
