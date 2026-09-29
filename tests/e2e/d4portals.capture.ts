import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen } from "./hook";

/**
 * D4 second feel-check captures (agent evidence, never a Look Gate verdict), after the owner's feel check of
 * 2026-09-28 ("Not yet": "Earthworks/terrain look off", two screenshots: wedges above flat ground in front of two
 * facing portals; a thin beige wall with a dark smudge and a post) and the owner's four answers ("Needs 10 m
 * somewhere", "Compact backfill", "Splayed wing walls", "Keep the limit, show it"). Runs only with `CAPTURE=1`, e.g.
 * `CAPTURE=1 npx playwright test --project=capture tests/e2e/d4portals.capture.ts`; images go to the gitignored
 * test-results/d4-iter3/<label>/ (D4P_LABEL, default "after"; D4P_OUT overrides the folder, for a baseline worktree).
 * Every scene is laid with the real pointer, Track (1) or Straight line (5), and shot in build mode; the dev hook only
 * aims the camera and reads back. The drags (lattice (q, r)), found in Node on the diorama:
 * - the owner's two scenes as the diagnosis reproduced them: facing portals s208, Straight (208, 146) → (232, 146),
 *   and the thin wall s231, Straight (231, 137) → (255, 137) (both one cutting since "Needs 10 m somewhere");
 * - an east–west tunnel, Straight (254, 129) → (302, 129) (the e2e hill): its west portal at all six yaws, Close and
 *   Default, and a splayed-wing close-up at Detail;
 * - a short tunnel, Straight (74, 162) → (110, 162) (25 m, portals at (79, 162) and (84, 162));
 * - facing portals 5 m apart, Straight (−4, 219) → (32, 219);
 * - low portals: Track (199, 134) → (165, 162) (portal (184, 149) on heading 4 under 4.1 m, a side slope of 5.5 m
 *   over 16 m; all six yaws) and Track (192, 134) → (203, 159) (portal (203, 145) under 4.6 m);
 * - a side-slope portal, Straight (229, 132) → (253, 132) (portal (245, 132), 9.4 m of fall over 16 m across);
 * - a dead end, Straight (220, 140) → (236, 140) (the buffer 11.2 m under the hill: no portal since the core's
 *   definition);
 * - the Track curve (208, 146) → (228, 152).
 */

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LABEL = env.D4P_LABEL ?? "after";
const OUT = env.D4P_OUT ?? `test-results/d4-iter3/${LABEL}`;
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
    return o ? o.map((p) => `(${p.frame.x.toFixed(0)},${p.frame.y.toFixed(0)}) wings ${p.wings.left.toFixed(1)}/${p.wings.right.toFixed(1)}`).join("; ") : "n/a";
  });
  const stats = await page.evaluate(() => (window.__diorama as unknown as Hook).structureStats());
  await page.keyboard.press(tool);
  return `${kinds} | portals ${outlines} | ${JSON.stringify(stats)}`;
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
}

test(`D4 second feel-check captures (${LABEL})`, async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto("/");
  await settle(page);
  const log = (s: string) => console.log(`[d4-iter3 ${LABEL}] ${s}`);

  log(`s208: ${await lay(page, "5", [208, 146], [232, 146])}`);
  await shoot(page, "s208-default", 225, 146, DEFAULT);
  await shoot(page, "s208-close", 225, 146, CLOSE);
  await shoot(page, "s208-close-yaw4", 225, 146, CLOSE, 4);
  await clear(page);

  log(`s231: ${await lay(page, "5", [231, 137], [255, 137])}`);
  await shoot(page, "s231-default", 246, 137, DEFAULT);
  await shoot(page, "s231-close", 242, 137, CLOSE);
  await shoot(page, "s231-close-yaw5", 242, 137, CLOSE, 5);
  await clear(page);

  log(`ew: ${await lay(page, "5", [254, 129], [302, 129])}`);
  for (let k = 0; k < 6; k++) {
    await shoot(page, `ew-close-yaw${k}`, 267, 129, CLOSE, k);
    await shoot(page, `ew-default-yaw${k}`, 267, 129, DEFAULT, k);
  }
  await shoot(page, "ew-splay-detail-yaw0", 267, 129, DETAIL);
  await shoot(page, "ew-splay-detail-yaw5", 267, 129, DETAIL, 5);
  await shoot(page, "ew-east-close-yaw3", 290, 129, CLOSE, 3);
  await clear(page);

  log(`short: ${await lay(page, "5", [74, 162], [110, 162])}`);
  await shoot(page, "short-default", 81, 162, DEFAULT);
  for (let k = 0; k < 6; k++) await shoot(page, `short-close-yaw${k}`, 81, 162, CLOSE, k);
  await clear(page);

  log(`facing: ${await lay(page, "5", [-4, 219], [32, 219])}`);
  await shoot(page, "facing-default", 22, 219, DEFAULT);
  await shoot(page, "facing-close", 22, 219, CLOSE);
  await clear(page);

  log(`low: ${await lay(page, "1", [199, 134], [165, 162])}`);
  for (let k = 0; k < 6; k++) {
    await shoot(page, `low-close-yaw${k}`, 184, 149, CLOSE, k);
    await shoot(page, `low-default-yaw${k}`, 184, 149, DEFAULT, k);
  }
  for (const k of [0, 4, 5]) await shoot(page, `low-detail-yaw${k}`, 184, 149, DETAIL, k);
  await clear(page);

  log(`low2: ${await lay(page, "1", [192, 134], [203, 159])}`);
  await shoot(page, "low2-close", 203, 145, CLOSE);
  await shoot(page, "low2-close-yaw2", 203, 145, CLOSE, 2);
  await shoot(page, "low2-default", 203, 145, DEFAULT);
  await clear(page);

  log(`cross: ${await lay(page, "5", [229, 132], [253, 132])}`);
  await shoot(page, "cross-close", 245, 132, CLOSE);
  await shoot(page, "cross-close-yaw4", 245, 132, CLOSE, 4);
  await shoot(page, "cross-close-yaw5", 245, 132, CLOSE, 5);
  await shoot(page, "cross-default", 245, 132, DEFAULT);
  await clear(page);

  log(`deadend: ${await lay(page, "5", [220, 140], [236, 140])}`);
  await shoot(page, "deadend-default", 231, 140, DEFAULT);
  await shoot(page, "deadend-close", 229, 140, CLOSE);
  await shoot(page, "deadend-buffer-close", 236, 140, CLOSE);
  await clear(page);

  log(`curve: ${await lay(page, "1", [208, 146], [228, 152])}`);
  await shoot(page, "curve-default", 218, 149, DEFAULT);
  await shoot(page, "curve-close", 220, 150, CLOSE);
  await clear(page);

  log(`page errors and warnings: ${JSON.stringify(errors)}`);
});
