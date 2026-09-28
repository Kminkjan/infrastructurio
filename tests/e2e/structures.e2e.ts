import { type Page, expect, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen, openDiorama, snapshot, undoToEmpty } from "./hook";

/**
 * D4 structures e2e (agent evidence: synthetic input through the real pointer and keyboard; it says nothing
 * about how the structures look or feel): automatic bridges and tunnels, the ghost's structure, the network's
 * structures, the occlusion aids H, U and C, and undo back to an empty network.
 *
 * Since the owner decision 2026-09-28, "One 'Straight line' tool", no tool forces a structure: the Bridge (5) and
 * Tunnel (6) tools gave way to the Straight line tool (5), which lays one steady grade from start to end and lets
 * the core infer bridges and tunnels, while Track (1) follows the ground with auto-grade.
 * - The river bridge is a Track drag that starts on the water, where a free drag begins at the deck height (the
 *   water level + 4.0 m, owner decision 2026-09-28 "M2"), and ends on the far bank: a level deck.
 * - The tunnel is one Straight line drag through a hill on the golden diorama, (231, 58) → (263, 58) (found with the
 *   planner in Node, 2026-09-28): ground, eleven tunnel pieces, ground, with a portal at each end.
 * - The lake is one Straight line drag from a hill on its north shore, (65, 200) on heading 3 for 60 pieces: a bridge
 *   over 24 water nodes, then ground.
 */

interface Terrain {
  readonly columns: number;
  readonly rows: number;
  readonly water: Uint8Array;
  readonly heightsDm: Int16Array;
}

interface Hook {
  terrain: Terrain;
  network(): { pieces: { key: string; structure: string; z0Mm: number; z1Mm: number; prims: { kind: string; x0: number; y0: number; x1: number; y1: number }[] }[] };
  structureStats(): { bridges: number; tunnels: number; portals: number; spans: { arch: number; truss: number; girder: number; solid: number }; appliedRev: number };
  structureLayouts(): { spans: { type: string; rule: string; overWater: boolean }[] }[];
  aids(): { decksHidden: boolean; xray: boolean };
  trackBridgeShown(): boolean;
  ghostMarks(): boolean;
  tool(): { active: string; mode: string; target: { kind: string; q: number; r: number; zMm: number; pieceKey: string | null } | null };
  planScreen(x: number, y: number, z: number): { x: number; y: number };
}

/**
 * A heading-2 line over the river: 3 dry nodes, 4–8 water nodes, 3 dry nodes. Returns the first water node and how
 * many water nodes follow it, so node (q, r + water) is the far bank's first dry node.
 */
async function findRiverCrossing(page: Page): Promise<{ q: number; r: number; water: number }> {
  return page.evaluate(() => {
    const t = (window.__diorama as unknown as { terrain: Terrain }).terrain;
    const wet = (q: number, r: number) => {
      const col = q + Math.floor(r / 2);
      if (r < 0 || r >= t.rows || col < 0 || col >= t.columns) return undefined;
      return t.water[r * t.columns + col] === 1;
    };
    for (let r = Math.round(t.rows * 0.2); r < t.rows * 0.8; r++) {
      for (let col = Math.round(t.columns * 0.35); col < t.columns * 0.75; col++) {
        const q = col - Math.floor(r / 2);
        let i = 0;
        while (i < 3 && wet(q, r + i) === false) i++;
        if (i < 3) continue;
        let w = 0;
        while (wet(q, r + i + w) === true) w++;
        if (w < 4 || w > 8) continue;
        let d = 0;
        while (d < 3 && wet(q, r + i + w + d) === false) d++;
        if (d === 3) return { q, r: r + i, water: w };
      }
    }
    throw new Error("no river crossing found");
  });
}

/** The hill for the tunnel: 32 pieces east from (231, 58), both ends on the ground (ground, 11 tunnel pieces, ground). */
const HILL = { q: 231, r: 58, length: 32 } as const;

/** The lake crossing: 60 secondary pieces north (heading 3) from a 34 m hill at (65, 200), over 24 water nodes. */
const LAKE_LINE = { q: 65, r: 200, dq: -1, dr: 2, length: 60 } as const;

test("builds a level bridge across the river with a Track drag from the water, hides its deck with H, cycles stacked picks with C, and undoes to empty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r, water } = await findRiverCrossing(page);
  const length = water;
  const endR = r + water;
  await lookAtNode(page, q, r + water / 2, 6);

  await page.keyboard.press("1");
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool())).active).toBe("track");
  await expect(page.getByRole("button", { name: /Track/ })).toHaveAttribute("aria-pressed", "true");

  // From the first water node by the near bank to the far bank's first dry node: the drag starts at the deck
  // height, the water level + 4.0 m (owner decision 2026-09-28 "M2"), and no height keys are pressed.
  const waterLevelMm = await page.evaluate(() => (window.__diorama as unknown as { terrain: { waterLevelDm: number } }).terrain.waterLevelDm * 100);
  const from = await nodeScreen(page, q, r);
  const to = await nodeScreen(page, q, endR);
  await page.mouse.move(from.x, from.y, { steps: 4 });
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target)).toMatchObject({ kind: "node", q, r });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await expect(page.getByTestId("construction-tooltip")).toContainText("Structure: bridge");
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).ghostMarks())).toBe(true);
  expect(await page.evaluate(() => (window.__diorama as unknown as { tool(): { heightSteps: number } }).tool().heightSteps)).toBe(0);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__diorama?.ready === true);

  const net = await page.evaluate(() => (window.__diorama as unknown as Hook).network());
  expect(net.pieces.length).toBe(length);
  expect(net.pieces.every((p) => p.structure === "bridge")).toBe(true);
  // A level deck at the water level + 4.0 m, from the water to the far bank.
  expect(net.pieces.every((p) => p.z0Mm === waterLevelMm + 4000 && p.z1Mm === waterLevelMm + 4000)).toBe(true);
  const stats = await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats());
  expect(stats.bridges).toBe(1);
  const layouts = await page.evaluate(() => (window.__diorama as unknown as Hook).structureLayouts());
  // Over the water the rule chooses a steel Warren truss.
  expect(layouts[0]?.spans.some((s) => s.overWater && s.type === "truss" && s.rule === "water")).toBe(true);

  // A pixel on the deck over the middle of the river, with the Track tool active.
  const mid = await page.evaluate(
    ({ q, r }) => {
      const h = window.__diorama as unknown as Hook;
      const pieces = h.network().pieces;
      const x = 5 * (q + r / 2);
      const y = 2.5 * Math.sqrt(3) * r;
      // The piece whose line passes nearest the crossing's middle, and its deck height there.
      let best = { d: Infinity, x: 0, y: 0, z: 0 };
      for (const p of pieces) {
        const l = p.prims[0];
        if (!l || l.kind !== "line") continue;
        const mx = (l.x0 + l.x1) / 2;
        const my = (l.y0 + l.y1) / 2;
        const d = Math.hypot(mx - x, my - y);
        if (d < best.d) best = { d, x: mx, y: my, z: (p.z0Mm + p.z1Mm) / 2000 };
      }
      return { ...h.planScreen(best.x, best.y, best.z + 0.4), zMm: best.z * 1000 };
    },
    { q, r: r + water / 2 },
  );
  await page.keyboard.press("1");
  await page.mouse.move(mid.x, mid.y, { steps: 4 });
  const onDeck = await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target);
  expect(onDeck?.kind).toBe("track");
  expect(net.pieces.find((p) => p.key === onDeck?.pieceKey)?.structure).toBe("bridge");

  // C: the next stacked pick under the pointer is the ground (the water) below the deck; C again returns to the deck.
  await page.keyboard.press("c");
  const below = await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target);
  expect(below?.kind).toBe("node");
  expect(below?.zMm).toBeLessThan(mid.zMm - 2000);
  await expect(page.getByTestId("status-line")).toContainText("Pick 2 of 2");
  await page.keyboard.press("c");
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target))?.kind).toBe("track");

  // H hides the deck and its track: the pointer then picks the ground under it; H shows them again.
  await page.keyboard.press("h");
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).aids())).toEqual({ decksHidden: true, xray: false });
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).trackBridgeShown())).toBe(false);
  await expect(page.getByTestId("view-chip")).toHaveText("Decks hidden (H)");
  await page.mouse.move(mid.x + 1, mid.y, { steps: 2 });
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target))?.kind).toBe("node");
  await page.keyboard.press("h");
  await expect(page.getByTestId("view-chip")).toHaveCount(0);
  await page.mouse.move(mid.x, mid.y, { steps: 2 });
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target))?.kind).toBe("track");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await undoToEmpty(page);
  await page.waitForFunction(() => window.__diorama?.ready === true);
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats())).bridges).toBe(0);
  expect(errors).toEqual([]);
});

test("lays a tunnel through a hill with one Straight line drag: portals at both ends, U picks the bore, undoes to empty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r, length } = HILL;
  await lookAtNode(page, q + length / 2, r, 4);
  await page.keyboard.press("5");
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool())).active).toBe("straight");
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool())).mode).toBe("straight");
  await expect(page.getByRole("button", { name: /Straight/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Bridge|Tunnel/ })).toHaveCount(0);
  const from = await nodeScreen(page, q, r);
  const to = await nodeScreen(page, q + length, r);
  await page.mouse.move(from.x, from.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await expect(page.getByTestId("construction-tooltip")).toContainText(/Structure: \d+ tunnel, \d+ ground/);
  await expect(page.getByTestId("construction-tooltip")).toContainText("Straight line: bridges and tunnels as needed");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__diorama?.ready === true);

  const net = await page.evaluate(() => (window.__diorama as unknown as Hook).network());
  expect(net.pieces.length).toBe(length);
  const kinds = net.pieces.map((p) => p.structure);
  expect(kinds.filter((k) => k === "tunnel").length).toBeGreaterThanOrEqual(8);
  expect(kinds.filter((k) => k === "bridge")).toHaveLength(0);
  // One steady grade: every piece rises by the same share (largest remainder, within 1 mm).
  const rises = net.pieces.map((p) => Math.abs(p.z1Mm - p.z0Mm));
  expect(Math.max(...rises) - Math.min(...rises)).toBeLessThanOrEqual(1);
  const stats = await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats());
  expect(stats).toMatchObject({ tunnels: 1, portals: 2 });

  // A pixel over the tunnel's middle at its depth: without U the pick is the hill's ground, with U the tunnel.
  const tunnelPieces = net.pieces.filter((p) => p.structure === "tunnel");
  const middle = await page.evaluate((keys) => {
    const h = window.__diorama as unknown as Hook;
    const p = h.network().pieces.find((x) => x.key === keys[Math.floor(keys.length / 2)]);
    const l = p?.prims[0];
    if (!p || !l) throw new Error("no tunnel piece");
    return h.planScreen((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, (p.z0Mm + p.z1Mm) / 2000 + 0.4);
  }, tunnelPieces.map((p) => p.key));
  await page.keyboard.press("1");
  await page.mouse.move(middle.x, middle.y, { steps: 4 });
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target))?.pieceKey ?? null).toBeNull();
  await page.keyboard.press("u");
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).aids())).toEqual({ decksHidden: false, xray: true });
  await expect(page.getByTestId("view-chip")).toHaveText("Underground x-ray (U)");
  await page.mouse.move(middle.x + 1, middle.y, { steps: 2 });
  const target = await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target);
  expect(target?.kind).toBe("track");
  expect(net.pieces.find((p) => p.key === target?.pieceKey)?.structure).toBe("tunnel");
  await page.keyboard.press("u");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await undoToEmpty(page);
  await page.waitForFunction(() => window.__diorama?.ready === true);
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats())).toMatchObject({ tunnels: 0, portals: 0 });
  expect((await snapshot(page)).pieces).toBe(0);
  expect(errors).toEqual([]);
});

test("bridges the lake with one Straight line drag from its north shore: a truss over the water, ground beyond", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r, dq, dr, length } = LAKE_LINE;
  await lookAtNode(page, q + (dq * length) / 2, r + (dr * length) / 2, 1.8);
  await page.keyboard.press("5");
  await dragBetween(page, await nodeScreen(page, q, r), await nodeScreen(page, q + dq * length, r + dr * length), 20);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__diorama?.ready === true);
  const net = await page.evaluate(() => (window.__diorama as unknown as Hook).network());
  expect(net.pieces.length).toBe(length);
  const kinds = net.pieces.map((p) => p.structure);
  expect(kinds.filter((k) => k === "bridge").length).toBeGreaterThanOrEqual(20);
  expect(kinds).not.toContain("tunnel");
  const layouts = await page.evaluate(() => (window.__diorama as unknown as Hook).structureLayouts());
  expect(layouts.some((l) => l.spans.some((s) => s.overWater))).toBe(true);
  await undoToEmpty(page);
  expect(errors).toEqual([]);
});
