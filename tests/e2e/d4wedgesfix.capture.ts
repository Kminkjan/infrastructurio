import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen } from "./hook";

/**
 * Captures for the verification fixes of the D4 portal wedges (2026-09-29; agent evidence, never a Look Gate verdict).
 * Runs only with `CAPTURE=1`, e.g. `CAPTURE=1 npx playwright test --project=capture tests/e2e/d4wedgesfix.capture.ts`;
 * images go to the gitignored test-results/d4-wedges-fix/<label>/ (D4WF_LABEL, default "after"; D4WF_OUT overrides the
 * folder, for a baseline worktree). Every scene is laid with the real pointer, Track (1) or Straight line (5), and shot
 * in Select; the dev hook only aims the camera and reads back. The views are the verification's:
 * - xslope, Straight (247, 130) → (223, 142), portal (231, 138): the crack along the plug's open outline beyond the wing
 *   ends at yaw 3 (Close and Detail), and the approach cutting's sawtooth crest at yaw 4 (Detail, pre-existing);
 * - ew75, Straight (227, 138) → (259, 138), west portal (237, 138): its notch at yaw 3, the rounded shoulder and the
 *   south wing's sliver at yaws 4 and 5 (Close) and at Default yaw 4;
 * - the dead end, Straight (220, 140) → (236, 140), portal (229, 140): the shoulder and the sliver at yaws 4 and 5;
 * - ewhill, Straight (254, 129) → (302, 129), west portal (267, 129): the crack at yaw 3;
 * - low3, Straight (215, 187) → (247, 123), portal (221, 175): the shoulder at yaw 4;
 * - two tracks, Track (243, 116) → (218, 91) (a tunnel, portal (224, 97)), then Track (228, 91) → (235, 98) beside it:
 *   where the second track's earthworks end behind the portal (the ground's step, 2.75 m behind and 16.1 m across).
 */

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LABEL = env.D4WF_LABEL ?? "after";
const OUT = env.D4WF_OUT ?? `test-results/d4-wedges-fix/${LABEL}`;
const CLOSE = 12;
const DEFAULT = 6;
const DETAIL = 22;

interface Hook {
  network(): { pieces: { structure: string }[] };
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
  // Back to Select (Escape from an idle tool), so no lattice overlay is drawn in the shots.
  for (let i = 0; i < 3 && (await page.evaluate(() => window.__diorama?.tool().active)) !== "select"; i++) await page.keyboard.press("Escape");
  return page.evaluate(() => (window.__diorama as unknown as Hook).network().pieces.map((p) => p.structure[0]).join(""));
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

/** Undoes the scene's commands. */
async function clear(page: Page, commands = 1): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  for (let i = 0; i < commands; i++) {
    await page.keyboard.press("Control+z");
    await settle(page);
  }
  const left = await page.evaluate(() => (window.__diorama as unknown as Hook).network().pieces.length);
  if (left !== 0) throw new Error(`clear: ${left} pieces left`);
  await page.waitForFunction(() => window.__diorama?.hud().toast === null, undefined, { timeout: 15_000 }).catch(() => undefined);
}

test(`D4 portal-wedge verification-fix captures (${LABEL})`, async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto("/");
  await settle(page);
  const log = (s: string) => console.log(`[d4-wedges-fix ${LABEL}] ${s}`);

  log(`xslope: ${await lay(page, "5", [247, 130], [223, 142])}`);
  await shoot(page, "xslope-close-yaw3", 231, 138, CLOSE, 3);
  await shoot(page, "xslope-detail-yaw3", 231, 138, DETAIL, 3);
  await shoot(page, "xslope-detail-yaw4", 231, 138, DETAIL, 4);
  await shoot(page, "xslope-close-yaw0", 231, 138, CLOSE);
  await shoot(page, "xslope-close-yaw1", 231, 138, CLOSE, 1);
  await clear(page);

  log(`ew75: ${await lay(page, "5", [227, 138], [259, 138])}`);
  await shoot(page, "ew75-west-close-yaw3", 237, 138, CLOSE, 3);
  await shoot(page, "ew75-west-close-yaw4", 237, 138, CLOSE, 4);
  await shoot(page, "ew75-west-close-yaw5", 237, 138, CLOSE, 5);
  await shoot(page, "ew75-west-detail-yaw5", 237, 138, DETAIL, 5);
  await shoot(page, "ew75-west-default-yaw4", 237, 138, DEFAULT, 4);
  await shoot(page, "ew75-west-close-yaw0", 237, 138, CLOSE);
  await clear(page);

  log(`deadend: ${await lay(page, "5", [220, 140], [236, 140])}`);
  await shoot(page, "deadend-close-yaw4", 229, 140, CLOSE, 4);
  await shoot(page, "deadend-close-yaw5", 229, 140, CLOSE, 5);
  await shoot(page, "deadend-default-yaw4", 229, 140, DEFAULT, 4);
  await shoot(page, "deadend-default-yaw5", 229, 140, DEFAULT, 5);
  await clear(page);

  log(`ewhill: ${await lay(page, "5", [254, 129], [302, 129])}`);
  await shoot(page, "ewhill-west-close-yaw3", 267, 129, CLOSE, 3);
  await shoot(page, "ewhill-west-detail-yaw3", 267, 129, DETAIL, 3);
  await clear(page);

  log(`low3: ${await lay(page, "5", [215, 187], [247, 123])}`);
  await shoot(page, "low3-south-close-yaw4", 221, 175, CLOSE, 4);
  await clear(page);

  log(`two tracks, tunnel: ${await lay(page, "1", [243, 116], [218, 91])}`);
  log(`two tracks, beside: ${await lay(page, "1", [228, 91], [235, 98])}`);
  for (const yaw of [0, 2, 4]) await shoot(page, `twotrack-close-yaw${yaw}`, 225, 95, CLOSE, yaw);
  await shoot(page, "twotrack-detail-yaw2", 225, 95, DETAIL, 2);
  await clear(page, 2);

  log(`page errors and warnings: ${JSON.stringify(errors)}`);
});
