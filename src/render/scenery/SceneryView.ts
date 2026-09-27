import {
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  RGFormat,
  RedFormat,
  UnsignedByteType,
} from "three";
import type { DioramaScenery } from "../../core/scenarios/baltic-diorama";
import { type Terrain, terrainBoundsM } from "../../core/terrain";
import type { AssetRegistry } from "../art/AssetRegistry";
import type { ArtUniforms, WorldMaterials } from "../art/materials";
import { BuildingLayer } from "./buildings/BuildingLayer";
import { registerBuildingAssets } from "./buildings/grammar";
import { PropLayer, registerPropAssets } from "./props";
import { type SplatMaps, buildSplatMaps } from "./splatMap";
import { TreeLayer, registerTreeAssets } from "./trees";

/**
 * The static diorama's scenery (render slice R3): instanced trees, merged
 * buildings, instanced props, and the terrain's splat, field and AO textures,
 * all built once from the scenario layout. `update` runs each frame and only
 * flips LOD flags and advances the windmill; it allocates nothing.
 */

/** Registers every procedural scenery provider (trees, buildings, props). */
export function registerSceneryAssets(registry: AssetRegistry): void {
  registerTreeAssets(registry);
  registerBuildingAssets(registry);
  registerPropAssets(registry);
}

export class SceneryView {
  readonly group = new Group();
  readonly trees: TreeLayer;
  readonly buildings: BuildingLayer;
  readonly props: PropLayer;
  readonly maps: SplatMaps;
  private readonly textures: DataTexture[] = [];

  constructor(scenery: DioramaScenery, terrain: Terrain, registry: AssetRegistry, materials: WorldMaterials, uniforms: ArtUniforms) {
    this.group.name = "scenery";
    const bounds = terrainBoundsM(terrain);
    this.maps = buildSplatMaps(scenery, { widthM: bounds.maxX, heightM: bounds.maxY });
    const m = this.maps;

    const splat = this.texture(new DataTexture(m.splat, m.width, m.height, RGBAFormat, UnsignedByteType), true);
    const field = this.texture(new DataTexture(m.field, m.width, m.height, RGFormat, UnsignedByteType), false);
    const ao = this.texture(new DataTexture(m.ao, m.aoWidth, m.aoHeight, RedFormat, UnsignedByteType), true);
    uniforms.splat.uSplatMap.value = splat;
    uniforms.splat.uFieldMap.value = field;
    uniforms.splat.uAoMap.value = ao;
    uniforms.splat.uSplatSizeM.value.set(m.width * m.texelM, m.height * m.texelM);
    uniforms.splat.uAoSizeM.value.set(m.aoSizeM.x, m.aoSizeM.y);

    this.trees = new TreeLayer(scenery.trees, terrain, registry, materials.foliage);
    this.buildings = new BuildingLayer(scenery, terrain, registry, materials);
    this.props = new PropLayer(scenery, terrain, registry, materials.props);
    this.group.add(this.trees.group, this.buildings.group, this.props.group);
  }

  /** Whether anything sways or turns, so the app knows whether `ambient` has work. */
  get animated(): boolean {
    return this.trees.instanceCount > 0 || this.buildings.animated;
  }

  update(ppm: number, ambientTimeS: number): void {
    this.trees.update(ppm);
    this.buildings.update(ppm, ambientTimeS);
  }

  dispose(): void {
    this.trees.dispose();
    this.buildings.dispose();
    this.props.dispose();
    for (const t of this.textures) t.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }

  /** Data textures: never colour-managed, rows unpadded; filtered ones get mipmaps for Far zoom. */
  private texture(t: DataTexture, filtered: boolean): DataTexture {
    t.unpackAlignment = 1;
    t.magFilter = filtered ? LinearFilter : NearestFilter;
    t.minFilter = filtered ? LinearMipmapLinearFilter : NearestFilter;
    t.generateMipmaps = filtered;
    t.needsUpdate = true;
    this.textures.push(t);
    return t;
  }
}
