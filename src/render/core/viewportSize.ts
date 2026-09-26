/**
 * Drawing-buffer sizing for `RendererHost`, kept pure so it is testable.
 *
 * `devicePixelContentBoxSize` (Chromium, Firefox) gives the canvas's exact
 * device-pixel size, so the buffer maps 1:1 onto screen pixels without the
 * blur that rounding css × dpr can cause. Where it is missing (Safari) we fall
 * back to rounding. DPR is capped (2 by default) to bound fill cost on dense
 * phone and 4K screens.
 */

export const MAX_PIXEL_RATIO = 2;

export interface ViewportMeasure {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  /** From `ResizeObserverEntry.devicePixelContentBoxSize`, when the browser has it. */
  readonly devicePixelWidth?: number | undefined;
  readonly devicePixelHeight?: number | undefined;
}

export interface ViewportSize {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Effective device pixels per CSS pixel of the drawing buffer. */
  readonly pixelRatio: number;
}

export function computeViewportSize(m: ViewportMeasure, maxPixelRatio: number = MAX_PIXEL_RATIO): ViewportSize {
  const cssWidth = Math.max(1, m.cssWidth);
  const cssHeight = Math.max(1, m.cssHeight);
  const dpr = m.devicePixelRatio > 0 && Number.isFinite(m.devicePixelRatio) ? m.devicePixelRatio : 1;
  const ratio = Math.min(dpr, maxPixelRatio);
  let pixelWidth: number;
  let pixelHeight: number;
  if (m.devicePixelWidth !== undefined && m.devicePixelHeight !== undefined && m.devicePixelWidth > 0 && m.devicePixelHeight > 0) {
    // Exact device pixels, scaled down only when the DPR is over the cap.
    const scale = ratio / dpr;
    pixelWidth = scale === 1 ? m.devicePixelWidth : Math.round(m.devicePixelWidth * scale);
    pixelHeight = scale === 1 ? m.devicePixelHeight : Math.round(m.devicePixelHeight * scale);
  } else {
    pixelWidth = Math.round(cssWidth * ratio);
    pixelHeight = Math.round(cssHeight * ratio);
  }
  pixelWidth = Math.max(1, pixelWidth);
  pixelHeight = Math.max(1, pixelHeight);
  return { cssWidth, cssHeight, pixelWidth, pixelHeight, pixelRatio: pixelWidth / cssWidth };
}

export function sameViewportSize(a: ViewportSize | undefined, b: ViewportSize): boolean {
  return (
    a !== undefined &&
    a.cssWidth === b.cssWidth &&
    a.cssHeight === b.cssHeight &&
    a.pixelWidth === b.pixelWidth &&
    a.pixelHeight === b.pixelHeight
  );
}
