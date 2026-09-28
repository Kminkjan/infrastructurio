import { type Page, expect, test } from "@playwright/test";
import { lookAtNode, nodeScreen, openDiorama, snapshot, undoToEmpty } from "./hook";

/**
 * D4 structures e2e (agent evidence: synthetic input through the real pointer and keyboard; it says nothing
 * about how the structures look or feel). The Bridge (5) and Tunnel (6) tools, the ghost's structure, the
 * network's structures, the occlusion aids H, U and C, and undo back to an empty network.
 *
 * The D3 planner lays every node on the ground plus an offset ramped from the start's to the end's, so the
 * bridge's deck ramps up from its bank, and the tunnel is laid below the hill by lowering its first end with
 * PgDn and chaining at that depth, then raising the last end back to the ground (until the core lane's
 * auto-grade planner lands, which may change these plans; see the D4 core lane).
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
  tool(): { active: string; structure: string; target: { kind: string; q: number; r: number; zMm: number; pieceKey: string | null } | null };
  planScreen(x: number, y: number, z: number): { x: number; y: number };
}

/** A heading-2 line (q, r + i) over the river: 3 dry nodes, 4–8 water nodes, 3 dry nodes; the first and last node indices. */
async function findRiverCrossing(page: Page): Promise<{ q: number; r: number; length: number }> {
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
        if (d === 3) return { q, r, length: i + w + d - 1 };
      }
    }
    throw new Error("no river crossing found");
  });
}

/** A straight line (heading 0 or 2) of 40 nodes over dry ground whose middle stands at least 7 m above both ends. */
async function findHill(page: Page): Promise<{ q: number; r: number; dq: number; dr: number; length: number }> {
  return page.evaluate(() => {
    const t = (window.__diorama as unknown as { terrain: Terrain }).terrain;
    const at = (q: number, r: number) => {
      const col = q + Math.floor(r / 2);
      if (r < 0 || r >= t.rows || col < 0 || col >= t.columns) return undefined;
      return { h: (t.heightsDm[r * t.columns + col] ?? 0) / 10, wet: t.water[r * t.columns + col] === 1 };
    };
    const length = 40;
    for (const [dq, dr] of [
      [1, 0],
      [0, 1],
    ] as const) {
      for (let r = 10; r < t.rows - 10; r += 2) {
        for (let col = 10; col < t.columns - 10; col += 2) {
          const q = col - Math.floor(r / 2);
          let ok = true;
          let top = -Infinity;
          for (let i = 0; i <= length && ok; i++) {
            const n = at(q + dq * i, r + dr * i);
            if (!n || n.wet) ok = false;
            else top = Math.max(top, n.h);
          }
          const a = at(q, r);
          const b = at(q + dq * length, r + dr * length);
          if (ok && a && b && Math.abs(a.h - b.h) < 2 && top - Math.max(a.h, b.h) > 7) return { q, r, dq, dr, length };
        }
      }
    }
    throw new Error("no hill found");
  });
}

test("builds a bridge over water with the Bridge tool, hides its deck with H, cycles stacked picks with C, and undoes to empty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r, length } = await findRiverCrossing(page);
  const endR = r + length;
  await lookAtNode(page, q, r + length / 2, 6);

  await page.keyboard.press("5");
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool())).active).toBe("bridge");
  await expect(page.getByRole("button", { name: /Bridge/ })).toHaveAttribute("aria-pressed", "true");

  // Drag across the river, raising the far end 6 m while dragging.
  const from = await nodeScreen(page, q, r);
  const to = await nodeScreen(page, q, endR);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  for (let i = 0; i < 6; i++) await page.keyboard.press("PageUp");
  await expect(page.getByTestId("construction-tooltip")).toContainText("Structure: bridge");
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).ghostMarks())).toBe(true);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__diorama?.ready === true);

  const net = await page.evaluate(() => (window.__diorama as unknown as Hook).network());
  expect(net.pieces.length).toBe(length);
  expect(net.pieces.every((p) => p.structure === "bridge")).toBe(true);
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
    { q, r: r + length / 2 },
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

test("lays a tunnel under a hill with the Tunnel tool, with portals at both ends, shows it with U, and undoes to empty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r, dq, dr, length } = await findHill(page);
  const node = (i: number): [number, number] => [q + dq * i, r + dr * i];
  await lookAtNode(page, ...node(length / 2), 3);
  await page.keyboard.press("6");
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool())).structure).toBe("tunnel");

  // Into the hill 8 m under the ground, on at that depth, and out again to the ground at the far foot.
  const a = await nodeScreen(page, ...node(0));
  const b = await nodeScreen(page, ...node(6));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  for (let i = 0; i < 8; i++) await page.keyboard.press("PageDown");
  await expect(page.getByTestId("construction-tooltip")).toContainText("Structure: tunnel");
  await page.mouse.up();
  const c = await nodeScreen(page, ...node(length - 6));
  await page.mouse.move(c.x, c.y, { steps: 8 });
  await page.mouse.click(c.x, c.y);
  const d = await nodeScreen(page, ...node(length));
  await page.mouse.move(d.x, d.y, { steps: 8 });
  for (let i = 0; i < 8; i++) await page.keyboard.press("PageUp");
  await page.mouse.click(d.x, d.y);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__diorama?.ready === true);

  const net = await page.evaluate(() => (window.__diorama as unknown as Hook).network());
  expect(net.pieces.length).toBe(length);
  expect(net.pieces.every((p) => p.structure === "tunnel")).toBe(true);
  const stats = await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats());
  expect(stats).toMatchObject({ tunnels: 1, portals: 2 });

  // A pixel over the tunnel's middle at its depth: without U the pick is the hill's ground, with U the tunnel.
  const middle = await page.evaluate(
    ({ q, r }) => {
      const h = window.__diorama as unknown as Hook;
      const x = 5 * (q + r / 2);
      const y = 2.5 * Math.sqrt(3) * r;
      // The piece whose midpoint lies nearest the node, and its height there.
      let best = { d: Infinity, x: 0, y: 0, z: 0 };
      for (const p of h.network().pieces) {
        const l = p.prims[0];
        if (!l || l.kind !== "line") continue;
        const mx = (l.x0 + l.x1) / 2;
        const my = (l.y0 + l.y1) / 2;
        const d = Math.hypot(mx - x, my - y);
        if (d < best.d) best = { d, x: mx, y: my, z: (p.z0Mm + p.z1Mm) / 2000 };
      }
      return h.planScreen(best.x, best.y, best.z + 0.4);
    },
    { q: node(Math.round(length / 2))[0], r: node(Math.round(length / 2))[1] },
  );
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
  const after = await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats());
  expect(after).toMatchObject({ tunnels: 0, portals: 0 });
  expect((await snapshot(page)).pieces).toBe(0);
  expect(errors).toEqual([]);
});
