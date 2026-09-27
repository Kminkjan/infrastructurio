import { describe, expect, it } from "vitest";
import { DIORAMA_SEED, generateDiorama } from "../../core/scenarios/baltic-diorama";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../../core/terrain";
import { LOOK_AB_PITCH_RAD, MID_BAND_PPM, dioramaBookmarks, focusTarget, lakePoints, parseLookdevParams, showTweakPanel } from "./bookmarks";
import { sampleTerrainHeightM } from "../terrain/heightfieldRay";
import { DEFAULT_TERRAIN_LOOK } from "../terrain/terrainLook";
import { ISO_PITCH_RAD, type IsoView, NAMED_ZOOMS, lodBandForPpm, worldToScreen } from "./isoMath";
import { simToWorld } from "../coords";

const terrain = generateTerrain({ seed: DIORAMA_SEED, ...DEFAULT_TERRAIN_SIZE });
const scenery = generateDiorama(terrain);
const bookmarks = dioramaBookmarks(scenery, terrain);

describe("lookdev parameters", () => {
  it("keeps true isometric pitch unless the URL asks for exactly 30°", () => {
    expect(parseLookdevParams("").pitch).toBe(ISO_PITCH_RAD);
    expect(parseLookdevParams("?pitch=30").pitch).toBe(LOOK_AB_PITCH_RAD);
    expect(LOOK_AB_PITCH_RAD).toBeCloseTo((30 * Math.PI) / 180, 12);
    for (const other of ["?pitch=45", "?pitch=30.0", "?pitch=", "?pitch=abc"]) expect(parseLookdevParams(other).pitch).toBe(ISO_PITCH_RAD);
  });

  it("reads bookmarks 1–4 and the tweak switch, ignoring anything else", () => {
    expect(parseLookdevParams("?bookmark=3&tweak=1")).toEqual({ bookmark: 3, pitch: ISO_PITCH_RAD, tweak: true, terrain: DEFAULT_TERRAIN_LOOK });
    for (const bad of ["?bookmark=0", "?bookmark=5", "?bookmark=x", ""]) expect(parseLookdevParams(bad).bookmark).toBeUndefined();
    expect(parseLookdevParams("?tweak=0").tweak).toBe(false);
    for (const unset of ["", "?tweak=", "?tweak=yes", "?tweak=2"]) expect(parseLookdevParams(unset).tweak).toBeUndefined();
  });

  it("reads the terrain look variant, falling back to the recommended default", () => {
    for (const id of ["d11a", "a", "b", "c"] as const) expect(parseLookdevParams(`?terrain=${id}&bookmark=2`).terrain).toBe(id);
    for (const other of ["", "?terrain=", "?terrain=A", "?terrain=d", "?terrain=current"]) expect(parseLookdevParams(other).terrain).toBe(DEFAULT_TERRAIN_LOOK);
  });

  it("shows the tweak panel only with ?tweak=1", () => {
    const shown = (search: string) => showTweakPanel(parseLookdevParams(search));
    expect(shown("?bookmark=2")).toBe(false);
    expect(shown("?bookmark=2&tweak=0")).toBe(false);
    expect(shown("")).toBe(false);
    expect(shown("?tweak=1")).toBe(true);
    expect(shown("?bookmark=1&tweak=1")).toBe(true);
  });
});

describe("Look Gate A bookmarks", () => {
  it("frames the town at Close, forest and river in the mid band, lake and windmill at Region, the map at Far", () => {
    expect(bookmarks.map((b) => b.id)).toEqual([1, 2, 3, 4]);
    expect(bookmarks.map((b) => b.ppm)).toEqual([NAMED_ZOOMS.close, MID_BAND_PPM, NAMED_ZOOMS.region, NAMED_ZOOMS.far]);
    expect(lodBandForPpm(MID_BAND_PPM)).toBe("mid");
    for (const b of bookmarks) expect(b.yawStep).toBe(0);
  });

  /** Where a sim plan point on the ground lands on a 1280 × 720 screen for a bookmark. */
  function onScreen(b: (typeof bookmarks)[number], xM: number, yM: number, pitch = ISO_PITCH_RAD): { x: number; y: number } {
    const view: IsoView = { target: b.target, ppm: b.ppm, yaw: 0, pitch, cssWidth: 1280, cssHeight: 720 };
    return worldToScreen(view, simToWorld(xM, yM, sampleTerrainHeightM(terrain, xM, yM) ?? 10));
  }

  it("centres the focus ground exactly, whatever the terrain height, pitch and yaw", () => {
    for (const pitch of [ISO_PITCH_RAD, LOOK_AB_PITCH_RAD]) {
      for (let k = 0; k < 6; k++) {
        const yaw = (k * Math.PI) / 3;
        const target = focusTarget(terrain, 700, 900, pitch, yaw);
        const view: IsoView = { target, ppm: 12, yaw, pitch, cssWidth: 1280, cssHeight: 720 };
        const p = worldToScreen(view, simToWorld(700, 900, sampleTerrainHeightM(terrain, 700, 900) ?? 10));
        expect(p.x).toBeCloseTo(640, 6);
        expect(p.y).toBeCloseTo(360, 6);
      }
    }
  });

  it("frames the largest town's square and its church in the close-up", () => {
    const b = bookmarks[0]!;
    const town = scenery.towns[0]!;
    const church = scenery.lots.find((l) => l.kind === "church")!;
    for (const p of [onScreen(b, town.centre.xMm / 1000, town.centre.yMm / 1000), onScreen(b, church.xMm / 1000, church.yMm / 1000)]) {
      expect(p.x).toBeGreaterThan(100);
      expect(p.x).toBeLessThan(1180);
      expect(p.y).toBeGreaterThan(200);
      expect(p.y).toBeLessThan(620);
    }
  });

  it("keeps both the windmill and the lake's shore in the Region view (a 1280 × 720 viewport)", () => {
    const b = bookmarks[2]!;
    const mill = scenery.lots.find((l) => l.kind === "windmill")!;
    const mx = mill.xMm / 1000;
    const my = mill.yMm / 1000;
    const lake = lakePoints(terrain);
    expect(lake.length).toBeGreaterThan(0);
    // The lake water node nearest the windmill lies on the shore facing it.
    const shore = lake.reduce((best, p) => (Math.hypot(p.x - mx, p.y - my) < Math.hypot(best.x - mx, best.y - my) ? p : best));
    for (const p of [onScreen(b, mx, my), onScreen(b, shore.x, shore.y)]) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1280);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(720);
    }
  });

  it("records the golden bookmark states (art direction lists them)", () => {
    const states = bookmarks.map((b) => [b.id, Math.round(b.target.x), Math.round(b.target.z), b.ppm, b.yawStep]);
    expect(states).toMatchInlineSnapshot(`
      [
        [
          1,
          964,
          -467,
          12,
          0,
        ],
        [
          2,
          1735,
          -456,
          4,
          0,
        ],
        [
          3,
          640,
          -1255,
          2.5,
          0,
        ],
        [
          4,
          999,
          -793,
          0.9,
          0,
        ],
      ]
    `);
  });
});
