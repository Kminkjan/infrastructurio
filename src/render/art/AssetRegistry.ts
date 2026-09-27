import type { BufferGeometry } from "three";

/**
 * The asset slot contract (ADR 0013 decision 1, art direction "Pipeline"):
 * every drawable kind resolves through `get(kind, variant, lod)`, which
 * returns one geometry per material slot, named anchors, a ground footprint
 * and a triangle budget. Procedural providers register against a kind today;
 * glTF assets can register against the same keys later (material names equal
 * slot names, anchors are named empties), and callers never change.
 *
 * Model space: +Y up, metres, origin at ground contact, forward +X.
 */

/** Material slots. Each maps to one shared Lambert material (see `materials.ts`). */
export type MaterialSlot = "walls" | "roof" | "trim" | "glass" | "metal" | "foliage" | "sails";

export const MATERIAL_SLOTS: readonly MaterialSlot[] = ["walls", "roof", "trim", "glass", "metal", "foliage", "sails"];

/**
 * Named anchors: chimney smoke, vehicle bogies and couplers (front/rear),
 * doors, and the windmill's sail hub (the pivot its rotating sails turn on).
 */
export type AnchorName = "smoke" | "bogie_front" | "bogie_rear" | "coupler_f" | "coupler_r" | "door" | "sail_hub";

export type AssetLod = 0 | 1;

export interface AnchorPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AssetData {
  readonly slots: Partial<Record<MaterialSlot, BufferGeometry>>;
  /** Several of a name are allowed (a house with two chimneys has two smoke anchors). */
  readonly anchors: Partial<Record<AnchorName, readonly AnchorPoint[]>>;
  /** Ground-contact outline in model XZ, counter-clockwise seen from above. */
  readonly footprint: readonly (readonly [number, number])[];
  /** The most triangles this asset may have, over all slots. */
  readonly triangleBudget: number;
}

export interface Asset extends AssetData {
  readonly kind: string;
  readonly variant: number;
  readonly lod: AssetLod;
  /** Triangles over all slots. */
  readonly triangles: number;
}

export type AssetProvider = (variant: number, lod: AssetLod) => AssetData;

interface Registration {
  readonly provider: AssetProvider;
  /** Shared assets (trees, props) are cached; one-off ones (building lots) are not. */
  readonly cache: boolean;
}

export class AssetRegistry {
  private readonly providers = new Map<string, Registration>();
  private readonly cache = new Map<string, Asset>();

  register(kind: string, provider: AssetProvider, options: { cache?: boolean } = {}): void {
    if (this.providers.has(kind)) throw new Error(`asset kind "${kind}" is already registered`);
    this.providers.set(kind, { provider, cache: options.cache ?? true });
  }

  has(kind: string): boolean {
    return this.providers.has(kind);
  }

  get kinds(): string[] {
    return [...this.providers.keys()].sort();
  }

  /**
   * The asset for (kind, variant, lod). Cached kinds return the same object
   * (and geometries) every time; the registry disposes those. Uncached kinds
   * return fresh geometries that the caller owns and must dispose.
   */
  get(kind: string, variant: number, lod: AssetLod): Asset {
    const registration = this.providers.get(kind);
    if (!registration) throw new Error(`no asset provider for "${kind}"`);
    if (!Number.isInteger(variant) || variant < 0) throw new RangeError(`asset variant must be a non-negative integer, got ${variant}`);
    const key = `${kind}|${variant}|${lod}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const data = registration.provider(variant, lod);
    const asset: Asset = { ...data, kind, variant, lod, triangles: countTriangles(data) };
    if (registration.cache) this.cache.set(key, asset);
    return asset;
  }

  dispose(): void {
    for (const asset of this.cache.values()) for (const geometry of Object.values(asset.slots)) geometry?.dispose();
    this.cache.clear();
  }
}

export function countTriangles(data: Pick<AssetData, "slots">): number {
  let n = 0;
  for (const geometry of Object.values(data.slots)) {
    if (!geometry) continue;
    const index = geometry.getIndex();
    n += (index ? index.count : (geometry.getAttribute("position")?.count ?? 0)) / 3;
  }
  return n;
}

/**
 * Packs a building lot's footprint (whole metres, 1–63 each) and seed into one
 * integer variant: bits 26–31 length, 20–25 width, 0–19 the seed's low bits.
 * The same lot always maps to the same variant, and a glTF provider can read
 * the footprint back to pick its nearest model.
 */
export function buildingVariant(lengthM: number, widthM: number, seed: number): number {
  for (const [name, v] of [["length", lengthM], ["width", widthM]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 63) throw new RangeError(`building ${name} must be 1–63 whole metres, got ${v}`);
  }
  return ((lengthM << 26) | (widthM << 20) | (seed & 0xfffff)) >>> 0;
}

export function unpackBuildingVariant(variant: number): { lengthM: number; widthM: number; seed: number } {
  return { lengthM: (variant >>> 26) & 63, widthM: (variant >>> 20) & 63, seed: variant & 0xfffff };
}
