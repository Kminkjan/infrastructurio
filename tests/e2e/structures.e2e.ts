import { type Page, expect, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen, openDiorama, snapshot, undoToEmpty } from "./hook";

/**
 * D4 structures e2e (agent evidence: synthetic input through the real pointer and keyboard; it says nothing
 * about how the structures look or feel). The Bridge (5) and Tunnel (6) tools, the ghost's structure, the
 * network's structures, the occlusion aids H, U and C, and undo back to an empty network.
 *
 * With D4's auto-grade and the thresholds of the owner decision 2026-09-28 "M2", the drags are plain ones:
 * - the bridge starts on the river's water, where a free drag begins at the deck height (the water level +
 *   4.0 m), and ends on the far bank, so the deck crosses level at the water level + 4.0 m;
 * - the tunnel is laid as a player would through a hill on the golden diorama: a Track drag into the hill whose
 *   end 35‰ cannot bring up to the ground (it ends under 9.7 m of hill, the last pieces tunnels already), the
 *   Tunnel tool on from that end under U (an underground end is picked only in the x-ray), and a Track drag from
 *   the far foot that magnetism joins to the tunnel's far end. A forced tunnel must lie deeper than the ±8 m band,
 *   so the Tunnel tool cannot start at a free node on the ground: no slope on the diorama rises 8 m in one step.
 * (Until then the D3 planner laid every node on the ground plus a ramped offset: the bridge's far end was raised
 * 6 m with PgUp and the tunnel lowered 8 m with PgDn and chained at that depth.)
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

/**
 * The hill for the tunnel (found with the D4 planner and tool in Node, 2026-09-28): a heading-1 line of 50 nodes from
 * (233, 51) over dry land, both ends on the ground. A Track drag straight through makes a cutting, a tunnel, a long
 * cutting and a second tunnel; its middle lies under up to 10.2 m of hill.
 */
const HILL = { q: 233, r: 51, dq: 1, dr: 1, length: 50, deep: 12, far: 43 } as const;

async function tunnelHookState(page: Page): Promise<{ pieces: { structure: string }[]; ends: { q: number; r: number; zMm: number }[] }> {
  return page.evaluate(() => {
    const h = window.__diorama as unknown as { network(): { pieces: { structure: string }[]; nodes: { q: number; r: number; zMm: number; kind: string }[] } };
    const n = h.network();
    return { pieces: n.pieces.map((p) => ({ structure: p.structure })), ends: n.nodes.filter((x) => x.kind === "buffer").map((x) => ({ q: x.q, r: x.r, zMm: x.zMm })) };
  });
}

async function coverAt(page: Page, q: number, r: number, zMm: number): Promise<number> {
  return page.evaluate(({ q, r, zMm }) => {
    const t = (window.__diorama as unknown as { terrain: Terrain }).terrain;
    const col = q + Math.floor(r / 2);
    return (t.heightsDm[r * t.columns + col] ?? 0) / 10 - zMm / 1000;
  }, { q, r, zMm });
}

test("builds a level bridge across the river with the Bridge tool from the water, hides its deck with H, cycles stacked picks with C, and undoes to empty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r, water } = await findRiverCrossing(page);
  const length = water;
  const endR = r + water;
  await lookAtNode(page, q, r + water / 2, 6);

  await page.keyboard.press("5");
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool())).active).toBe("bridge");
  await expect(page.getByRole("button", { name: /Bridge/ })).toHaveAttribute("aria-pressed", "true");

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

test("lays a tunnel through a hill: into it with Track, on with the Tunnel tool under U, out with Track; portals at both ends; undoes to empty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r, dq, dr, length, deep, far } = HILL;
  const node = (i: number): [number, number] => [q + dq * i, r + dr * i];

  // 1. Track into the hill: 35‰ cannot bring the end up to the ground, so it ends deep inside, in a tunnel.
  await lookAtNode(page, ...node(deep / 2), 6);
  await page.keyboard.press("1");
  await dragBetween(page, await nodeScreen(page, ...node(0)), await nodeScreen(page, ...node(deep)), 12);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__diorama?.ready === true);
  let state = await tunnelHookState(page);
  expect(state.pieces).toHaveLength(deep);
  expect(state.pieces.some((p) => p.structure === "tunnel")).toBe(true);
  const inside = state.ends.find((e) => e.q === node(deep)[0] && e.r === node(deep)[1]);
  if (!inside) throw new Error("no end inside the hill");
  expect(await coverAt(page, inside.q, inside.r, inside.zMm)).toBeGreaterThan(8);

  // 2. The Tunnel tool on from that end, which only the underground x-ray (U) lets the pointer pick.
  await lookAtNode(page, ...node((deep + far) / 2), 4);
  await page.keyboard.press("u");
  await page.keyboard.press("6");
  expect((await page.evaluate(() => (window.__diorama as unknown as Hook).tool())).structure).toBe("tunnel");
  const a = await nodeScreen(page, inside.q, inside.r, inside.zMm);
  await page.mouse.move(a.x, a.y, { steps: 4 });
  expect(await page.evaluate(() => (window.__diorama as unknown as Hook).tool().target)).toMatchObject({ kind: "endpoint", q: inside.q, r: inside.r, zMm: inside.zMm });
  await page.mouse.down();
  const b = await nodeScreen(page, ...node(far));
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await expect(page.getByTestId("construction-tooltip")).toContainText("Structure: tunnel");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("u");
  await page.waitForFunction(() => window.__diorama?.ready === true);
  state = await tunnelHookState(page);
  expect(state.pieces).toHaveLength(far);
  // Every piece the Tunnel tool added is a tunnel, and the first drag's deep end was one already.
  expect(state.pieces.filter((p) => p.structure === "tunnel").length).toBeGreaterThanOrEqual(far - deep + 1);

  // 3. Track from the far foot back to the tunnel's far end: magnetism joins it, whatever its depth.
  await lookAtNode(page, ...node((far + length) / 2), 6);
  await page.keyboard.press("1");
  await dragBetween(page, await nodeScreen(page, ...node(length)), await nodeScreen(page, ...node(far)), 10);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__diorama?.ready === true);

  const net = await page.evaluate(() => (window.__diorama as unknown as Hook).network());
  expect(net.pieces.length).toBe(length);
  const kinds = net.pieces.map((p) => p.structure);
  expect(kinds.filter((k) => k === "tunnel").length).toBeGreaterThan(30);
  expect(kinds.filter((k) => k === "bridge")).toHaveLength(0);
  const stats = await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats());
  expect(stats).toMatchObject({ tunnels: 1, portals: 2 });

  // A pixel over the tunnel's middle at its depth: without U the pick is the hill's ground, with U the tunnel.
  await lookAtNode(page, ...node(Math.round((deep + far) / 2)), 4);
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
    { q: node(Math.round((deep + far) / 2))[0], r: node(Math.round((deep + far) / 2))[1] },
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
