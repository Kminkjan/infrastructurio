import { DirectionalLight, HemisphereLight, type Scene } from "three";
import type { IsoView } from "../camera/isoMath";
import { palette } from "./palette";
import { SUN_ELEVATION_RAD, type WorldBox, createShadowFit, fitShadowFrustum, sunDirection } from "./shadowFit";

/**
 * Scene lighting (art direction "Light"): a sky/ground hemisphere fill and one
 * warm sun at 42° elevation whose direction follows the camera yaw, so light
 * always comes from the screen's upper left and shadows keep the same length.
 * One PCF shadow map is refitted to the view every frame (see shadowFit.ts).
 */

export const HEMISPHERE_INTENSITY = 1.1;
export const SUN_INTENSITY = 2.4;
export const SHADOW_MAP_SIZE = 2048;
export const SHADOW_INTENSITY = 0.72;
export const SHADOW_RADIUS = 3;
export const SHADOW_BIAS = -0.0004;
export const SHADOW_NORMAL_BIAS = 0.03;

export class SceneLighting {
  readonly hemisphere: HemisphereLight;
  readonly sun: DirectionalLight;
  /** Sun elevation; only the lookdev tweak panel moves it off 42°. */
  sunElevationRad = SUN_ELEVATION_RAD;
  private readonly fit = createShadowFit();
  private readonly sunDir = { x: 0, y: 1, z: 0 };
  private readonly heights = { minM: 0, maxM: 0 };

  constructor(
    private readonly scene: Scene,
    private readonly mapSize: number = SHADOW_MAP_SIZE,
  ) {
    this.hemisphere = new HemisphereLight(palette.sky, palette.groundBounce, HEMISPHERE_INTENSITY);
    this.sun = new DirectionalLight(palette.sun, SUN_INTENSITY);
    this.sun.castShadow = true;
    const shadow = this.sun.shadow;
    shadow.mapSize.set(mapSize, mapSize);
    shadow.intensity = SHADOW_INTENSITY;
    shadow.radius = SHADOW_RADIUS;
    shadow.bias = SHADOW_BIAS;
    shadow.normalBias = SHADOW_NORMAL_BIAS;
    scene.add(this.hemisphere, this.sun, this.sun.target);
  }

  /**
   * Call each frame after the camera update: turns the sun with the yaw and
   * refits the shadow camera to the footprint of `view` over the terrain box.
   */
  update(view: IsoView, terrain: WorldBox): void {
    sunDirection(view.yaw, this.sunDir, this.sunElevationRad);
    this.heights.minM = terrain.minY;
    this.heights.maxM = terrain.maxY;
    const fit = fitShadowFrustum(view, this.heights, this.sunDir, this.mapSize, terrain, this.fit);
    this.sun.position.set(fit.position.x, fit.position.y, fit.position.z);
    this.sun.target.position.set(fit.target.x, fit.target.y, fit.target.z);
    const camera = this.sun.shadow.camera;
    camera.left = fit.left;
    camera.right = fit.right;
    camera.top = fit.top;
    camera.bottom = fit.bottom;
    camera.near = fit.near;
    camera.far = fit.far;
    camera.updateProjectionMatrix();
  }

  /** Re-reads the light colours from the palette (after a tweak-panel override). */
  syncColors(): void {
    this.hemisphere.color.setHex(palette.sky);
    this.hemisphere.groundColor.setHex(palette.groundBounce);
    this.sun.color.setHex(palette.sun);
  }

  dispose(): void {
    this.scene.remove(this.hemisphere, this.sun, this.sun.target);
    this.sun.shadow.dispose();
    this.hemisphere.dispose();
    this.sun.dispose();
  }
}
