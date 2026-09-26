import { WHEEL_ZOOM_FACTOR } from "./isoMath";

/**
 * Pure input → camera rules, kept out of `CameraController` so they can be
 * tested without a DOM (architecture "Camera": wheel 1.15 per notch, pinch as
 * ctrl-wheel, WASD at 700 CSS px/s with small inertia, off under reduced motion).
 */

/** Keyboard pan speed on screen, whatever the zoom. */
export const KEY_PAN_SPEED_PX_S = 700;
/** Velocity kept per 16 ms after the keys are released. */
export const KEY_PAN_DECAY_PER_16MS = 0.9;
/** Below this the glide stops, so the loop can go idle. */
export const KEY_PAN_STOP_PX_S = 5;
/** Longest frame step the pan integrates, so a hitch never teleports the view. */
export const KEY_PAN_MAX_DT_MS = 50;

/** A classic mouse notch reports 100 px (DOM_DELTA_PIXEL) or 3 lines (DOM_DELTA_LINE). */
const PIXELS_PER_NOTCH = 100;
const PIXELS_PER_LINE = PIXELS_PER_NOTCH / 3;
/** One page scroll counts as one notch; it is rare and should not leap. */
const PIXELS_PER_PAGE = PIXELS_PER_NOTCH;
/** Caps a single event so a flung trackpad never jumps more than 3 notches. */
const MAX_PIXELS_PER_EVENT = 3 * PIXELS_PER_NOTCH;
/** Pinch deltas are small and frequent; e^(−0.01·px) gives a natural pinch rate. */
const PINCH_PER_PIXEL = 0.01;

/**
 * Multiplier for ppm from one wheel event. Scrolling down (positive deltaY)
 * zooms out. Browsers deliver a trackpad pinch as a ctrl-wheel event with small
 * deltas, so it gets its own rate.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const perUnit = deltaMode === 1 ? PIXELS_PER_LINE : deltaMode === 2 ? PIXELS_PER_PAGE : 1;
  const pixels = Math.max(-MAX_PIXELS_PER_EVENT, Math.min(MAX_PIXELS_PER_EVENT, deltaY * perUnit));
  if (ctrlKey) return Math.exp(-pixels * PINCH_PER_PIXEL);
  return Math.pow(WHEEL_ZOOM_FACTOR, -pixels / PIXELS_PER_NOTCH);
}

/** Held pan keys, as screen directions. */
export interface PanKeys {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
}

/** Keyboard pan velocity of the view in CSS px/s, x right and y up. */
export interface PanVelocity {
  vx: number;
  vy: number;
}

/**
 * Advances the keyboard pan velocity by `dtMs` and reports whether the view is
 * still moving. Held keys set full speed at once (diagonals normalized, so
 * they are not faster); released keys glide out with 0.9 per 16 ms. Under
 * reduced motion there is no glide.
 */
export function stepKeyPan(v: PanVelocity, keys: PanKeys, dtMs: number, reducedMotion: boolean): boolean {
  const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const y = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
  if (x !== 0 || y !== 0) {
    const scale = KEY_PAN_SPEED_PX_S / Math.hypot(x, y);
    v.vx = x * scale;
    v.vy = y * scale;
    return true;
  }
  if (reducedMotion) {
    v.vx = 0;
    v.vy = 0;
    return false;
  }
  const decay = Math.pow(KEY_PAN_DECAY_PER_16MS, Math.max(0, dtMs) / 16);
  v.vx *= decay;
  v.vy *= decay;
  if (Math.hypot(v.vx, v.vy) < KEY_PAN_STOP_PX_S) {
    v.vx = 0;
    v.vy = 0;
    return false;
  }
  return true;
}
