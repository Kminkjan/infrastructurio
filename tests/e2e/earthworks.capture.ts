import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen, snapshot, undoToEmpty } from "./hook";

/**
 * Earthworks-lite captures for the agent browser check (agent evidence, never
 * the owner's Look Gate). Runs only with
 * `CAPTURE=1 npx playwright test --project=capture`; images go to the
 * gitignored test-results/earthworks/. Two layouts on the diorama's hill east
 * of the centre, each laid with the real pointer, at Region, Default and Close:
 * - a curve over the hill: a free drag (226, 100) → (233, 117), a straight and an
 *   R 180 curve that runs up to 10 m under the natural ground;
 * - a straight on a cross-slope of about 44%: (226, 115) → (238, 115) eastwards.
 * "before" is the same build with `?earthworks=0` (the natural terrain, as
 * before this change); "after" is the default. It also shoots the ghost over the
 * hill mid-drag, and logs the earthworks stats and GPU memory counts.
 */

const OUT = "test-results/earthworks";
const ZOOMS = [
  ["region", 2.5],
  ["default", 6],
  ["close", 12],
] as const;

async function openWith(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

async function stats(page: Page, label: string): Promise<void> {
  const s = await page.evaluate(() => {
    const h = window.__diorama as unknown as {
      earthworksStats(): unknown;
      trackStats(): unknown;
      renderer: { info: { render: { calls: number; triangles: number }; memory: { geometries: number; textures: number } } };
    };
    return { earthworks: h.earthworksStats(), track: h.trackStats(), calls: h.renderer.info.render.calls, triangles: h.renderer.info.render.triangles, memory: { ...h.renderer.info.memory } };
  });
  console.log(`[earthworks capture] ${label}: ${JSON.stringify(s)}`);
}

/** Plan metres of the midpoint of the first curve piece in the network. */
async function curveMiddle(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const h = window.__diorama as unknown as { network(): { pieces: { kind: string; prims: { kind: string; cx: number; cy: number; radiusM: number; startRad: number; sweepRad: number }[] }[] } };
    const curve = h.network().pieces.find((p) => p.kind === "curve");
    const arc = curve?.prims.find((p) => p.kind === "arc");
    if (!arc) throw new Error("no curve");
    const a = arc.startRad + arc.sweepRad / 2;
    return { x: arc.cx + arc.radiusM * Math.cos(a), y: arc.cy + arc.radiusM * Math.sin(a) };
  });
}

async function lookAt(page: Page, x: number, y: number, ppm: number): Promise<void> {
  await page.evaluate(({ x, y, ppm }) => (window.__diorama as unknown as { lookAt(x: number, y: number, ppm: number): void }).lookAt(x, y, ppm), { x, y, ppm });
  await page.waitForTimeout(200);
}

for (const [mode, query] of [
  ["before", "?earthworks=0"],
  ["after", ""],
] as const) {
  test(`earthworks captures (${mode})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
    });
    await openWith(page, query);

    // The curve over the hill, laid with the real pointer.
    await lookAtNode(page, 230, 108, 6);
    await page.keyboard.press("1");
    const from = await nodeScreen(page, 226, 100);
    const to = await nodeScreen(page, 233, 117);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${mode}-curve-ghost-default.png` });
    await page.mouse.up();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await settle(page);
    await stats(page, `${mode} curve built`);
    console.log(`[earthworks capture] ${mode} curve network ${JSON.stringify(await snapshot(page))}`);
    const mid = await curveMiddle(page);
    for (const [name, ppm] of ZOOMS) {
      await lookAt(page, mid.x, mid.y, ppm);
      await page.screenshot({ path: `${OUT}/${mode}-curve-${name}.png` });
    }
    await undoToEmpty(page);
    await settle(page);
    await stats(page, `${mode} after undo`);

    // The straight on the cross-slope (after the undo toast has gone).
    await page.waitForTimeout(3500);
    await lookAtNode(page, 232, 115, 6);
    await page.keyboard.press("1");
    await dragBetween(page, await nodeScreen(page, 226, 115), await nodeScreen(page, 238, 115), 16);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await settle(page);
    await stats(page, `${mode} straight built`);
    const centre = await page.evaluate(() => ({ x: 5 * (232 + 115 / 2), y: 5 * 115 * (Math.sqrt(3) / 2) }));
    for (const [name, ppm] of ZOOMS) {
      await lookAt(page, centre.x, centre.y, ppm);
      await page.screenshot({ path: `${OUT}/${mode}-straight-${name}.png` });
    }
    await undoToEmpty(page);
    await settle(page);

    // Rebuild cost and leaks: 20 edit → undo cycles of the curve over the hill through the real pointer.
    await lookAtNode(page, 230, 108, 6);
    const memory = () => page.evaluate(() => ({ ...(window.__diorama as unknown as { renderer: { info: { memory: object } } }).renderer.info.memory }));
    const before = await memory();
    const edits: number[] = [];
    const undos: number[] = [];
    const lastRebuild = () => page.evaluate(() => (window.__diorama as unknown as { earthworksStats(): { lastRebuild: { totalMs: number } } }).earthworksStats().lastRebuild.totalMs);
    await page.keyboard.press("1");
    for (let i = 0; i < 20; i++) {
      await dragBetween(page, await nodeScreen(page, 226, 100), await nodeScreen(page, 233, 117), 8);
      await settle(page);
      edits.push(await lastRebuild());
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+z");
      await settle(page);
      undos.push(await lastRebuild());
    }
    await page.keyboard.press("Escape");
    const after = await memory();
    console.log(`[earthworks capture] ${mode} 20 curve edit/undo cycles: edit rebuild ms ${JSON.stringify(edits.map((v) => +v.toFixed(1)))}, undo ${JSON.stringify(undos.map((v) => +v.toFixed(1)))}; memory before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
    console.log(`[earthworks capture] ${mode} page errors and warnings: ${JSON.stringify(errors)}`);
  });
}
