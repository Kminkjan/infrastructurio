import { type Page, test } from "@playwright/test";
import { dragBetween, findDryRun, lookAtNode, nodeScreen, openDiorama, snapshot } from "./hook";

/**
 * Screenshot capture for the D3 manual browser check (agent evidence). Runs
 * only with `CAPTURE=1 npx playwright test --project=capture`; images go to
 * the gitignored test-results/d3-manual/ (the evidence convention keeps
 * images out of docs/evidence). It prints the preview timing, the track
 * batch kind, draw calls and GPU memory counts as it goes.
 */

const OUT = "test-results/d3-manual";

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function stats(page: Page, label: string): Promise<void> {
  const s = await page.evaluate(() => {
    const h = window.__diorama as unknown as {
      previewStats(): unknown;
      trackStats(): unknown;
      renderer: { info: { render: { calls: number; triangles: number }; memory: { geometries: number; textures: number } } };
      camera: { ppm: number };
    };
    return {
      preview: h.previewStats(),
      track: h.trackStats(),
      calls: h.renderer.info.render.calls,
      triangles: h.renderer.info.render.triangles,
      memory: { ...h.renderer.info.memory },
      ppm: h.camera.ppm,
    };
  });
  console.log(`[capture] ${label}: ${JSON.stringify(s)}`);
}

test("D3 manual check captures", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await openDiorama(page);
  await shot(page, "01-default-zoom");
  await stats(page, "start");

  const { q, r } = await findDryRun(page, 16);
  await lookAtNode(page, q + 8, r, 6);
  await page.keyboard.press("1");
  // Hover snap ring on a free node (hollow).
  const free = await nodeScreen(page, q + 3, r + 3);
  await page.mouse.move(free.x, free.y);
  await shot(page, "02-snap-free-node");

  // A built straight run of 10 pieces.
  await dragBetween(page, await nodeScreen(page, q, r), await nodeScreen(page, q + 10, r), 20);
  await page.keyboard.press("Escape");
  const afterRun = await nodeScreen(page, q + 6, r + 4);
  await page.mouse.move(afterRun.x, afterRun.y);
  await shot(page, "03-built-run-default");
  await lookAtNode(page, q + 5, r, 14);
  await shot(page, "04-built-run-close");
  await lookAtNode(page, q + 8, r, 6);

  // Snap ring on the run's end (filled) and on the track (turnout glyph).
  const end = await nodeScreen(page, q + 10, r);
  await page.mouse.move(end.x, end.y);
  await shot(page, "05-snap-endpoint");
  const mid = await nodeScreen(page, q + 5, r);
  await page.mouse.move(mid.x, mid.y);
  await shot(page, "06-snap-track-turnout");

  // A valid ghost continuing the run, with its tooltip.
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  const ahead = await nodeScreen(page, q + 15, r);
  await page.mouse.move(ahead.x, ahead.y, { steps: 10 });
  await shot(page, "07-ghost-valid-tooltip");
  // A curve: the pointer off the run's line gives a one-bend fit.
  const offLine = await nodeScreen(page, q + 22, r + 10);
  await page.mouse.move(offLine.x, offLine.y, { steps: 10 });
  await shot(page, "07b-ghost-curve");
  await page.mouse.move(ahead.x, ahead.y, { steps: 10 });
  // Elevated: six steps up; drop lines and end-height tags.
  for (let i = 0; i < 6; i++) await page.keyboard.press("BracketRight");
  await shot(page, "08-ghost-elevated");
  await lookAtNode(page, q + 13, r, 14);
  const aheadClose = await nodeScreen(page, q + 15, r);
  await page.mouse.move(aheadClose.x, aheadClose.y, { steps: 4 });
  await shot(page, "08b-ghost-elevated-close");
  await lookAtNode(page, q + 8, r, 6);
  await page.mouse.move(ahead.x, ahead.y, { steps: 4 });
  // Precision held (⌥ on macOS, Ctrl elsewhere): the planner's live label joins the tooltip.
  const precisionKey = (await page.evaluate(() => /mac/i.test(navigator.platform))) ? "Alt" : "Control";
  await page.keyboard.down(precisionKey);
  await page.mouse.move(offLine.x, offLine.y, { steps: 6 });
  await shot(page, "09-precision-label");
  await page.keyboard.up(precisionKey);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");

  // Reused pieces (cyan): over the run from its west end to its east end, then on beyond it.
  const west = await nodeScreen(page, q, r);
  await page.mouse.move(west.x, west.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await shot(page, "10-ghost-reused");
  const beyond = await nodeScreen(page, q + 14, r);
  await page.mouse.move(beyond.x, beyond.y, { steps: 6 });
  await shot(page, "10b-ghost-reused-and-new");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");

  // An invalid ghost (red, dashed): leaving the run mid-track northwards would need a turnout.
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  const north = await nodeScreen(page, q + 5, r + 6);
  await page.mouse.move(north.x, north.y, { steps: 10 });
  await shot(page, "11-ghost-invalid-tooltip");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");
  // The keyboard cursor: arrows from the pointer's node, the ring marks it.
  await page.mouse.move(end.x, end.y);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await shot(page, "11b-keyboard-cursor");
  await page.keyboard.press("Escape");
  await stats(page, "after ghosts");

  // Far LOD (< 4 ppm): sleepers hidden, ballast stripe; then Far.
  await page.keyboard.press("Escape");
  await lookAtNode(page, q + 5, r, 3);
  await shot(page, "12-far-lod-3ppm");
  await lookAtNode(page, q + 5, r, 0.9);
  await shot(page, "13-far-0.9ppm");
  await lookAtNode(page, q + 5, r, 6);

  // Undo with the toast and the 400 ms flash.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(60);
  await page.screenshot({ path: `${OUT}/14-undo-toast-flash.png` });
  await page.waitForTimeout(600);
  await stats(page, "after undo");

  // Leak check: 20 edit → undo cycles through the real pointer; geometry and texture counts should return.
  await page.keyboard.press("1");
  const before = await page.evaluate(() => ({ ...(window.__diorama as unknown as { renderer: { info: { memory: object } } }).renderer.info.memory }));
  for (let i = 0; i < 20; i++) {
    await dragBetween(page, await nodeScreen(page, q, r + 2), await nodeScreen(page, q + 10, r + 2), 8);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
  }
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({ ...(window.__diorama as unknown as { renderer: { info: { memory: object } } }).renderer.info.memory }));
  console.log(`[capture] memory before 20 edit/undo cycles ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
  await stats(page, "after leak cycles");
  console.log(`[capture] final ${JSON.stringify(await snapshot(page))}`);

  // The chunk-merged fallback, forced.
  await page.goto("/?trackBatch=chunked");
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
  await lookAtNode(page, q + 8, r, 6);
  await page.keyboard.press("1");
  await dragBetween(page, await nodeScreen(page, q, r), await nodeScreen(page, q + 10, r), 20);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await shot(page, "15-chunked-fallback");
  await stats(page, "chunked fallback");
  console.log(`[capture] page errors and warnings: ${JSON.stringify(errors)}`);
});
