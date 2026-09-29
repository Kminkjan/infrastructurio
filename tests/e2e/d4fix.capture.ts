import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen } from "./hook";

/**
 * D4 feel-check fix captures (agent evidence, never a Look Gate verdict), after the owner's feel check of 2026-09-28
 * ("Not yet": "Too many red drags", "Structures look off"). Runs only with `CAPTURE=1 npx playwright test
 * --project=capture tests/e2e/d4fix.capture.ts`; images go to the gitignored test-results/d4-fix/<label>/ (D4FIX_LABEL,
 * default "after"). Every scene is laid with the real pointer, Track (1) or Straight line (5), build mode on (the
 * lattice overlay shows, as in the owner's screenshot):
 * - the owner's scene: the hill curve (226, 100) → (233, 117), then a Track drag (234, 114) → (234, 102) beside it
 *   (before the fix: a portal on the curve's cutting floor, a plug block with open edges over the curve's track);
 * - a Straight line tunnel through the open hill east of the curve, (249, 109) → (235, 95) (heading 7, 14 pieces:
 *   ground, five tunnel pieces, ground; portals at (243, 103) and (238, 98)), then a Track drag 10 m beside it,
 *   (251, 107) → (237, 93), whose cutting runs past both portals: the portals at Close;
 * - a Straight line over the lake from its north shore, 60 secondary pieces north from (65, 200).
 */

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LABEL = env.D4FIX_LABEL ?? "after";
const OUT = `test-results/d4-fix/${LABEL}`;

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
}

async function lay(page: Page, tool: "1" | "5", from: [number, number], to: [number, number]): Promise<string[]> {
  await page.keyboard.press(tool);
  await dragBetween(page, await nodeScreen(page, ...from), await nodeScreen(page, ...to), 20);
  await page.keyboard.press("Escape");
  await settle(page);
  const kinds = await page.evaluate(() => (window.__diorama as unknown as { network(): { pieces: { structure: string }[] } }).network().pieces.map((p) => p.structure[0]).join(""));
  return [kinds];
}

async function shoot(page: Page, name: string, q: number, r: number, ppm: number, yawSteps = 0): Promise<void> {
  await lookAtNode(page, q, r, ppm);
  for (let i = 0; i < yawSteps; i++) await page.keyboard.press("e");
  if (yawSteps > 0) {
    await page.waitForTimeout(1300);
    await lookAtNode(page, q, r, ppm);
  }
  await page.mouse.move(4, 796);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  for (let i = 0; i < yawSteps; i++) await page.keyboard.press("q");
  if (yawSteps > 0) await page.waitForTimeout(1300);
}

test(`D4 feel-check fix captures (${LABEL})`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto("/");
  await settle(page);

  // 1. The owner's scene.
  await lookAtNode(page, 230, 108, 6);
  console.log(`[d4-fix] hill curve: ${await lay(page, "1", [226, 100], [233, 117])}`);
  console.log(`[d4-fix] beside it: ${await lay(page, "1", [234, 114], [234, 102])}`);
  await page.keyboard.press("1");
  await shoot(page, "owner-portal-close", 234, 110, 12);
  await shoot(page, "owner-north-close", 233, 106, 12);
  await shoot(page, "owner-default", 232, 109, 6);
  await shoot(page, "owner-portal-close-yaw2", 234, 110, 12, 2);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  for (let i = 0; i < 2; i++) await page.keyboard.press("Control+z");
  await settle(page);

  // 2. A Straight line tunnel, then a neighbour's cutting past its portals.
  await lookAtNode(page, 242, 102, 5);
  console.log(`[d4-fix] straight tunnel: ${await lay(page, "5", [249, 109], [235, 95])}`);
  await page.keyboard.press("5");
  await shoot(page, "straight-tunnel-default", 242, 102, 6);
  await shoot(page, "straight-tunnel-region", 242, 102, 2.5);
  await shoot(page, "straight-tunnel-portal-a-close", 243, 103, 12);
  await shoot(page, "straight-tunnel-portal-b-close", 238, 98, 12);
  await shoot(page, "straight-tunnel-portal-a-close-yaw2", 243, 103, 12, 2);
  await shoot(page, "straight-tunnel-portal-b-close-yaw4", 238, 98, 12, 4);
  await page.keyboard.press("Escape");
  await lookAtNode(page, 244, 100, 5);
  console.log(`[d4-fix] with a neighbour: ${await lay(page, "1", [251, 107], [237, 93])}`);
  await page.keyboard.press("1");
  await shoot(page, "neighbour-portal-a-close", 243, 103, 12);
  await shoot(page, "neighbour-portal-b-close", 238, 98, 12);
  await shoot(page, "neighbour-portal-a-close-yaw2", 243, 103, 12, 2);
  await shoot(page, "neighbour-default", 242, 101, 6);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  for (let i = 0; i < 2; i++) await page.keyboard.press("Control+z");
  await settle(page);

  // 3. A Straight line over the lake.
  await lookAtNode(page, 35, 260, 1.8);
  console.log(`[d4-fix] straight lake: ${await lay(page, "5", [65, 200], [5, 320])}`);
  await page.keyboard.press("5");
  await shoot(page, "straight-lake-region", 35, 260, 2);
  await shoot(page, "straight-lake-default", 50, 230, 5);
  await shoot(page, "straight-lake-far-end", 20, 290, 5);
  const stats = await page.evaluate(() => (window.__diorama as unknown as { structureStats(): unknown }).structureStats());
  console.log(`[d4-fix] structures ${JSON.stringify(stats)}`);
  console.log(`[d4-fix] page errors and warnings: ${JSON.stringify(errors)}`);
});
