import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen } from "./hook";

/**
 * D4 integration captures (agent evidence, never a Look Gate verdict): auto-grade, structure inference and the
 * structures render together, under the thresholds of the owner decision 2026-09-28 "M2" (cuttings and embankments
 * to 8 m, a deck 2 m into the bank within 15 m of an abutment, a drag on water starting at the deck height). Every
 * scene is laid with the real pointer and the Track tool in auto mode (no height keys, no forced structure), so the
 * core infers every bridge and tunnel. Runs only with `CAPTURE=1 npx playwright test --project=capture
 * tests/e2e/d4.capture.ts` (a bare `d4` also matches a worktree path containing it); images
 * go to the gitignored test-results/d4/<label>/ (D4_LABEL, default "after"; D4_QUERY adds URL parameters).
 *
 * Scenes on the golden diorama (found with the D4 planner in Node, 2026-09-28):
 * - the owner's hill curve, (226, 100) → (233, 117): a cutting to 6.6 m and an embankment to 7.6 m;
 * - the owner's lake-shore curve, (50, 203) → (34, 246): hilltop cuttings, then a bridge set 1.3 m into the flank;
 * - ground over hills, (241, 47) → (271, 47): all ground, cuttings and embankments to 8.0 m;
 * - an automatic tunnel, (233, 51) → (283, 101) on heading 1: two tunnels with a long cutting between;
 * - an automatic bridge over the river, (301, 66) → (301, 116), and over the lake, (−27, 289) → (33, 289).
 */

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LABEL = env.D4_LABEL ?? "after";
const QUERY = env.D4_QUERY ?? "";
const OUT = `test-results/d4/${LABEL}`;

interface Scene {
  readonly name: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  /** Zoom (ppm) that keeps both ends on screen while dragging. */
  readonly dragPpm: number;
}

const SCENES: readonly Scene[] = [
  { name: "hill-curve", from: [226, 100], to: [233, 117], dragPpm: 6 },
  { name: "lake-shore", from: [50, 203], to: [34, 246], dragPpm: 4 },
  { name: "ground-hills", from: [241, 47], to: [271, 47], dragPpm: 5 },
  { name: "auto-tunnel", from: [233, 51], to: [283, 101], dragPpm: 2.5 },
  { name: "river-bridge", from: [301, 66], to: [301, 116], dragPpm: 3 },
  { name: "lake-bridge", from: [-27, 289], to: [33, 289], dragPpm: 3 },
];

interface HookNetwork {
  pieces: { key: string; kind: string; structure: string; z0Mm: number; z1Mm: number; nodes: [number, number] }[];
  nodes: { q: number; r: number; zMm: number }[];
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(400);
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.mouse.move(4, 796);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

/** The nodes where a bridge or tunnel meets ground track or ends, for each structure, from the network. */
async function structureEnds(page: Page, keys: readonly string[]): Promise<{ structure: string; q: number; r: number; zMm: number }[]> {
  return page.evaluate((keys) => {
    const n = (window.__diorama as unknown as { network(): HookNetwork }).network();
    const mine = n.pieces.filter((p) => keys.includes(p.key));
    const byNode = new Map<number, string[]>();
    for (const p of mine) for (const id of p.nodes) byNode.set(id, [...(byNode.get(id) ?? []), p.structure]);
    const out: { structure: string; q: number; r: number; zMm: number }[] = [];
    for (const [id, structures] of byNode) {
      const node = n.nodes[id];
      if (!node) continue;
      for (const s of ["bridge", "tunnel"]) {
        if (structures.includes(s) && (structures.length === 1 || structures.some((x) => x !== s))) out.push({ structure: s, q: node.q, r: node.r, zMm: node.zMm });
      }
    }
    return out;
  }, keys);
}

test(`D4 integration captures (${LABEL})`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`/${QUERY}`);
  await settle(page);

  const built: Record<string, string[]> = {};
  for (const scene of SCENES) {
    const before = await page.evaluate(() => (window.__diorama as unknown as { network(): HookNetwork }).network().pieces.map((p) => p.key));
    const mid: [number, number] = [Math.round((scene.from[0] + scene.to[0]) / 2), Math.round((scene.from[1] + scene.to[1]) / 2)];
    await lookAtNode(page, ...mid, scene.dragPpm);
    // Two Escapes after each scene end the chain and leave the tool, so take the Track tool again.
    await page.keyboard.press("1");
    await dragBetween(page, await nodeScreen(page, ...scene.from), await nodeScreen(page, ...scene.to), 24);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await settle(page);
    const net = await page.evaluate(() => (window.__diorama as unknown as { network(): HookNetwork }).network());
    const added = net.pieces.filter((p) => !before.includes(p.key));
    built[scene.name] = added.map((p) => p.key);
    const counts = { ground: 0, bridge: 0, tunnel: 0 } as Record<string, number>;
    for (const p of added) counts[p.structure] = (counts[p.structure] ?? 0) + 1;
    const toast = await page.evaluate(() => (window.__diorama as unknown as { hud(): { toast: { text: string } | null } }).hud().toast?.text ?? null);
    console.log(`[d4] ${scene.name}: ${added.length} pieces ${JSON.stringify(counts)}${toast ? `; toast ${toast}` : ""}`);
  }
  await page.mouse.move(4, 796);
  await settle(page);
  const stats = await page.evaluate(() => (window.__diorama as unknown as { structureStats(): unknown; earthworksStats(): unknown }).structureStats());
  const earthworks = await page.evaluate(() => (window.__diorama as unknown as { earthworksStats(): unknown }).earthworksStats());
  console.log(`[d4] structures ${JSON.stringify(stats)}`);
  console.log(`[d4] earthworks ${JSON.stringify(earthworks)}`);
  const layouts = await page.evaluate(() =>
    (window.__diorama as unknown as { structureLayouts(): { pieces: string[]; spans: { a: number; b: number; type: string; rule: string }[] }[] })
      .structureLayouts()
      .map((l) => ({ first: l.pieces[0], spans: l.spans.map((s) => `${s.type}/${s.rule} ${(s.b - s.a).toFixed(1)}m`) })),
  );
  console.log(`[d4] bridge layouts ${JSON.stringify(layouts)}`);

  // Whole scenes at Default and Region.
  for (const scene of SCENES) {
    const mid: [number, number] = [Math.round((scene.from[0] + scene.to[0]) / 2), Math.round((scene.from[1] + scene.to[1]) / 2)];
    await lookAtNode(page, ...mid, 6);
    await shoot(page, `${scene.name}-default`);
    await lookAtNode(page, ...mid, 2.5);
    await shoot(page, `${scene.name}-region`);
  }
  // Close views: the owner's hill curve over its deepest cut and its embankment end.
  await lookAtNode(page, 229, 108, 12);
  await shoot(page, "hill-curve-close");
  await lookAtNode(page, 233, 116, 12);
  await shoot(page, "hill-curve-embankment-close");
  // The ground drag at its deepest cut and fill.
  for (const q of [249, 256, 263]) {
    await lookAtNode(page, q, 47, 12);
    await shoot(page, `ground-hills-close-${q}`);
  }
  // Every structure end at Close, and the first yaw step at each bridge's ends and each portal.
  for (const scene of SCENES) {
    const ends = await structureEnds(page, built[scene.name] ?? []);
    console.log(`[d4] ${scene.name} structure ends ${JSON.stringify(ends)}`);
    for (const [i, end] of ends.entries()) {
      await lookAtNode(page, end.q, end.r, 12);
      await shoot(page, `${scene.name}-${end.structure}-end${i}-close`);
      await page.keyboard.press("e");
      await page.keyboard.press("e");
      await page.waitForTimeout(1200);
      // The turn animates about the view's centre; centre the end again before the shot.
      await lookAtNode(page, end.q, end.r, 12);
      await page.waitForTimeout(300);
      await shoot(page, `${scene.name}-${end.structure}-end${i}-close-yaw2`);
      await page.keyboard.press("q");
      await page.keyboard.press("q");
      await page.waitForTimeout(1200);
    }
  }
  // The underground x-ray over the automatic tunnel, and H over the lake-shore bridge.
  await lookAtNode(page, 258, 76, 4);
  await page.keyboard.press("u");
  await page.waitForTimeout(300);
  await shoot(page, "auto-tunnel-xray");
  await page.keyboard.press("u");
  await lookAtNode(page, 36, 236, 6);
  await page.keyboard.press("h");
  await page.waitForTimeout(300);
  await shoot(page, "lake-shore-decks-hidden");
  await page.keyboard.press("h");
  console.log(`[d4] ${LABEL} page errors and warnings: ${JSON.stringify(errors)}`);
});
