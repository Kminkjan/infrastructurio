import { type Page, test } from "@playwright/test";
import { dragBetween, lookAtNode, nodeScreen } from "./hook";

/**
 * Terrain look captures (agent evidence, never a look verdict): each terrain
 * variant (`?terrain=`) at the four Look Gate A bookmarks, an open-grassland
 * view at Region zoom, a hill at Default and Close, and D3 track laid across
 * that hill with the real tool. Runs only with
 * `CAPTURE=1 npx playwright test --project=capture`; images go to the
 * gitignored test-results/terrain-look/<variant>/. It prints draw calls,
 * triangles, programs and two wall-clock frame costs per view (see `bench`),
 * plus a 2560 × 1600 pass. `TERRAIN_VARIANTS=d11a,a` narrows the run.
 */

const OUT = "test-results/terrain-look";
// The tsconfig has no Node types (specs run in Node, but type-check with the app's DOM libs).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const VARIANTS = (env.TERRAIN_VARIANTS ?? "d11a,a,b,c").split(",").filter(Boolean);
const BENCH_FRAMES = 60;
const BENCH_WARMUP = 120;
const GRASSLAND = { x: 1220, y: 1060 };

interface Spot {
  readonly q: number;
  readonly r: number;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(400);
}

async function shot(page: Page, variant: string, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${variant}/${name}.png` });
}

/**
 * Draw calls, triangles and programs of the current view, then two wall-clock
 * frame costs after a warm-up of BENCH_WARMUP renders (so the GPU clock
 * settles): `pipelinedMs`, the mean of BENCH_FRAMES back-to-back renders closed
 * by one 1-pixel readPixels (throughput), and `syncMs`, the median of
 * BENCH_FRAMES renders each closed by its own readPixels (latency, CPU and GPU).
 * EXT_disjoint_timer_query_webgl2 is exposed by Chrome on ANGLE Metal, but its
 * readings exceeded the synchronous frame time, so it is not used.
 */
async function bench(page: Page, variant: string, label: string): Promise<void> {
  const s = await page.evaluate(
    ({ frames, warmup }) => {
      const h = window.__diorama as unknown as {
        renderer: {
          render(scene: unknown, camera: unknown): void;
          getContext(): WebGL2RenderingContext;
          info: { render: { calls: number; triangles: number }; programs: unknown[] | null };
        };
        scene: unknown;
        camera: { camera: unknown; ppm: number };
      };
      const r = h.renderer;
      const gl = r.getContext();
      const px = new Uint8Array(4);
      const render = () => r.render(h.scene, h.camera.camera);
      const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < warmup; i++) render();
      finish();
      const calls = r.info.render.calls;
      const triangles = r.info.render.triangles;
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) render();
      finish();
      const pipelinedMs = (performance.now() - t0) / frames;
      const sync: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t = performance.now();
        render();
        finish();
        sync.push(performance.now() - t);
      }
      sync.sort((a, b) => a - b);
      return {
        ppm: h.camera.ppm,
        buffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
        calls,
        triangles,
        programs: r.info.programs?.length ?? null,
        pipelinedMs: Number(pipelinedMs.toFixed(3)),
        syncMs: Number((sync[Math.floor(sync.length / 2)] ?? 0).toFixed(2)),
      };
    },
    { frames: BENCH_FRAMES, warmup: BENCH_WARMUP },
  );
  console.log(`[terrain] ${variant} ${label}: ${JSON.stringify(s)}`);
}

/** Open grassland with some relief: no forest, fields, buildings, roads or water within 220 m. */
async function findGrassland(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const h = window.__diorama as unknown as {
      terrain: { columns: number; rows: number; heightsDm: Int16Array; water: Uint8Array };
      scenery: {
        forest: { cellMm: number; columns: number; rows: number; density: Uint8Array };
        fields: { xMm: number; yMm: number }[];
        lots: { xMm: number; yMm: number }[];
        roads: { points: { xMm: number; yMm: number }[] }[];
        streets: { points: { xMm: number; yMm: number }[] }[];
      };
    };
    const t = h.terrain;
    const s = h.scenery;
    const rowM = 2.5 * Math.sqrt(3);
    const reach = 220;
    const near = (x: number, y: number, p: { xMm: number; yMm: number }) => Math.hypot(p.xMm / 1000 - x, p.yMm / 1000 - y) < reach;
    let best = { score: -Infinity, x: 0, y: 0 };
    for (let y = 300; y < t.rows * rowM - 300; y += 40) {
      for (let x = 300; x < t.columns * 5 - 300; x += 40) {
        if (s.fields.some((f) => near(x, y, f)) || s.lots.some((l) => near(x, y, l))) continue;
        if ([...s.roads, ...s.streets].some((p) => p.points.some((q) => near(x, y, q)))) continue;
        const cell = s.forest.cellMm / 1000;
        let forest = 0;
        for (let j = Math.floor((y - reach) / cell); j <= (y + reach) / cell; j++) {
          for (let i = Math.floor((x - reach) / cell); i <= (x + reach) / cell; i++) {
            if (i >= 0 && j >= 0 && i < s.forest.columns && j < s.forest.rows) forest += (s.forest.density[j * s.forest.columns + i] ?? 0) > 40 ? 1 : 0;
          }
        }
        let lo = Infinity;
        let hi = -Infinity;
        let wet = 0;
        for (let r = Math.max(0, Math.round((y - reach) / rowM)); r < Math.min(t.rows, (y + reach) / rowM); r += 2) {
          for (let c = Math.max(0, Math.round((x - reach) / 5)); c < Math.min(t.columns, (x + reach) / 5); c += 2) {
            const k = r * t.columns + c;
            wet += t.water[k] ?? 0;
            lo = Math.min(lo, t.heightsDm[k] ?? 0);
            hi = Math.max(hi, t.heightsDm[k] ?? 0);
          }
        }
        if (wet > 0) continue;
        const score = (hi - lo) / 10 - 2 * forest;
        if (score > best.score) best = { score, x, y };
      }
    }
    return { x: best.x, y: best.y };
  });
}

/**
 * A dry straight run of `length` + 1 nodes along heading 0 (east) that climbs
 * over a hill: the largest rise from both ends to its highest node.
 */
async function findHillRun(page: Page, length: number): Promise<Spot> {
  return page.evaluate((length) => {
    const t = (window.__diorama as unknown as { terrain: { columns: number; rows: number; heightsDm: Int16Array; water: Uint8Array } }).terrain;
    let best = { score: -Infinity, q: 0, r: 0 };
    for (let r = 60; r < t.rows - 60; r += 3) {
      for (let c0 = 60; c0 + length < t.columns - 60; c0 += 3) {
        let peak = -Infinity;
        let dry = true;
        for (let c = c0; c <= c0 + length && dry; c++) {
          const k = r * t.columns + c;
          if (t.water[k]) dry = false;
          peak = Math.max(peak, t.heightsDm[k] ?? 0);
        }
        if (!dry) continue;
        const a = t.heightsDm[r * t.columns + c0] ?? 0;
        const b = t.heightsDm[r * t.columns + c0 + length] ?? 0;
        const score = Math.min(peak - a, peak - b);
        if (score > best.score) best = { score, q: c0 - Math.floor(r / 2), r };
      }
    }
    return { q: best.q, r: best.r };
  }, length);
}

for (const variant of VARIANTS) {
  test(`terrain look captures: ${variant}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
    });
    const terrain = `terrain=${variant}`;

    for (const id of [1, 2, 3, 4]) {
      await open(page, `?${terrain}&bookmark=${id}`);
      await shot(page, variant, `bookmark-${id}`);
      await bench(page, variant, `bookmark ${id}`);
    }

    await open(page, `?${terrain}`);
    const grass = await findGrassland(page);
    console.log(`[terrain] grassland centre (sim m): ${JSON.stringify(grass)}`);
    for (const [ppm, name] of [[2.5, "grassland-region"], [0.9, "grassland-far"], [6, "grassland-default"]] as const) {
      await page.evaluate(({ x, y, ppm }) => (window.__diorama as unknown as { lookAt(x: number, y: number, p: number): void }).lookAt(x, y, ppm), { ...grass, ppm });
      await page.waitForTimeout(300);
      await shot(page, variant, name);
      await bench(page, variant, name);
    }

    // A hill: a 36-step run east over its crest, then track laid along it with the real tool.
    const length = 36;
    const { q, r } = await findHillRun(page, length);
    console.log(`[terrain] hill run from (${q}, ${r}), ${length} steps east`);
    await lookAtNode(page, q + length / 2, r, 6);
    await shot(page, variant, "hill-default");
    await lookAtNode(page, q + length / 2, r, 12);
    await shot(page, variant, "hill-close");
    await lookAtNode(page, q + length / 2, r, 6);
    // One yaw step (E) and back (Q): the sun turns with the camera, the detail stays on the ground.
    await page.keyboard.press("e");
    await page.waitForTimeout(1200);
    await shot(page, variant, "hill-default-yaw1");
    await page.keyboard.press("q");
    await page.waitForTimeout(1200);
    await page.keyboard.press("1");
    await dragBetween(page, await nodeScreen(page, q, r), await nodeScreen(page, q + length, r), 24);
    // Build mode, the pointer near the crest: the lattice overlay over the terrain look.
    const crest = await nodeScreen(page, q + (2 * length) / 3, r + 3);
    await page.mouse.move(crest.x, crest.y);
    await shot(page, variant, "track-hill-build");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // Park the pointer off the track so no snap ring sits on it.
    await page.mouse.move(40, 760);
    await page.waitForFunction(() => window.__diorama?.ready === true);
    await shot(page, variant, "track-hill-default");
    await bench(page, variant, "track hill default");
    await lookAtNode(page, q + length / 2, r, 2.5);
    await shot(page, variant, "track-hill-region");
    await lookAtNode(page, q + length / 2, r, 12);
    await shot(page, variant, "track-hill-close");
    console.log(`[terrain] ${variant} page errors and warnings: ${JSON.stringify(errors)}`);
  });
}

// Headless Chrome keeps the canvas at its CSS size even with deviceScaleFactor 2 (no
// device-pixel content box), so a 2560 × 1600 viewport at DPR 1 stands in for 1280 × 800 at
// DPR 2: the same pixel count, though it shows four times the ground at the same zoom.
test.describe("terrain frame cost at 2560 × 1600", () => {
  test.use({ viewport: { width: 2560, height: 1600 } });
  for (const variant of VARIANTS) {
    test(`frame cost at 2560 × 1600: ${variant}`, async ({ page }) => {
      for (const id of [3, 4]) {
        await open(page, `?terrain=${variant}&bookmark=${id}`);
        await bench(page, variant, `2560x1600 bookmark ${id}`);
      }
      await page.evaluate(({ x, y }) => (window.__diorama as unknown as { lookAt(x: number, y: number, p: number): void }).lookAt(x, y, 2.5), GRASSLAND);
      await page.waitForTimeout(300);
      await bench(page, variant, "2560x1600 grassland-region");
    });
  }
});
