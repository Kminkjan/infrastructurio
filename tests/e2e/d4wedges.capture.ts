import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen } from "./hook";

/**
 * D4 portal-wedge captures (agent evidence, never a Look Gate verdict), after the owner's answer of 2026-09-29, "Round
 * it off": "Continue the retained hill's gentle 1:1.5 fall past the wing-wall ends and round the crease smoothly (core
 * ground rule + plug), so the cutting blends into the hill with no lit wedge or teeth." Runs only with `CAPTURE=1`, e.g.
 * `CAPTURE=1 npx playwright test --project=capture tests/e2e/d4wedges.capture.ts`; images go to the gitignored
 * test-results/d4-wedges/<label>/ (D4W_LABEL, default "after"; D4W_OUT overrides the folder, for a baseline worktree;
 * D4W_QUERY is appended to the page URL, e.g. "?structures=0").
 * Every scene is laid with the real pointer, Track (1) or Straight line (5), and shot in build mode; the dev hook only
 * aims the camera and reads back. The scenes are the verification's of 2026-09-29 (found in Node on the diorama), each
 * at the yaws where the wedges or teeth showed, and at the rest view (yaw 0):
 * - ew75, Straight (227, 138) → (259, 138): the shortest east–west two-portal tunnel (75 m), portals (237, 138) (west)
 *   and (252, 138) (east);
 * - short40, Straight (200, 97) → (200, 129): the shortest two-portal tunnel (40 m), portals (200, 112) and (200, 120);
 * - the dead end, Straight (220, 140) → (236, 140), portal (229, 140);
 * - low2, Track (192, 134) → (203, 159), portal (203, 145) under 4.6 m;
 * - low3, Straight (215, 187) → (247, 123), the lowest-cover portal (242, 133) under 3.1 m, and (221, 175);
 * - xslope, Straight (247, 130) → (223, 142), the steepest cross slope, portal (231, 138).
 */

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LABEL = env.D4W_LABEL ?? "after";
const OUT = env.D4W_OUT ?? `test-results/d4-wedges/${LABEL}`;
const CLOSE = 12;
const DEFAULT = 6;
const DETAIL = 22;

interface Hook {
  network(): { pieces: { structure: string }[] };
  structureStats(): unknown;
  structures?: { readonly portalOutlines?: readonly { frame: { x: number; y: number; z: number }; wings: { left: number; right: number } }[] };
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(400);
}

async function lay(page: Page, tool: "1" | "5", from: [number, number], to: [number, number]): Promise<string> {
  await lookAtNode(page, Math.round((from[0] + to[0]) / 2), Math.round((from[1] + to[1]) / 2), 2.5);
  await page.keyboard.press(tool);
  await dragBetween(page, await nodeScreen(page, ...from), await nodeScreen(page, ...to), 20);
  await page.keyboard.press("Escape");
  await settle(page);
  const kinds = await page.evaluate(() => (window.__diorama as unknown as Hook).network().pieces.map((p) => p.structure[0]).join(""));
  const outlines = await page.evaluate(() => {
    const o = (window.__diorama as unknown as Hook).structures?.portalOutlines;
    return o ? o.map((p) => `(${p.frame.x.toFixed(1)},${p.frame.y.toFixed(1)},${p.frame.z.toFixed(1)}) wings ${p.wings.left.toFixed(1)}/${p.wings.right.toFixed(1)}`).join("; ") : "n/a";
  });
  const stats = await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats());
  // Back to Select (Escape from an idle tool), so no lattice overlay is drawn in the shots.
  for (let i = 0; i < 3 && (await page.evaluate(() => window.__diorama?.tool().active)) !== "select"; i++) await page.keyboard.press("Escape");
  const active = await page.evaluate(() => window.__diorama?.tool().active);
  return `${kinds} | portals ${outlines} | tool ${active} | ${JSON.stringify(stats)}`;
}

async function shoot(page: Page, name: string, q: number, r: number, ppm: number, yawSteps = 0): Promise<void> {
  await lookAtNode(page, q, r, ppm);
  for (let i = 0; i < yawSteps; i++) await page.keyboard.press("e");
  if (yawSteps > 0) {
    await page.waitForTimeout(1300);
    await lookAtNode(page, q, r, ppm);
  }
  await page.mouse.move(4, 796);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  // Where the camera put the lattice node (q, r) at two heights, so a check can project plan points onto the shot.
  if (env.D4W_PROJECT === "1") {
    const at = await page.evaluate(({ q, r }) => [0, 10_000, 20_000, 30_000].map((z) => window.__diorama?.nodeScreen(q, r, z)), { q, r });
    console.log(`[d4-wedges ${LABEL}] project ${name} ${q} ${r} ${ppm} ${yawSteps} ${JSON.stringify(at)}`);
  }
  for (let i = 0; i < yawSteps; i++) await page.keyboard.press("q");
  if (yawSteps > 0) await page.waitForTimeout(1300);
}

/** Undoes the scene's one command (a further undo would show the "Nothing to undo" toast in the next shots). */
async function clear(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await settle(page);
  const left = await page.evaluate(() => (window.__diorama as unknown as Hook).network().pieces.length);
  if (left !== 0) throw new Error(`clear: ${left} pieces left`);
  // Let the undo's toast ("Undone: removed … pieces.") go before the next scene's shots.
  await page.waitForFunction(() => window.__diorama?.hud().toast === null, undefined, { timeout: 15_000 }).catch(() => undefined);
}

test(`D4 portal-wedge captures (${LABEL})`, async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`/${env.D4W_QUERY ?? ""}`);
  await settle(page);
  const log = (s: string) => console.log(`[d4-wedges ${LABEL}] ${s}`);

  log(`ew75: ${await lay(page, "5", [227, 138], [259, 138])}`);
  await shoot(page, "ew75-west-close-yaw0", 237, 138, CLOSE);
  await shoot(page, "ew75-west-close-yaw4", 237, 138, CLOSE, 4);
  await shoot(page, "ew75-west-close-yaw5", 237, 138, CLOSE, 5);
  await shoot(page, "ew75-west-detail-yaw0", 237, 138, DETAIL);
  await shoot(page, "ew75-west-detail-yaw4", 237, 138, DETAIL, 4);
  await shoot(page, "ew75-east-close-yaw0", 252, 138, CLOSE);
  await shoot(page, "ew75-east-close-yaw1", 252, 138, CLOSE, 1);
  await shoot(page, "ew75-east-detail-yaw3", 252, 138, DETAIL, 3);
  await shoot(page, "ew75-default-yaw0", 244, 138, DEFAULT);
  await clear(page);

  log(`short40: ${await lay(page, "5", [200, 97], [200, 129])}`);
  await shoot(page, "short40-close-yaw0", 200, 116, CLOSE);
  await shoot(page, "short40-close-yaw4", 200, 116, CLOSE, 4);
  await shoot(page, "short40-close-yaw1", 200, 116, CLOSE, 1);
  await shoot(page, "short40-n-detail-yaw2", 200, 120, DETAIL, 2);
  await shoot(page, "short40-s-detail-yaw5", 200, 112, DETAIL, 5);
  await shoot(page, "short40-default-yaw4", 200, 116, DEFAULT, 4);
  await clear(page);

  log(`deadend: ${await lay(page, "5", [220, 140], [236, 140])}`);
  await shoot(page, "deadend-close-yaw0", 229, 140, CLOSE);
  await shoot(page, "deadend-close-yaw4", 229, 140, CLOSE, 4);
  await shoot(page, "deadend-detail-yaw0", 229, 140, DETAIL);
  await shoot(page, "deadend-detail-yaw3", 229, 140, DETAIL, 3);
  await shoot(page, "deadend-detail-yaw4", 229, 140, DETAIL, 4);
  await clear(page);

  log(`low2: ${await lay(page, "1", [192, 134], [203, 159])}`);
  await shoot(page, "low2-close-yaw0", 203, 145, CLOSE);
  await shoot(page, "low2-close-yaw2", 203, 145, CLOSE, 2);
  await shoot(page, "low2-detail-yaw0", 203, 145, DETAIL);
  await clear(page);

  log(`low3: ${await lay(page, "5", [215, 187], [247, 123])}`);
  await shoot(page, "low3-close-yaw0", 242, 133, CLOSE);
  await shoot(page, "low3-close-yaw3", 242, 133, CLOSE, 3);
  await shoot(page, "low3-detail-yaw0", 242, 133, DETAIL);
  await shoot(page, "low3-south-close-yaw0", 221, 175, CLOSE);
  await clear(page);

  log(`xslope: ${await lay(page, "5", [247, 130], [223, 142])}`);
  await shoot(page, "xslope-close-yaw0", 231, 138, CLOSE);
  await shoot(page, "xslope-close-yaw1", 231, 138, CLOSE, 1);
  await shoot(page, "xslope-detail-yaw1", 231, 138, DETAIL, 1);
  await shoot(page, "xslope-close-yaw4", 231, 138, CLOSE, 4);
  await clear(page);

  log(`page errors and warnings: ${JSON.stringify(errors)}`);
});
