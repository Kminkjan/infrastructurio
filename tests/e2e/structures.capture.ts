import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen } from "./hook";

/**
 * D4 structure captures (agent evidence, never a Look Gate verdict). Runs only with
 * `CAPTURE=1 npx playwright test --project=capture structures`; images go to the gitignored
 * test-results/structures/<label>/ (STRUCT_LABEL, default "after"; STRUCT_QUERY adds URL parameters,
 * such as `?structures=0` for the same scene without structures; STRUCT_STILL=1 emulates reduced motion;
 * STRUCT_FRAMES=1 also logs the frame cost at four views: the mean ms of 60 back-to-back renders closed by a
 * one-pixel readPixels after 120 warm-up renders, with the last render's draw calls and triangles).
 *
 * The level decks and the tunnel are laid through the dev hook's sim (`__diorama.sim.execute`, forced
 * structures), not the tools: the D3 planner lays every node on the ground (plus a ramped offset), so a
 * level deck across a valley or a bore through a hill needs the core's auto-grade planner (D4 core lane).
 * The track under the viaduct is laid with the real Track tool. Sites on the golden diorama:
 * - a viaduct across the valley by the lake, heading 4 from (23, 230), deck at 27.0 m over a
 *   bottom at 10.7 m, with ground approaches, crossing a track on the valley side at (9, 244)
 *   (a girder span);
 * - a bridge over the river valley, heading 2 from (242, 104), deck at 31.9 m, 21.9 m over the water;
 * - a tunnel through the hill heading 2 from (40, 180) at 17.0 m, under up to 16.7 m of cover, between the nodes
 *   where its cover passes the 8 m band (12 and 55 along the line).
 */

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LABEL = env.STRUCT_LABEL ?? "after";
const QUERY = env.STRUCT_QUERY ?? "";
const STILL = env.STRUCT_STILL === "1";
const FRAMES = env.STRUCT_FRAMES === "1";
const OUT = `test-results/structures/${LABEL}`;

const STEPS: Record<number, [number, number]> = { 0: [1, 0], 2: [0, 1], 4: [-1, 1] };

interface Run {
  readonly q: number;
  readonly r: number;
  readonly d: 0 | 2 | 4;
  /** Node index ranges along the line and their structures. */
  readonly parts: readonly (readonly [number, number, "ground" | "bridge" | "tunnel"])[];
  readonly zMm: number;
}

async function layRun(page: Page, run: Run): Promise<void> {
  const [dq, dr] = STEPS[run.d] as [number, number];
  for (const [from, to, structure] of run.parts) {
    const pieces = [];
    for (let i = from; i < to; i++) pieces.push({ kind: "straight", from: { q: run.q + dq * i, r: run.r + dr * i, zMm: run.zMm }, heading: run.d, z1Mm: run.zMm });
    const result = await page.evaluate(
      ({ pieces, structure }) => (window.__diorama as unknown as { sim: { execute(c: unknown): { ok: boolean } } }).sim.execute({ type: "build-track", pieces, structure }),
      { pieces, structure },
    );
    if (!result.ok) throw new Error(`build failed: ${JSON.stringify(result)}`);
  }
  await page.evaluate(() => (window.__diorama as unknown as { scheduler: { requestFrame(r: string): void } }).scheduler.requestFrame("network"));
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(400);
}

async function lookAtNodeZ(page: Page, q: number, r: number, ppm: number): Promise<void> {
  await lookAtNode(page, q, r, ppm);
  await page.waitForTimeout(250);
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.mouse.move(4, 796);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

const VIADUCT: Run = { q: 23, r: 230, d: 4, zMm: 27_000, parts: [[-4, 3, "ground"], [3, 57, "bridge"], [57, 62, "ground"]] };
const RIVER: Run = { q: 242, r: 104, d: 2, zMm: 31_900, parts: [[0, 4, "ground"], [4, 31, "bridge"], [31, 33, "ground"]] };
// The tunnel runs where its cover passes the 8 m band (owner decision 2026-09-28 "M2"): nodes 12–55, with cuttings
// up to 7.7 m deep before and after it (until then nodes 8–57).
const TUNNEL: Run = { q: 40, r: 180, d: 2, zMm: 17_000, parts: [[-3, 12, "ground"], [12, 55, "tunnel"], [55, 61, "ground"]] };
const WEST_PORTAL = 12;
const EAST_PORTAL = 55;

test(`structure captures (${LABEL})`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  if (STILL) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/${QUERY}`);
  await settle(page);

  // The valley-side track, with the real Track tool: under the viaduct's node 14, (9, 244), east–west on dry ground.
  await lookAtNode(page, 9, 244, 4);
  await page.keyboard.press("1");
  await dragBetween(page, await nodeScreen(page, 1, 244), await nodeScreen(page, 17, 244), 20);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settle(page);

  for (const run of [VIADUCT, RIVER, TUNNEL]) await layRun(page, run);
  await settle(page);
  const stats = await page.evaluate(() => (window.__diorama as unknown as { structureStats(): unknown }).structureStats());
  const layouts = await page.evaluate(() => (window.__diorama as unknown as { structureLayouts(): { spans: { a: number; b: number; type: string; rule: string; riseM: number }[] }[] }).structureLayouts().map((l) => l.spans.map((s) => `${s.type}/${s.rule} ${(s.b - s.a).toFixed(1)}m r${s.riseM}`)));
  console.log(`[structures] ${LABEL}: ${JSON.stringify(stats)}`);
  console.log(`[structures] ${LABEL} layouts: ${JSON.stringify(layouts)}`);

  const at = (run: Run, i: number): [number, number] => {
    const [dq, dr] = STEPS[run.d] as [number, number];
    return [run.q + dq * i, run.r + dr * i];
  };
  const views: [string, [number, number], number][] = [
    ["viaduct-close", at(VIADUCT, 20), 12],
    ["viaduct-default", at(VIADUCT, 24), 6],
    ["viaduct-region", at(VIADUCT, 30), 2.5],
    ["girder-close", at(VIADUCT, 14), 12],
    ["girder-default", at(VIADUCT, 14), 6],
    ["truss-close", at(RIVER, 18), 12],
    ["truss-default", at(RIVER, 18), 6],
    ["truss-region", at(RIVER, 18), 2.5],
    ["portal-west-close", at(TUNNEL, WEST_PORTAL), 12],
    ["portal-west-zoom", at(TUNNEL, WEST_PORTAL), 24],
    ["portal-east-close", at(TUNNEL, EAST_PORTAL), 12],
    ["portal-east-zoom", at(TUNNEL, EAST_PORTAL), 24],
    ["tunnel-default", at(TUNNEL, WEST_PORTAL + 4), 6],
    ["tunnel-region", at(TUNNEL, 32), 2.5],
  ];
  for (const [name, [q, r], ppm] of views) {
    await lookAtNodeZ(page, q, r, ppm);
    await shoot(page, name);
  }
  // One yaw step on the viaduct and a portal: the sun turns with the camera.
  await lookAtNodeZ(page, ...at(VIADUCT, 20), 12);
  await page.keyboard.press("e");
  await page.waitForTimeout(900);
  await shoot(page, "viaduct-close-yaw1");
  await page.keyboard.press("q");
  await page.waitForTimeout(900);
  await lookAtNodeZ(page, ...at(TUNNEL, WEST_PORTAL), 12);
  await page.keyboard.press("e");
  await page.keyboard.press("e");
  await page.waitForTimeout(1200);
  await shoot(page, "portal-west-close-yaw2");
  // The east portal from its front (three yaw steps turn the view half round).
  await lookAtNodeZ(page, ...at(TUNNEL, EAST_PORTAL), 12);
  await page.keyboard.press("e");
  await page.waitForTimeout(1200);
  await shoot(page, "portal-east-close-yaw3");
  await page.keyboard.press("q");
  await page.keyboard.press("q");
  await page.keyboard.press("q");
  await page.waitForTimeout(1500);

  // The ghosts: the Bridge tool mid-drag beside the river bridge, the Tunnel tool mid-drag over the hill.
  await lookAtNodeZ(page, ...at(RIVER, 18), 6);
  await page.keyboard.press("5");
  const [bq, br] = at(RIVER, 12);
  await page.mouse.move(...(Object.values(await nodeScreen(page, bq + 6, br)) as [number, number]));
  await page.mouse.down();
  await page.mouse.move(...(Object.values(await nodeScreen(page, bq + 6, br + 12)) as [number, number]), { steps: 10 });
  for (let i = 0; i < 6; i++) await page.keyboard.press("PageUp");
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ghost-bridge-default.png` });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await lookAtNodeZ(page, ...at(TUNNEL, 30), 6);
  await page.keyboard.press("6");
  const [tq, tr] = at(TUNNEL, 26);
  await page.mouse.move(...(Object.values(await nodeScreen(page, tq + 6, tr)) as [number, number]));
  await page.mouse.down();
  await page.mouse.move(...(Object.values(await nodeScreen(page, tq + 6, tr + 10)) as [number, number]), { steps: 10 });
  for (let i = 0; i < 8; i++) await page.keyboard.press("PageDown");
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ghost-tunnel-default.png` });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // The occlusion aids: H over the girder crossing, U over the tunnel.
  await lookAtNodeZ(page, ...at(VIADUCT, 14), 6);
  await page.keyboard.press("h");
  await page.waitForTimeout(300);
  await shoot(page, "aid-h-default");
  await page.keyboard.press("h");
  await lookAtNodeZ(page, ...at(TUNNEL, 30), 4);
  await page.keyboard.press("u");
  await page.waitForTimeout(300);
  await shoot(page, "aid-u-mid");
  await lookAtNodeZ(page, ...at(TUNNEL, 12), 6);
  await shoot(page, "aid-u-default");
  await page.keyboard.press("u");
  if (FRAMES) {
    const costs: Record<string, unknown> = {};
    for (const [name, [q, r], ppm] of [
      ["viaduct-default", at(VIADUCT, 24), 6],
      ["truss-default", at(RIVER, 18), 6],
      ["tunnel-default", at(TUNNEL, 12), 6],
      ["viaduct-region", at(VIADUCT, 30), 2.5],
    ] as const) {
      await lookAtNodeZ(page, q, r, ppm);
      costs[name] = await page.evaluate(() => {
        const h = window.__diorama as unknown as { renderer: { render(s: unknown, c: unknown): void; getContext(): WebGL2RenderingContext; info: { render: { calls: number; triangles: number } } }; scene: unknown; camera: { camera: unknown } };
        const gl = h.renderer.getContext();
        const px = new Uint8Array(4);
        for (let i = 0; i < 120; i++) h.renderer.render(h.scene, h.camera.camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now();
        for (let i = 0; i < 60; i++) h.renderer.render(h.scene, h.camera.camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const ms = (performance.now() - t0) / 60;
        return { ms: +ms.toFixed(3), calls: h.renderer.info.render.calls, triangles: h.renderer.info.render.triangles };
      });
    }
    console.log(`[structures] ${LABEL} frame cost: ${JSON.stringify(costs)}`);
  }
  console.log(`[structures] ${LABEL} page errors and warnings: ${JSON.stringify(errors)}`);
});
