import { OrthographicCamera, Ray } from "three";
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  type GroundPoint,
  ISO_PITCH_RAD,
  type IsoView,
  YAW_STEP_RAD,
  cameraOffset,
  clampPpm,
  easeInOutCubic,
  normalizeYawStep,
  screenRay,
  yawForStep,
} from "./isoMath";

/** Duration of one Q/E yaw step. */
export const ROTATE_DURATION_MS = 300;

export interface IsoCameraOptions {
  readonly target: GroundPoint;
  readonly ppm: number;
  readonly yawStep?: number;
  readonly pitch?: number;
  readonly reducedMotion?: () => boolean;
}

interface YawAnimation {
  readonly from: number;
  readonly to: number;
  /** Set on the first `update` after `rotate`, so the ease starts with a frame. */
  startMs: number | undefined;
}

/**
 * Thin wrapper over three's OrthographicCamera holding the view state
 * {target, ppm, yawStep, animYaw}. It satisfies `IsoView`, so the pure maths in
 * isoMath.ts reads it directly; `update` copies that state into the three
 * camera once per frame without allocating.
 */
export class IsoCamera implements IsoView {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);
  /** Look-at point on the Y = 0 datum. Mutate in place; `update` applies it. */
  readonly target: GroundPoint;
  readonly pitch: number;
  ppm: number;
  /** Logical yaw step, 0..5; the view eases toward it. */
  yawStep: number;
  /** Displayed yaw in radians; continuous during a rotation. */
  animYaw: number;
  cssWidth = 1;
  cssHeight = 1;
  private anim: YawAnimation | undefined;
  private readonly reducedMotion: () => boolean;
  private readonly offset = { x: 0, y: 0, z: 0 };
  private readonly scratchRay = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };

  constructor(options: IsoCameraOptions) {
    this.target = { x: options.target.x, z: options.target.z };
    this.ppm = clampPpm(options.ppm);
    this.pitch = options.pitch ?? ISO_PITCH_RAD;
    this.yawStep = normalizeYawStep(options.yawStep ?? 0);
    this.animYaw = yawForStep(this.yawStep);
    this.reducedMotion = options.reducedMotion ?? (() => false);
  }

  get yaw(): number {
    return this.animYaw;
  }

  get rotating(): boolean {
    return this.anim !== undefined;
  }

  setViewport(cssWidth: number, cssHeight: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
  }

  /**
   * Steps the yaw by ±60°, easing over 300 ms (instant under reduced motion).
   * A second press mid-ease continues from the current angle toward the new
   * step, so rapid presses never snap back.
   */
  rotate(direction: 1 | -1): void {
    const to = (this.anim?.to ?? this.animYaw) + direction * YAW_STEP_RAD;
    this.yawStep = normalizeYawStep(this.yawStep + direction);
    if (this.reducedMotion()) {
      this.anim = undefined;
      this.animYaw = yawForStep(this.yawStep);
      return;
    }
    this.anim = { from: this.animYaw, to, startMs: undefined };
  }

  /** Advances the yaw ease and applies the state to the three camera. True while animating. */
  update(nowMs: number): boolean {
    const anim = this.anim;
    if (anim) {
      if (anim.startMs === undefined) anim.startMs = nowMs;
      const t = (nowMs - anim.startMs) / ROTATE_DURATION_MS;
      if (t >= 1) {
        // Land exactly on the step, normalized, so yaw never drifts or grows.
        this.animYaw = yawForStep(this.yawStep);
        this.anim = undefined;
      } else {
        this.animYaw = anim.from + (anim.to - anim.from) * easeInOutCubic(t);
      }
    }

    const halfW = this.cssWidth / (2 * this.ppm);
    const halfH = this.cssHeight / (2 * this.ppm);
    const camera = this.camera;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    cameraOffset(this.animYaw, this.pitch, undefined, this.offset);
    camera.position.set(this.target.x + this.offset.x, this.offset.y, this.target.z + this.offset.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target.x, 0, this.target.z);
    camera.updateMatrixWorld();
    return this.anim !== undefined;
  }

  /**
   * The view ray through a CSS pixel of the viewport, from the current state
   * (not the three camera's last update), so input handlers see their own
   * changes at once.
   */
  screenToGroundRay(cssX: number, cssY: number, out: Ray = new Ray()): Ray {
    const { origin, direction } = screenRay(this, cssX, cssY, this.scratchRay);
    out.origin.set(origin.x, origin.y, origin.z);
    out.direction.set(direction.x, direction.y, direction.z);
    return out;
  }
}
