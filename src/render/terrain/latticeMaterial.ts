import { Color, MeshLambertMaterial, Vector2 } from "three";
import { palette } from "../art/palette";
import { type LatticeUniforms, installLatticeChunk } from "../art/shaderChunks/lattice";

export { latticeFamilyDistancesM } from "../art/shaderChunks/lattice";

/**
 * The terrain's material: vertex-coloured Lambert (smooth-shaded, FrontSide)
 * carrying the lattice overlay (art direction "Terrain and water").
 * View mode shows no lattice; build mode fades it in over 150 ms at 0.15
 * opacity, 0.55 within 48 m of the cursor, and hides it wherever lines would
 * sit under 5 px apart. D1 toggles build mode with a debug key; D3 ties it to
 * tool activation.
 */

export const LATTICE_BUILD_FADE_MS = 150;
export const LATTICE_GLOBAL_OPACITY = 0.15;
export const LATTICE_NEAR_OPACITY = 0.55;
export const LATTICE_REVEAL_RADIUS_M = 48;
/** Line width in CSS px; `setPixelRatio` turns it into the shader's device px. */
export const LATTICE_LINE_WIDTH_PX = 1;
/** Dot radius in CSS px; with 1 px lines a 1.5 px dot reads as a node without crowding. */
export const LATTICE_DOT_RADIUS_PX = 1.5;
export const LATTICE_FADE_BELOW_PX = 5;
/** Where the cursor goes when the pointer leaves: far enough that nothing is revealed. */
const NO_CURSOR = 1e7;

export class LatticeOverlay {
  /** Terrain material. */
  readonly material: MeshLambertMaterial;
  /** Water material: the lattice shows over water too, where bridges will go (D4). */
  readonly waterMaterial: MeshLambertMaterial;
  readonly uniforms: LatticeUniforms;
  private target = 0;
  private fadeFrom = 0;
  private fadeStartMs: number | undefined;

  constructor(private readonly reducedMotion: () => boolean) {
    this.uniforms = {
      uBuildMode: { value: 0 },
      uCursor: { value: new Vector2(NO_CURSOR, NO_CURSOR) },
      uGlobalOpacity: { value: LATTICE_GLOBAL_OPACITY },
      uNearOpacity: { value: LATTICE_NEAR_OPACITY },
      uRevealRadius: { value: LATTICE_REVEAL_RADIUS_M },
      uLineColor: { value: new Color(palette.latticeLine) },
      uLinePx: { value: 0 },
      uLineWidthPx: { value: LATTICE_LINE_WIDTH_PX },
      uDotRadiusPx: { value: LATTICE_DOT_RADIUS_PX },
      uFadeBelowPx: { value: LATTICE_FADE_BELOW_PX },
    };
    this.material = new MeshLambertMaterial({ vertexColors: true });
    this.waterMaterial = new MeshLambertMaterial({ vertexColors: true });
    // Same uniforms and program: the two materials differ only in the meshes they draw.
    installLatticeChunk(this.material, this.uniforms);
    installLatticeChunk(this.waterMaterial, this.uniforms);
  }

  get buildMode(): boolean {
    return this.target === 1;
  }

  setBuildMode(on: boolean): void {
    const target = on ? 1 : 0;
    if (target === this.target) return;
    this.target = target;
    this.fadeFrom = this.uniforms.uBuildMode.value;
    this.fadeStartMs = undefined;
    if (this.reducedMotion()) this.uniforms.uBuildMode.value = target;
  }

  toggleBuildMode(): boolean {
    this.setBuildMode(!this.buildMode);
    return this.buildMode;
  }

  /**
   * Device pixels per CSS pixel of the drawing buffer (`ViewportSize.pixelRatio`).
   * The shader measures widths with dFdx/dFdy, which count buffer pixels, so
   * without this a DPR-2 screen would draw half-width lines and dots. The
   * ±0.5 px antialiasing band stays in device pixels, one screen pixel wide.
   */
  setPixelRatio(ratio: number): void {
    this.uniforms.uLineWidthPx.value = LATTICE_LINE_WIDTH_PX * ratio;
    this.uniforms.uDotRadiusPx.value = LATTICE_DOT_RADIUS_PX * ratio;
  }

  /** The cursor reveal centre in world XZ. */
  setCursor(x: number, z: number): void {
    this.uniforms.uCursor.value.set(x, z);
  }

  clearCursor(): void {
    this.uniforms.uCursor.value.set(NO_CURSOR, NO_CURSOR);
  }

  /**
   * Per frame: advances the build-mode fade and records the tightest on-screen
   * line spacing (`minLatticeLineSpacingPx`). Returns true while the fade runs.
   */
  update(nowMs: number, linePx: number): boolean {
    this.uniforms.uLinePx.value = linePx;
    const u = this.uniforms.uBuildMode;
    if (u.value === this.target) return false;
    if (this.fadeStartMs === undefined) this.fadeStartMs = nowMs;
    const t = (nowMs - this.fadeStartMs) / LATTICE_BUILD_FADE_MS;
    u.value = t >= 1 ? this.target : this.fadeFrom + (this.target - this.fadeFrom) * Math.max(0, t);
    return u.value !== this.target;
  }

  dispose(): void {
    this.material.dispose();
    this.waterMaterial.dispose();
  }
}
