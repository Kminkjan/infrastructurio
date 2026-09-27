import { describe, expect, it } from "vitest";
import { DIORAMA_SEED, generateDiorama } from "../../core/scenarios/baltic-diorama";
import { DEFAULT_TERRAIN_SIZE, generateTerrain, terrainBoundsM } from "../../core/terrain";
import { AO_SIZE, buildSplatMaps } from "./splatMap";

const terrain = generateTerrain({ seed: DIORAMA_SEED, ...DEFAULT_TERRAIN_SIZE });
const scenery = generateDiorama(terrain);
const bounds = terrainBoundsM(terrain);
const maps = buildSplatMaps(scenery, { widthM: bounds.maxX, heightM: bounds.maxY });

const splatAt = (xM: number, yM: number, channel: number) => maps.splat[4 * (Math.floor(yM) * maps.width + Math.floor(xM)) + channel] ?? 0;
const aoAt = (xM: number, yM: number) => maps.ao[Math.floor((yM / maps.aoSizeM.y) * AO_SIZE) * AO_SIZE + Math.floor((xM / maps.aoSizeM.x) * AO_SIZE)] ?? 0;

describe("splat maps", () => {
  it("cover the whole map at 1 m per texel, with a 1,024² AO map", () => {
    expect(maps.width).toBe(Math.ceil(bounds.maxX));
    expect(maps.height).toBe(Math.ceil(bounds.maxY));
    expect(maps.splat.length).toBe(maps.width * maps.height * 4);
    expect(maps.field.length).toBe(maps.width * maps.height * 2);
    expect(maps.ao.length).toBe(AO_SIZE * AO_SIZE);
  });

  it("paint dirt along road centrelines and cobble on town squares", () => {
    for (const road of scenery.roads) {
      const mid = road.points[Math.floor(road.points.length / 2)]!;
      expect(splatAt(mid.xMm / 1000, mid.yMm / 1000, 0)).toBe(255);
    }
    for (const town of scenery.towns) expect(splatAt(town.centre.xMm / 1000, town.centre.yMm / 1000, 1)).toBe(255);
  });

  it("paint each field with its crop and furrow heading, and leave open grass bare", () => {
    for (const f of scenery.fields) {
      const x = f.xMm / 1000;
      const y = f.yMm / 1000;
      expect(splatAt(x, y, 2)).toBe(255);
      const i = Math.floor(y) * maps.width + Math.floor(x);
      expect(maps.field[2 * i]).toBe(f.crop);
      expect(maps.field[2 * i + 1]).toBe(f.heading % 6);
    }
    expect(splatAt(1, 1, 0) + splatAt(1, 1, 1) + splatAt(1, 1, 2) + splatAt(1, 1, 3)).toBe(0);
  });

  it("give a field's whole feathered rim its own crop and furrow, never crop 0's", () => {
    // One green-crop field (crop 2; anything but rye, crop 0) at heading 7, alone on a small map.
    const f = { xMm: 40_500, yMm: 30_500, heading: 7, lengthMm: 24_000, widthMm: 12_000, crop: 2 } as const;
    const alone = buildSplatMaps({ ...scenery, fields: [f], lots: [], roads: [], streets: [] }, { widthM: 80, heightM: 60 }, 1, 8);
    let weighted = 0;
    for (let i = 0; i < alone.width * alone.height; i++) {
      if ((alone.splat[4 * i + 2] ?? 0) === 0) continue;
      weighted += 1;
      expect(alone.field[2 * i], `texel ${i}`).toBe(f.crop);
      expect(alone.field[2 * i + 1], `texel ${i}`).toBe(f.heading % 6);
    }
    // The rim is painted too: more weighted texels than the 24 × 12 m box itself.
    expect(weighted).toBeGreaterThan(24 * 12);
  });

  it("puts forest floor under dense forest", () => {
    const f = scenery.forest;
    const dense = f.density.findIndex((d) => d === 255);
    expect(dense).toBeGreaterThanOrEqual(0);
    const cx = ((dense % f.columns) + 0.5) * (f.cellMm / 1000);
    const cy = (Math.floor(dense / f.columns) + 0.5) * (f.cellMm / 1000);
    expect(splatAt(cx, cy, 3)).toBeGreaterThan(150);
  });

  it("darkens the AO map around buildings more than on open ground", () => {
    const church = scenery.lots.find((l) => l.kind === "church")!;
    expect(aoAt(church.xMm / 1000, church.yMm / 1000)).toBeGreaterThan(100);
    expect(aoAt(2, 2)).toBeLessThan(20);
  });
});
