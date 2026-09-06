import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { defaultControls } from "./scene.mjs";
const output = process.argv[2] ?? "docs/research/m4/rendering";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--window-size=1320,900"],
});
const report = {
  recordedAt: new Date().toISOString(),
  method:
    "Automated Playwright DOM mouse/keyboard input with projected target coordinates; no human participants. Headed Chrome, one page at a time.",
  hardware: {
    cpu: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
      encoding: "utf8",
    }).trim(),
    memoryBytes: Number(
      execFileSync("sysctl", ["-n", "hw.memsize"], { encoding: "utf8" }),
    ),
    os: execFileSync("sw_vers", ["-productVersion"], {
      encoding: "utf8",
    }).trim(),
  },
  browser: browser.version(),
  sourceHashes: {},
  runs: [],
};
for (const name of [
  "scene.mjs",
  "pixi-view.mjs",
  "three-view.mjs",
  "study.mjs",
  "index.html",
  "run-study.mjs",
  "../../../src/rendering/map-camera.ts",
  "../../../package-lock.json",
])
  report.sourceHashes[name] = createHash("sha256")
    .update(await readFile(new URL(name, import.meta.url)))
    .digest("hex");
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    median: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
    max: s.at(-1),
    over20ms: s.filter((x) => x > 20).length,
  };
}
try {
  const baseline = await browser.newPage({viewport: {width:1320,height:900},deviceScaleFactor:1});
  await baseline.goto('http://127.0.0.1:5173/');
  await baseline.locator('canvas').waitFor();
  await baseline.waitForTimeout(1000);
  await baseline.screenshot({path:`${output}/current-application.png`});
  await baseline.close();
  for (const mode of ["2d", "3d"]) {
    const page = await browser.newPage({
      viewport: { width: 1320, height: 900 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `http://127.0.0.1:5173/experiments/m4/rendering/index.html?mode=${mode}`,
    );
    await page.waitForFunction(() => window.study);
    const run = {
      mode,
      info: await page.evaluate(() => study.info()),
      observations: [],
      samples: [],
      errors,
    };
    async function pos(world) {
      const xy = await page.evaluate((p) => study.project(p), world),
        box = await page.locator("canvas").boundingBox();
      return { x: box.x + xy[0], y: box.y + xy[1] };
    }
    async function click(world) {
      const p = await pos(world);
      await page.mouse.click(p.x, p.y);
    }
    async function screenshot(name) {
      await page.screenshot({ path: `${output}/${mode}-${name}.png` });
    }
    await screenshot("baseline");
    await page.locator("#draw").click();
    for (const p of defaultControls) await click(p);
    let controls = await page.evaluate(() => study.state.controls);
    run.observations.push({
      task: "draw-s-curve",
      controls,
      maxWorldError: Math.max(
        ...controls.map((p, i) =>
          Math.hypot(
            p[0] - defaultControls[i][0],
            p[1] - defaultControls[i][1],
          ),
        ),
      ),
    });
    const a = await pos([...controls[1], 1]),
      b = await pos([280, 110, 1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    controls = await page.evaluate(() => study.state.controls);
    run.observations.push({
      task: "reshape",
      point: controls[1],
      worldError: Math.hypot(controls[1][0] - 280, controls[1][1] - 110),
    });
    await screenshot("curve");
    await click([244, 234, 0.4]);
    run.observations.push({
      task: "turn-lane",
      expected: "turn-lane",
      actual: await page.evaluate(() => study.state.selected),
    });
    await screenshot("lane");
    await click([400, 180, 45]);
    const bridgeSelection = await page.evaluate(() => study.state.selected);
    await page.locator("#raise").click();
    run.observations.push({
      task: "elevated-crossing",
      expected: "bridge",
      actual: bridgeSelection,
      elevationAfter: await page.evaluate(() => study.state.bridgeZ),
    });
    await screenshot("bridge");
    await click([400, 250, 1]);
    run.observations.push({
      task: "obscured-queue-direct",
      expected: "queue-0",
      actual: await page.evaluate(() => study.state.selected),
    });
    await page.locator("#hide").check();
    await click([400, 250, 1]);
    run.observations.push({
      task: "obscured-queue-filtered",
      expected: "queue-0",
      actual: await page.evaluate(() => study.state.selected),
      text: await page.locator("#status").innerText(),
    });
    await screenshot("queue");
    await page.locator("#selection").focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    run.observations.push({
      task: "keyboard-queue-list",
      actual: await page.evaluate(() => study.state.selected),
    });
    await page.locator("#selection").selectOption("handle-1");
    const before = await page.evaluate(() => study.state.controls[1]);
    await page.locator("canvas").focus();
    await page.keyboard.press("ArrowRight");
    const after = await page.evaluate(() => study.state.controls[1]);
    run.observations.push({
      task: "keyboard-reshape",
      delta: after.map((v, i) => v - before[i]),
    });
    if (mode === "3d") {
      await page.locator("#top").check();
      await screenshot("top-camera");
    }
    run.interactionLog = await page.evaluate(() => study.log);
    run.editRebuildCpu = stats(await page.evaluate(() => study.rebuildTimingsMs));
    await page.locator("#reset").click();
    for (const workload of ["editing", "stress"]) {
      if (workload === "stress") await page.locator("#stress").click();
      await page.waitForTimeout(1500);
      for (let repeat = 0; repeat < 3; repeat++) {
        await page.evaluate(() => study.startSample());
        await page.waitForTimeout(3500);
        const raw = await page.evaluate(() => study.endSample());
        run.samples.push({
          workload,
          repeat,
          frame: stats(raw.frameIntervalsMs),
          cpu: stats(raw.updateAndSubmitMs),
          raw,
        });
      }
      await screenshot(`${workload}-timing`);
    }
    report.runs.push(run);
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify(
    report.runs.map((r) => ({
      mode: r.mode,
      observations: r.observations,
      errors: r.errors,
      samples: r.samples.map(({ raw, ...s }) => s),
    })),
    null,
    2,
  ),
);
