import { NeutralToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from "three";
import { MAX_PIXEL_RATIO, type ViewportSize, computeViewportSize, sameViewportSize } from "./viewportSize";

/**
 * Owns the WebGLRenderer and keeps its drawing buffer matched to the viewport
 * (ADR 0009, art direction "Light"). It never renders by itself: size changes
 * go to `onResize`, and the app asks the scheduler for a frame.
 *
 * Resizing a canvas clears its drawing buffer, and ResizeObserver callbacks
 * run after the frame's rAF callbacks but before paint. Resizing inside the
 * observer would therefore paint a blank canvas on every step of a drag
 * resize. So a new size is only recorded as pending, and `syncSize()` applies
 * it in the frame that renders into it.
 *
 * The buffer is sized in device pixels directly (pixel ratio 1 in three), so
 * `devicePixelContentBoxSize` can be honoured exactly; the canvas keeps its
 * CSS size from index.html.
 */
export class RendererHost {
  readonly renderer: WebGLRenderer;
  private readonly observer: ResizeObserver;
  private dprQuery: MediaQueryList | undefined;
  private current: ViewportSize | undefined;
  /** A size reported to `onResize` but not yet applied to the drawing buffer. */
  private pending: ViewportSize | undefined;
  private lastCss = { width: 1, height: 1 };
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    viewport: HTMLElement,
    private readonly onResize: (size: ViewportSize) => void,
    private readonly maxPixelRatio: number = MAX_PIXEL_RATIO,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(1);

    this.observer = new ResizeObserver((entries) => this.handleEntries(entries));
    try {
      // Observing device pixels also fires on DPR-only changes (browser zoom, monitor moves).
      this.observer.observe(viewport, { box: "device-pixel-content-box" });
    } catch {
      this.observer.observe(viewport);
    }
    this.watchDevicePixelRatio();
    this.apply({ cssWidth: viewport.clientWidth, cssHeight: viewport.clientHeight, devicePixelRatio: window.devicePixelRatio });
  }

  get size(): ViewportSize {
    return this.current ?? computeViewportSize({ cssWidth: 1, cssHeight: 1, devicePixelRatio: 1 });
  }

  /** Applies a pending size to the drawing buffer. Call in the frame, right before rendering. */
  syncSize(): void {
    const size = this.pending;
    if (size === undefined) return;
    this.pending = undefined;
    this.renderer.setSize(size.pixelWidth, size.pixelHeight, false);
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.dprQuery?.removeEventListener("change", this.handleDprChange);
    this.dprQuery = undefined;
    this.renderer.dispose();
  }

  private handleEntries(entries: ResizeObserverEntry[]): void {
    const entry = entries[entries.length - 1];
    if (!entry || this.disposed) return;
    const content = entry.contentBoxSize?.[0];
    const device = entry.devicePixelContentBoxSize?.[0];
    this.apply({
      cssWidth: content?.inlineSize ?? entry.contentRect.width,
      cssHeight: content?.blockSize ?? entry.contentRect.height,
      devicePixelRatio: window.devicePixelRatio,
      devicePixelWidth: device?.inlineSize,
      devicePixelHeight: device?.blockSize,
    });
  }

  /**
   * A `(resolution: Ndppx)` query matches only the current DPR, so it fires
   * once when the DPR changes and must be re-registered for the new value.
   */
  private watchDevicePixelRatio(): void {
    this.dprQuery?.removeEventListener("change", this.handleDprChange);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener("change", this.handleDprChange);
  }

  private readonly handleDprChange = (): void => {
    if (this.disposed) return;
    this.watchDevicePixelRatio();
    // Device-pixel sizes from the last observation are stale now; the observer refines them.
    this.apply({ cssWidth: this.lastCss.width, cssHeight: this.lastCss.height, devicePixelRatio: window.devicePixelRatio });
  };

  private apply(measure: Parameters<typeof computeViewportSize>[0]): void {
    const size = computeViewportSize(measure, this.maxPixelRatio);
    this.lastCss = { width: size.cssWidth, height: size.cssHeight };
    if (sameViewportSize(this.current, size)) return;
    this.current = size;
    this.pending = size;
    this.onResize(size);
  }
}
