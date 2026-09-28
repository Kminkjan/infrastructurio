import { type Page, expect, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen, openDiorama, undoToEmpty } from "./hook";

/**
 * The owner's feel check of 2026-09-28 ("Not yet"), as e2e (agent evidence: the real pointer and keyboard lay the
 * track; the dev hook only reads back). The owner picked "Structures look off" over a Close screenshot: a tunnel
 * portal on flat ground made by an ordinary Track drag beside an existing curve, a tall shadow over it, a jagged tear
 * in the terrain and a break in the curve's ballast. The core judged the drag against the natural hill while the
 * renderer drew the curve's cutting, and the hill plug behind the portal refilled that cutting from the natural
 * ground inside its region: a raised block with open edges over the curve's track.
 */

interface Piece {
  key: string;
  structure: string;
  z0Mm: number;
  z1Mm: number;
  prims: { kind: string; x0: number; y0: number; x1: number; y1: number }[];
}

interface Hook {
  network(): { pieces: Piece[] };
  structureStats(): { tunnels: number; portals: number };
  drawnHeightM(x: number, y: number): number;
  structures: { plugHeightAt(x: number, y: number): number };
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
}

async function trackDrag(page: Page, tool: "1" | "5", from: [number, number], to: [number, number]): Promise<Piece[]> {
  const before = await page.evaluate(() => (window.__diorama as unknown as Hook).network().pieces.map((p) => p.key));
  await page.keyboard.press(tool);
  await dragBetween(page, await nodeScreen(page, ...from), await nodeScreen(page, ...to), 16);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settle(page);
  const net = await page.evaluate(() => (window.__diorama as unknown as Hook).network());
  return net.pieces.filter((p) => !before.includes(p.key));
}

test("the owner's scene: a Track drag beside the hill curve's cutting is ground in that cutting, no portal on its floor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  await lookAtNode(page, 230, 108, 6);
  const curve = await trackDrag(page, "1", [226, 100], [233, 117]);
  expect(curve.map((p) => p.structure)).toEqual(["ground", "ground"]);
  // Until the fix, (234, 114) → (234, 102) built six tunnel pieces under 3.9–7.9 m of drawn cover and two portals.
  const beside = await trackDrag(page, "1", [234, 114], [234, 102]);
  expect(beside).toHaveLength(12);
  expect(beside.every((p) => p.structure === "ground")).toBe(true);
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats())).toMatchObject({ tunnels: 0, portals: 0 });
  await undoToEmpty(page);
  expect(errors).toEqual([]);
});

test("a portal beside a neighbour's cutting: the drawn ground stays continuous around it, and the plug never covers the neighbour's rails", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  await lookAtNode(page, 247, 58, 4);
  // A Straight line through the hill (ground, eleven tunnel pieces, ground; portals at (248, 58) and (259, 58)) ...
  const tunnel = await trackDrag(page, "5", [231, 58], [263, 58]);
  expect(tunnel.filter((p) => p.structure === "tunnel").length).toBeGreaterThanOrEqual(8);
  // ... then a Track drag three rows north, 13 m beside it, whose cutting runs through the west portal's plug region.
  const beside = await trackDrag(page, "1", [236, 55], [256, 55]);
  expect(beside.every((p) => p.structure === "ground")).toBe(true);
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats())).toMatchObject({ tunnels: 1, portals: 2 });

  const probe = await page.evaluate(
    ({ beside }) => {
      const h = window.__diorama as unknown as Hook;
      const surface = (x: number, y: number) => {
        const d = h.drawnHeightM(x, y);
        const p = h.structures.plugHeightAt(x, y);
        return Number.isNaN(p) || p <= d ? d : p;
      };
      // Lines 0.25 m apart in both directions over 60 × 40 m around each portal: the largest step between neighbours.
      let worst = 0;
      let at = { x: 0, y: 0 };
      for (const q of [248, 259]) {
        const cx = 5 * (q + 58 / 2);
        const cy = 58 * 2.5 * Math.sqrt(3);
        // The portal face and its wings stand in the plane x = cx, 1 m thick, over the plug's front edge: skip that band.
        const inFace = (x: number) => Math.abs(x - cx) <= 1.3;
        for (let y = cy - 20; y <= cy + 20; y += 1) {
          let prev = surface(cx - 30, y);
          for (let x = cx - 29.75; x <= cx + 30; x += 0.25) {
            const z = surface(x, y);
            if (!inFace(x) && !inFace(x - 0.25) && Math.abs(z - prev) > worst) {
              worst = Math.abs(z - prev);
              at = { x, y };
            }
            prev = z;
          }
        }
        for (let x = cx - 30; x <= cx + 30; x += 1) {
          if (inFace(x)) continue;
          let prev = surface(x, cy - 20);
          for (let y = cy - 19.75; y <= cy + 20; y += 0.25) {
            const z = surface(x, y);
            if (Math.abs(z - prev) > worst) {
              worst = Math.abs(z - prev);
              at = { x, y };
            }
            prev = z;
          }
        }
      }
      // The neighbour's rails: the drawn surface (terrain and plug) under the rail tops along its whole length.
      let railWorst = -Infinity;
      for (const p of beside) {
        for (const l of p.prims) {
          if (l.kind !== "line") continue;
          for (let f = 0; f <= 1; f += 0.05) {
            const x = l.x0 + (l.x1 - l.x0) * f;
            const y = l.y0 + (l.y1 - l.y0) * f;
            const z = (p.z0Mm + (p.z1Mm - p.z0Mm) * f) / 1000;
            railWorst = Math.max(railWorst, surface(x, y) - (z + 0.45));
          }
        }
      }
      return { worst, at, railWorst };
    },
    { beside },
  );
  console.log(`[feel-check e2e] around the portals: largest step ${probe.worst.toFixed(3)} m over 0.25 m at (${probe.at.x.toFixed(1)}, ${probe.at.y.toFixed(1)}); neighbour's rail tops clear by ${(-probe.railWorst).toFixed(2)} m`);
  // The steepest designed face is the 2 : 1 headwall behind a portal (0.5 m per 0.25 m); the D4 render's plug edge
  // over a neighbour's cutting stood metres proud.
  expect(probe.worst).toBeLessThan(0.6);
  expect(probe.railWorst).toBeLessThanOrEqual(0);
  await undoToEmpty(page);
  expect(errors).toEqual([]);
});
