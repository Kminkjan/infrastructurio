import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen, snapshot } from "./hook";

/**
 * Render pass iteration captures (2026-09-27; agent evidence, never a Look Gate
 * verdict). The owner's scene, laid with the real pointer: a free drag on the
 * lake's east shore, (50, 203) → (34, 246), gives ten straights over a hilltop,
 * then an R 180 curve that cuts up to about 5.6 m through the hill's flank and
 * descends onto a fill of about 2.2 m at the lake shore. It is shot at Close (12
 * ppm), Default (6) and Region (2.5) over the curve's middle, plus Close over
 * the cutting and over the embankment by the water, then the four Look Gate A
 * bookmarks. Runs only with `CAPTURE=1 npx playwright test --project=capture
 * renderIter`; images go to the gitignored test-results/render-iter/<label>/,
 * where RENDER_ITER_LABEL names the build (default "after").
 */

// The tsconfig has no Node types (specs run in Node, but type-check with the app's DOM libs).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LABEL = env.RENDER_ITER_LABEL ?? "after";
const QUERY = env.RENDER_ITER_QUERY ?? "";
const OUT = `test-results/render-iter/${LABEL}`;
const FROM = { q: 50, r: 203 };
const TO = { q: 34, r: 246 };

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(300);
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

async function lookAt(page: Page, x: number, y: number, ppm: number): Promise<void> {
  await page.evaluate(({ x, y, ppm }) => (window.__diorama as unknown as { lookAt(x: number, y: number, ppm: number): void }).lookAt(x, y, ppm), { x, y, ppm });
  await page.waitForTimeout(300);
}

/** Plan points along the laid track: the curve at a fraction of its sweep. */
async function trackPoints(page: Page): Promise<{ curve: (f: number) => { x: number; y: number } }> {
  const data = await page.evaluate(() => {
    const h = window.__diorama as unknown as { network(): { pieces: { kind: string; prims: { kind: string; cx: number; cy: number; radiusM: number; startRad: number; sweepRad: number }[] }[] } };
    const pieces = h.network().pieces;
    const curve = pieces.find((p) => p.kind === "curve")?.prims.find((p) => p.kind === "arc");
    if (!curve) throw new Error("no curve");
    return { curve };
  });
  const c = data.curve;
  return {
    curve: (f: number) => {
      const a = c.startRad + c.sweepRad * f;
      return { x: c.cx + c.radiusM * Math.cos(a), y: c.cy + c.radiusM * Math.sin(a) };
    },
  };
}

test(`render pass iteration captures (${LABEL})`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await open(page, QUERY);
  await lookAtNode(page, 42, 224, 4);
  await page.keyboard.press("1");
  await dragBetween(page, await nodeScreen(page, FROM.q, FROM.r), await nodeScreen(page, TO.q, TO.r), 24);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // Park the pointer off the track so no snap ring or hover sits on it.
  await page.mouse.move(8, 792);
  await settle(page);
  const snap = await snapshot(page);
  const stats = await page.evaluate(() => (window.__diorama as unknown as { earthworksStats(): unknown }).earthworksStats());
  const kinds = await page.evaluate(() => (window.__diorama as unknown as { network(): { pieces: { kind: string; z0Mm: number; z1Mm: number }[] } }).network().pieces.map((p) => `${p.kind} ${p.z0Mm}→${p.z1Mm}`));
  console.log(`[render-iter] ${LABEL}: ${snap.pieces} pieces (${kinds.join(", ")}); earthworks ${JSON.stringify(stats)}`);

  const points = await trackPoints(page);
  const mid = points.curve(0.5);
  const views: [string, { x: number; y: number }, number][] = [
    ["curve-close", mid, 12],
    ["curve-default", mid, 6],
    ["curve-region", mid, 2.5],
    // The curve's canonical direction starts at the shore (z0 = 10.6 m), so f = 0 is the shore end.
    ["cutting-close", points.curve(0.7), 12],
    ["shore-close", points.curve(0.08), 12],
    ["shore-zoom", points.curve(0.02), 24],
  ];
  for (const [name, p, ppm] of views) {
    await lookAt(page, p.x, p.y, ppm);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  // One yaw step at Close over the curve: the sun turns with the camera.
  await lookAt(page, mid.x, mid.y, 12);
  await page.keyboard.press("e");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/curve-close-yaw1.png` });
  await page.keyboard.press("q");
  await page.waitForTimeout(1200);

  for (const id of [1, 2, 3, 4]) {
    await open(page, `?bookmark=${id}${QUERY === "" ? "" : `&${QUERY.replace(/^\?/, "")}`}`);
    await page.screenshot({ path: `${OUT}/bookmark-${id}.png` });
  }
  console.log(`[render-iter] ${LABEL} page errors and warnings: ${JSON.stringify(errors)}`);
});
