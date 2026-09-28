import { type Page, expect, test } from "@playwright/test";
import { dragBetween, findDryRun, lookAtNode, nodeScreen, openDiorama, snapshot, undoToEmpty } from "./hook";

/**
 * Earthworks-lite e2e (agent evidence: the real pointer lays the track; the
 * dev hook only reads back heights and screen positions, never injects
 * state). A free drag over the diorama's hill east of the centre, (226, 100) →
 * (233, 117), gives a straight and an R 180 curve that runs up to about 10 m
 * under the natural ground (under D4's auto-grade, 6.6 m, and the curve ends on
 * a 7.6 m embankment: both within the ±8 m band of the owner decision
 * 2026-09-28 "M2", which the owner's scene needed; at ±4 m it was rejected). Built, the drawn (conformed) terrain must stay
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
  structures: string[];
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
      network(): { pieces: { key: string; kind: string; structure: string; z0Mm: number; z1Mm: number; prims: Prim[] }[] };
      drawnHeightM(x: number, y: number): number;
      naturalHeightM(x: number, y: number): number;
    };
    const pieces = h.network().pieces;
    const out: Readback = { kinds: [], structures: [], curveKey: "", drawnOverRail: [], naturalOverRail: [], deepest: { x: 0, y: 0, lx: 0, ly: 0, z: 0, drawn: 0, natural: -Infinity } };
    for (const p of pieces) {
      out.kinds.push(p.kind);
      out.structures.push(p.structure);
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
  // The owner's scene builds, all of it ground: a cutting and an embankment within the ±8 m band.
  expect(built.structures).toEqual(["ground", "ground"]);
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

  // A free node on the cutting floor starts on the floor as drawn (D4 feel-check fixes, 2026-09-28: the tool's ground is
  // the sim's effective ground). Until then it started at the natural hill's height, metres above the floor the player
  // saw, and the ghost hung its drop lines and an end-height tag from there (PR #83 review).
  await page.mouse.move(floorScreen.x, floorScreen.y, { steps: 4 });
  const start = await page.evaluate(() => (window.__diorama as unknown as { construction: { trackState: { target: { kind: string; node: { q: number; r: number; zMm: number } } | null } } }).construction.trackState.target);
  expect(start?.kind).toBe("node");
  const aboveFloor = await page.evaluate(
    ({ q, r, zMm }) => zMm / 1000 - (window.__diorama as unknown as { drawnHeightM(x: number, y: number): number }).drawnHeightM(5 * (q + r / 2), r * 2.5 * Math.sqrt(3)),
    start?.node ?? { q: 0, r: 0, zMm: 0 },
  );
  console.log(`[earthworks e2e] a free node on the cutting floor starts ${aboveFloor.toFixed(3)} m above the drawn floor`);
  expect(Math.abs(aboveFloor)).toBeLessThan(0.05);

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

test("the owner's lake-shore curve builds: a bridge set into the hill's flank, cut down to its deck, never filled under; undo restores", async ({ page }) => {
  // Render pass iteration (2026-09-27): a free drag on the lake's east shore, (50, 203) → (34, 246), the owner's scene.
  // Under D3 it gave ten straights over a hilltop, then an R 180 curve through a cutting onto a fill at the shore
  // (this test then checked that fill met the water as a slope; the earthworks unit tests still do). Under D4's
  // auto-grade the track keeps to 35‰ as the hill falls to the lake, so it leaves the hilltop's cuttings on a bridge:
  // an R 90 curve and straights out to the shore, 13–16 m over the falling ground. The curve's deck dips up to 1.3 m
  // under the hill's flank near its abutment, which the owner decision 2026-09-28 "M2" allows (at most 2 m within
  // 15 m of one; D4's core half rejected it), and the renderer cuts the ground down to the deck there, never filling
  // under the bridge.
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
  expect(built.structures.length).toBeGreaterThanOrEqual(15);
  expect(built.structures).toContain("bridge");
  expect(built.structures).toContain("ground");
  expect(built.structures).not.toContain("tunnel");
  // The rails stay clear of the drawn ground on every piece, bridges included ...
  for (const worst of built.drawnOverRail) expect(worst).toBeLessThanOrEqual(0);
  // ... while the natural ground would stand over a bridge's rails: the deck set into the hill's flank.
  expect(Math.max(...built.naturalOverRail.filter((_, i) => built.structures[i] === "bridge"))).toBeGreaterThan(0.3);
  const stats = await page.evaluate(() => (window.__diorama as unknown as { structureStats(): { bridges: number } }).structureStats());
  expect(stats.bridges).toBe(1);

  // Along and beside each bridge piece: never a fill under it, and the water level + 4.0 m wherever it is over water.
  const bridge = await page.evaluate(() => {
    const h = window.__diorama as unknown as {
      network(): { pieces: { structure: string; z0Mm: number; z1Mm: number; prims: Prim[] }[] };
      drawnHeightM(x: number, y: number): number;
      naturalHeightM(x: number, y: number): number;
      terrain: { waterLevelDm: number };
    };
    const water = h.terrain.waterLevelDm / 10;
    let raised = 0;
    let cut = 0;
    let overWater = 0;
    let lowOverWater = 0;
    for (const p of h.network().pieces) {
      if (p.structure !== "bridge") continue;
      const length = p.prims.reduce((s, q) => s + (q.kind === "line" ? Math.hypot(q.x1 - q.x0, q.y1 - q.y0) : q.radiusM * Math.abs(q.sweepRad)), 0);
      let s0 = 0;
      for (const q of p.prims) {
        const len = q.kind === "line" ? Math.hypot(q.x1 - q.x0, q.y1 - q.y0) : q.radiusM * Math.abs(q.sweepRad);
        const n = Math.max(1, Math.ceil(len / 0.5));
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const a = q.kind === "arc" ? q.startRad + q.sweepRad * f : 0;
          const x = q.kind === "line" ? q.x0 + (q.x1 - q.x0) * f : q.cx + q.radiusM * Math.cos(a);
          const y = q.kind === "line" ? q.y0 + (q.y1 - q.y0) * f : q.cy + q.radiusM * Math.sin(a);
          const z = (p.z0Mm + ((p.z1Mm - p.z0Mm) * (s0 + len * f)) / length) / 1000;
          for (const [dx, dy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
            const drawn = h.drawnHeightM(x + dx, y + dy);
            const natural = h.naturalHeightM(x + dx, y + dy);
            if (drawn > natural + 1e-3) raised += 1;
            if (natural - drawn > 0.1) cut += 1;
          }
          if (h.naturalHeightM(x, y) < water) {
            overWater += 1;
            if (z < water + 4 - 1e-6) lowOverWater += 1;
          }
        }
        s0 += len;
      }
    }
    return { raised, cut, overWater, lowOverWater };
  });
  console.log(`[earthworks e2e] lake-shore bridge: ${JSON.stringify(bridge)}`);
  expect(bridge.raised).toBe(0);
  expect(bridge.cut).toBeGreaterThan(0);
  expect(bridge.lowOverWater).toBe(0);

  await undoToEmpty(page);
  await page.waitForFunction(() => window.__diorama?.ready === true);
  const after = await page.evaluate(() => (window.__diorama as unknown as { earthworksStats(): { chunksWithEarthworks: number; refinedTriangles: number } }).earthworksStats());
  expect(after.chunksWithEarthworks).toBe(0);
  expect(after.refinedTriangles).toBe(0);
  expect(errors).toEqual([]);
});

/** Holds the page's animation frames (the frame loop, and so the time-sliced earthworks) until `releaseFrames`. */
async function holdFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __held?: FrameRequestCallback[]; __raf?: typeof requestAnimationFrame };
    w.__held = [];
    w.__raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      w.__held?.push(callback);
      return 1e9 + (w.__held?.length ?? 0);
    };
  });
  // A frame the real clock had queued before the hold still runs; let it pass.
  await page.waitForTimeout(150);
}

async function releaseFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __held?: FrameRequestCallback[]; __raf?: typeof requestAnimationFrame };
    if (w.__raf) window.requestAnimationFrame = w.__raf;
    const held = w.__held ?? [];
    w.__held = [];
    for (const callback of held) window.requestAnimationFrame(callback);
  });
}

/** The ghost's drop-line vertex count, read from the scene graph. */
async function ghostDropVertices(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scene = (window.__diorama as unknown as { scene: { getObjectByName(name: string): { children: { geometry?: { getAttribute(n: string): { count: number } | undefined } }[] } | undefined } }).scene;
    return scene.getObjectByName("ghost")?.children[1]?.geometry?.getAttribute("position")?.count ?? 0;
  });
}

test("a chained ghost set before the earthworks land measures its tags again once they do", async ({ page }) => {
  // PR #83 re-review: the commit sets the chained ghost before the time-sliced conform lands, and its tags and drop
  // lines were never measured again, so a continuation off a new embankment read "+6 m" at its start (the ground
  // from before the build) until the snapped node changed. Frames are held so the commit and the continuation's
  // ghost both land before the earthworks sync, as on a slow frame; the keyboard lays the track (height steps
  // pressed: D4's fixed height mode).
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r } = await findDryRun(page, 40, 0.3);
  await lookAtNode(page, q + 17, r, 4);
  const start = await nodeScreen(page, q, r);
  await page.mouse.move(start.x, start.y);
  await page.keyboard.press("1");
  await page.mouse.move(start.x + 1, start.y);
  await page.keyboard.press("Enter");
  // A 24-piece plan east whose end stands 3 m above the ground: an embankment once built. Until D4 it was 20 pieces
  // and 6 m; D4 rejects that climb (60‰) and makes more than 4 m of fill a bridge, which is not conformed.
  for (let i = 0; i < 24; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 3; i++) await page.keyboard.press("PageUp");
  await page.waitForFunction(() => window.__diorama?.ready === true);

  await holdFrames(page);
  await page.keyboard.press("Enter");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  const tags = page.locator(".ghost-height-tag");
  const before = await tags.allTextContents();
  const dropsBefore = await ghostDropVertices(page);
  const pending = await page.evaluate(() => {
    const h = window.__diorama as unknown as { earthworksStats(): { appliedRev: number; pieces: number }; network(): { rev: number } };
    return { rev: h.network().rev, appliedRev: h.earthworksStats().appliedRev, pieces: h.earthworksStats().pieces };
  });
  await releaseFrames(page);
  await page.waitForFunction(() => window.__diorama?.ready === true);
  const after = await tags.allTextContents();
  const dropsAfter = await ghostDropVertices(page);
  console.log(`[earthworks e2e] chained ghost: tags ${JSON.stringify(before)} → ${JSON.stringify(after)}, drop-line vertices ${dropsBefore} → ${dropsAfter}; earthworks while held ${JSON.stringify(pending)}`);
  expect((await snapshot(page)).pieces).toBe(24);
  // While held, the embankment was not drawn yet: the start stood 3 m over the natural ground.
  expect(pending.appliedRev).toBeLessThan(pending.rev);
  expect(pending.pieces).toBe(0);
  expect(before[0]).toBe("+3 m");
  // Drawn, the start stands on the embankment's crest, and its drop line through the bank is gone.
  await expect(tags.first()).toHaveText("0 m");
  expect(after[1]).toBe("+3 m");
  expect(dropsAfter).toBeLessThan(dropsBefore);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await undoToEmpty(page);
  expect(errors).toEqual([]);
});
