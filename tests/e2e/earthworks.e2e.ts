import { type Page, expect, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen, openDiorama, snapshot, undoToEmpty } from "./hook";

/**
 * Earthworks-lite e2e (agent evidence: the real pointer lays the track; the
 * dev hook only reads back heights and screen positions, never injects
 * state). A free drag over the diorama's hill east of the centre, (226, 100) →
 * (233, 117), gives a straight and an R 180 curve that runs up to about 10 m
 * under the natural ground. Built, the drawn (conformed) terrain must stay
 * under the rail tops along both pieces, while the natural terrain would have
 * buried the curve; the cursor must land on the visible cutting floor; the
 * track picker must still find the curve where it is drawn; and undo must give
 * back the natural terrain.
 */

/** Rail tops sit this far above the track height (TRACK_RAIL_TOP_M: 0.15 m lift, 0.14 m sleeper, 0.16 m rail). */
const RAIL_TOP_M = 0.45;

interface Prim {
  readonly kind: "line" | "arc";
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly cx: number;
  readonly cy: number;
  readonly radiusM: number;
  readonly startRad: number;
  readonly sweepRad: number;
}

interface Readback {
  kinds: string[];
  curveKey: string;
  /** Per piece: the largest drawn and natural terrain height above the rail tops along the centreline and rails. */
  drawnOverRail: number[];
  naturalOverRail: number[];
  /** The deepest centreline point of the curve: plan position, left unit normal, track height, drawn and natural ground. */
  deepest: { x: number; y: number; lx: number; ly: number; z: number; drawn: number; natural: number };
}

async function readback(page: Page): Promise<Readback> {
  return page.evaluate((railTop) => {
    const h = window.__diorama as unknown as {
      network(): { pieces: { key: string; kind: string; z0Mm: number; z1Mm: number; prims: Prim[] }[] };
      drawnHeightM(x: number, y: number): number;
      naturalHeightM(x: number, y: number): number;
    };
    const pieces = h.network().pieces;
    const out: Readback = { kinds: [], curveKey: "", drawnOverRail: [], naturalOverRail: [], deepest: { x: 0, y: 0, lx: 0, ly: 0, z: 0, drawn: 0, natural: -Infinity } };
    for (const p of pieces) {
      out.kinds.push(p.kind);
      if (p.kind === "curve") out.curveKey = p.key;
      const length = p.prims.reduce((s, q) => s + (q.kind === "line" ? Math.hypot(q.x1 - q.x0, q.y1 - q.y0) : q.radiusM * Math.abs(q.sweepRad)), 0);
      let s0 = 0;
      let drawnWorst = -Infinity;
      let naturalWorst = -Infinity;
      for (const q of p.prims) {
        const len = q.kind === "line" ? Math.hypot(q.x1 - q.x0, q.y1 - q.y0) : q.radiusM * Math.abs(q.sweepRad);
        const n = Math.max(1, Math.ceil(len / 0.5));
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          let x: number;
          let y: number;
          let tx: number;
          let ty: number;
          if (q.kind === "line") {
            x = q.x0 + (q.x1 - q.x0) * f;
            y = q.y0 + (q.y1 - q.y0) * f;
            tx = (q.x1 - q.x0) / len;
            ty = (q.y1 - q.y0) / len;
          } else {
            const a = q.startRad + q.sweepRad * f;
            x = q.cx + q.radiusM * Math.cos(a);
            y = q.cy + q.radiusM * Math.sin(a);
            const sign = q.sweepRad >= 0 ? 1 : -1;
            tx = -Math.sin(a) * sign;
            ty = Math.cos(a) * sign;
          }
          const z = (p.z0Mm + ((p.z1Mm - p.z0Mm) * (s0 + len * f)) / length) / 1000;
          for (const u of [0, 0.817, -0.817]) {
            const px = x - ty * u;
            const py = y + tx * u;
            drawnWorst = Math.max(drawnWorst, h.drawnHeightM(px, py) - (z + railTop));
            naturalWorst = Math.max(naturalWorst, h.naturalHeightM(px, py) - (z + railTop));
          }
          const natural = h.naturalHeightM(x, y);
          if (p.kind === "curve" && natural - z > out.deepest.natural - out.deepest.z) out.deepest = { x, y, lx: -ty, ly: tx, z, drawn: h.drawnHeightM(x, y), natural };
        }
        s0 += len;
      }
      out.drawnOverRail.push(drawnWorst);
      out.naturalOverRail.push(naturalWorst);
    }
    return out;
  }, RAIL_TOP_M);
}

test("a curve laid across a hill stays visible: the drawn terrain is cut under it, picking follows, undo restores", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  await lookAtNode(page, 230, 108, 6);
  await page.keyboard.press("1");
  await dragBetween(page, await nodeScreen(page, 226, 100), await nodeScreen(page, 233, 117), 16);
  await page.waitForFunction(() => window.__diorama?.ready === true);
  expect((await snapshot(page)).pieces).toBeGreaterThanOrEqual(2);

  const built = await readback(page);
  expect(built.kinds).toContain("curve");
  // The natural terrain would bury the curve's rails by metres ...
  expect(Math.max(...built.naturalOverRail)).toBeGreaterThan(3);
  expect(built.deepest.natural - built.deepest.z).toBeGreaterThan(6);
  // ... the drawn terrain never rises over a rail top, on any piece.
  for (const worst of built.drawnOverRail) expect(worst).toBeLessThanOrEqual(0);
  expect(built.deepest.drawn).toBeCloseTo(built.deepest.z, 2);
  const stats = await page.evaluate(() => (window.__diorama as unknown as { earthworksStats(): { chunksWithEarthworks: number; maxCutM: number; lastRebuild: { totalMs: number; slices: number } } }).earthworksStats());
  expect(stats.chunksWithEarthworks).toBeGreaterThan(0);
  expect(stats.maxCutM).toBeGreaterThan(6);
  console.log(`[earthworks e2e] rebuild after the edit: ${JSON.stringify(stats.lastRebuild)}`);

  // Picking: the cursor over the cutting floor, 2.8 m beside the deepest point, lands there (the natural hill's
  // surface would put it metres away), and over the curve's centreline the track picker finds the curve.
  await page.keyboard.press("Escape");
  await lookAtNode(page, 230, 108, 12);
  const d = built.deepest;
  const floor = { x: d.x + d.lx * 2.8, y: d.y + d.ly * 2.8 };
  const floorScreen = await page.evaluate(({ x, y, z }) => (window.__diorama as unknown as { planScreen(x: number, y: number, z: number): { x: number; y: number } }).planScreen(x, y, z), { x: floor.x, y: floor.y, z: d.z });
  await page.mouse.move(floorScreen.x, floorScreen.y, { steps: 4 });
  const floorPick = await page.evaluate(() => (window.__diorama as unknown as { construction: { trackState: { target: { kind: string; pointMm: { xMm: number; yMm: number } } | null } } }).construction.trackState.target);
  expect(floorPick?.kind).toBe("node");
  expect(Math.hypot((floorPick?.pointMm.xMm ?? 0) / 1000 - floor.x, (floorPick?.pointMm.yMm ?? 0) / 1000 - floor.y)).toBeLessThan(0.5);
  const railScreen = await page.evaluate(({ x, y, z }) => (window.__diorama as unknown as { planScreen(x: number, y: number, z: number): { x: number; y: number } }).planScreen(x, y, z), { x: d.x, y: d.y, z: d.z + RAIL_TOP_M });
  await page.mouse.move(railScreen.x, railScreen.y, { steps: 4 });
  const railPick = await page.evaluate(() => (window.__diorama as unknown as { construction: { trackState: { target: { kind: string; pieceKey?: string } | null } } }).construction.trackState.target);
  expect(railPick?.kind).toBe("track");
  expect(railPick?.pieceKey).toBe(built.curveKey);

  // Undo: the natural terrain comes back exactly under where the curve was.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await undoToEmpty(page);
  await page.waitForFunction(() => window.__diorama?.ready === true);
  const after = await page.evaluate(({ x, y }) => {
    const h = window.__diorama as unknown as { drawnHeightM(x: number, y: number): number; naturalHeightM(x: number, y: number): number; earthworksStats(): { chunksWithEarthworks: number; refinedTriangles: number } };
    return { drawn: h.drawnHeightM(x, y), natural: h.naturalHeightM(x, y), stats: h.earthworksStats() };
  }, d);
  expect(after.drawn).toBe(after.natural);
  expect(after.stats.chunksWithEarthworks).toBe(0);
  expect(after.stats.refinedTriangles).toBe(0);
  expect(errors).toEqual([]);
});

test("the owner's lake-shore curve: rails stay clear, the fill meets the water as a slope with no cliff, undo restores", async ({ page }) => {
  // Render pass iteration (2026-09-27): a free drag on the lake's east shore, (50, 203) → (34, 246), gives ten
  // straights over a hilltop, then an R 180 curve through a cutting onto a fill at the shore (the owner's scene).
  // Round 1 capped the fill 10 cm under the water, which left near-vertical steps along the shore.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  await lookAtNode(page, 42, 224, 4);
  await page.keyboard.press("1");
  await dragBetween(page, await nodeScreen(page, 50, 203), await nodeScreen(page, 34, 246), 24);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__diorama?.ready === true);
  const built = await readback(page);
  expect(built.kinds).toContain("curve");
  for (const worst of built.drawnOverRail) expect(worst).toBeLessThanOrEqual(0);
  expect(Math.max(...built.naturalOverRail)).toBeGreaterThan(1);

  // Around the shore end of the curve, sample the drawn surface every 0.5 m: where the natural ground lies under the
  // water, no step between neighbouring samples may be steeper than the 1 : 1.5 side slope (plus sampling slack).
  const shore = await page.evaluate(() => {
    const h = window.__diorama as unknown as {
      network(): { pieces: { kind: string; z0Mm: number; z1Mm: number; prims: Prim[] }[] };
      drawnHeightM(x: number, y: number): number;
      naturalHeightM(x: number, y: number): number;
      terrain: { waterLevelDm: number };
    };
    const curve = h.network().pieces.find((p) => p.kind === "curve");
    const arc = curve?.prims.find((q) => q.kind === "arc");
    if (!curve || !arc) throw new Error("no curve");
    // The curve's lower end (its lower z) is the shore end.
    const a = curve.z0Mm < curve.z1Mm ? arc.startRad : arc.startRad + arc.sweepRad;
    const cx = arc.cx + arc.radiusM * Math.cos(a);
    const cy = arc.cy + arc.radiusM * Math.sin(a);
    const water = h.terrain.waterLevelDm / 10;
    let underwater = 0;
    let steepest = 0;
    let moved = 0;
    // Round 1's signature: drawn ground flat at 10 cm under the water over a deeper natural bed (a shelf).
    let shelf = 0;
    const onShelf = (z: number) => Math.abs(z - (water - 0.1)) < 0.02;
    for (let x = cx - 20; x <= cx + 20; x += 0.5) {
      for (let y = cy - 20; y <= cy + 20; y += 0.5) {
        const z = h.drawnHeightM(x, y);
        const n = h.naturalHeightM(x, y);
        if (!(n < water)) continue;
        underwater += 1;
        if (Math.abs(z - n) > 0.05) moved += 1;
        if (n < water - 0.2 && onShelf(z) && onShelf(h.drawnHeightM(x + 0.5, y)) && onShelf(h.drawnHeightM(x, y + 0.5))) shelf += 1;
        for (const [dx, dy] of [[0.5, 0], [0, 0.5]] as const) {
          const z1 = h.drawnHeightM(x + dx, y + dy);
          if (Number.isFinite(z1)) steepest = Math.max(steepest, Math.abs(z1 - z) / 0.5);
        }
      }
    }
    return { underwater, moved, steepest, shelf };
  });
  console.log(`[earthworks e2e] lake shore: ${JSON.stringify(shore)}`);
  expect(shore.underwater).toBeGreaterThan(100);
  expect(shore.moved).toBeGreaterThan(10);
  expect(shore.steepest).toBeLessThan(0.75);
  expect(shore.shelf).toBe(0);

  await undoToEmpty(page);
  await page.waitForFunction(() => window.__diorama?.ready === true);
  const stats = await page.evaluate(() => (window.__diorama as unknown as { earthworksStats(): { chunksWithEarthworks: number; refinedTriangles: number } }).earthworksStats());
  expect(stats.chunksWithEarthworks).toBe(0);
  expect(stats.refinedTriangles).toBe(0);
  expect(errors).toEqual([]);
});
