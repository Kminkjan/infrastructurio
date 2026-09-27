import { expect, test } from "@playwright/test";
import { cameraView, dragBetween, findDryRun, lookAtNode, nodeAtOffset, nodeScreen, openDiorama, snapshot, undoToEmpty } from "./hook";

/**
 * D3 construction e2e (agent evidence: synthetic input through the real
 * pointer and keyboard; it says nothing about construction feel).
 */

test("builds track by dragging, chains with a click, then undoes back to an empty network", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r } = await findDryRun(page, 12);
  await lookAtNode(page, q + 6, r, 6);

  await page.keyboard.press("1");
  expect((await snapshot(page)).tool).toBe("track");

  // Drag 6 nodes east: the straight-only stub and the full planner agree on a collinear drag.
  await dragBetween(page, await nodeScreen(page, q, r), await nodeScreen(page, q + 6, r));
  let s = await snapshot(page);
  expect(s.pieces).toBe(6);
  expect(s.phase).toBe("anchored");
  expect(s.canUndo).toBe(true);

  // Chain: anchored at the new end, the ghost and tooltip follow the pointer; a click lays it.
  const chainEnd = await nodeScreen(page, q + 10, r);
  await page.mouse.move(chainEnd.x, chainEnd.y, { steps: 6 });
  await expect(page.getByTestId("construction-tooltip")).toContainText("Pieces: 4 new, 0 reused");
  await expect(page.getByTestId("status-line")).toContainText("Pieces: 4 new, 0 reused");
  await page.mouse.click(chainEnd.x, chainEnd.y);
  s = await snapshot(page);
  expect(s.pieces).toBe(10);

  // Esc steps back: Anchored → Idle → Select.
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).phase).toBe("idle");
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).tool).toBe("select");

  // Undo (Ctrl+Z) twice empties it, each with a toast; redo (Ctrl+Shift+Z) brings the first run back.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("toast")).toContainText("Undone: removed 4 pieces");
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).pieces).toBe(0);
  await page.keyboard.press("Control+Shift+Z");
  await expect(page.getByTestId("toast")).toContainText("Redone: added 6 pieces");
  expect((await snapshot(page)).pieces).toBe(6);
  await undoToEmpty(page);
  s = await snapshot(page);
  expect(s.canUndo).toBe(false);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("builds from the keyboard: 1, arrows, Enter, arrows, Enter", async ({ page }) => {
  await openDiorama(page);
  const { q, r } = await findDryRun(page, 8, 0.3);
  await lookAtNode(page, q + 4, r, 6);
  // Park the pointer on the start node so the cursor begins where we expect.
  const start = await nodeScreen(page, q, r);
  await page.mouse.move(start.x, start.y);
  await page.keyboard.press("1");
  await page.mouse.move(start.x + 1, start.y);
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).phase).toBe("anchored");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("construction-tooltip")).toContainText("Pieces: 5 new, 0 reused");
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).pieces).toBe(5);
  // With precision held (⌥ on macOS, Ctrl elsewhere) the arrows and Enter still move and commit the plan.
  const precisionKey = (await page.evaluate(() => /mac/i.test(navigator.platform))) ? "Alt" : "Control";
  await page.keyboard.down(precisionKey);
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("construction-tooltip")).toContainText("Precision: Straight");
  await expect(page.getByTestId("construction-tooltip")).toContainText("Pieces: 3 new, 0 reused");
  await page.keyboard.press("Enter");
  await page.keyboard.up(precisionKey);
  expect((await snapshot(page)).pieces).toBe(8);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await undoToEmpty(page);
});

test("the keyboard cursor keeps its target while the view follows it, with the mouse resting on the canvas", async ({ page }) => {
  await openDiorama(page);
  const { q, r } = await findDryRun(page, 34, 0.3);
  await lookAtNode(page, q + 4, r, 6);
  const start = await nodeScreen(page, q, r);
  await page.mouse.move(start.x, start.y);
  await page.keyboard.press("1");
  await page.mouse.move(start.x + 1, start.y);
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).phase).toBe("anchored");
  const v0 = await cameraView(page);
  // 30 steps east at 6 ppm (30 px a step) carry the cursor past the 80 px margin, so the camera pans after it.
  // The mouse stays where it is: those pans must not hand the target back to it.
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await cameraView(page)).x).not.toBe(v0.x);
  await page.waitForTimeout(300);
  expect((await snapshot(page)).cursor).toBe(true);
  await expect(page.getByTestId("construction-tooltip")).toContainText("Pieces: 30 new, 0 reused");
  await page.keyboard.press("Enter");
  const s = await snapshot(page);
  expect(s.pieces).toBe(30);
  const ends = await page.evaluate(
    ({ q, r }) => (window.__diorama as unknown as { network(): { nodes: { q: number; r: number; kind: string }[] } }).network().nodes.filter((n) => n.kind === "buffer" && n.r === r).map((n) => n.q - q),
    { q, r },
  );
  expect(ends.sort((a, b) => a - b)).toEqual([0, 30]);
  // A real pointer move takes the target back.
  expect((await snapshot(page)).cursor).toBe(true);
  await page.mouse.move(start.x + 40, start.y + 20, { steps: 4 });
  expect((await snapshot(page)).cursor).toBe(false);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await undoToEmpty(page);
});

test("the end-height tag and the cursor's tooltip follow the camera, and rest with it", async ({ page }) => {
  await openDiorama(page);
  const { q, r } = await findDryRun(page, 8, 0.3);
  await lookAtNode(page, q + 4, r, 6);
  const start = await nodeScreen(page, q, r);
  await page.mouse.move(start.x, start.y);
  await page.keyboard.press("1");
  await page.mouse.move(start.x + 1, start.y);
  await page.keyboard.press("Enter");
  // The keyboard cursor holds the plan (so a pan re-plans nothing); six steps up make the ghost elevated.
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 6; i++) await page.keyboard.press("PageUp");
  const tag = page.locator(".ghost-height-tag").nth(1);
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText("+6 m");
  const tagAt = () => tag.evaluate((el) => el.style.transform);
  const tipAt = () => page.evaluate(() => document.querySelector<HTMLElement>("#hud")?.style.getPropertyValue("--hud-pointer-x") ?? "");
  const tag0 = await tagAt();
  const tip0 = await tipAt();
  // WASD pans in Track too.
  await page.keyboard.down("d");
  await page.waitForTimeout(300);
  await page.keyboard.up("d");
  await expect.poll(tagAt).not.toBe(tag0);
  await expect.poll(tipAt).not.toBe(tip0);
  expect((await snapshot(page)).cursor).toBe(true);
  // Once the camera rests (the pan eases out), so do they.
  let last = "";
  await expect
    .poll(async () => {
      const v = await cameraView(page);
      const now = `${v.x},${v.z}`;
      const settled = now === last;
      last = now;
      return settled;
    }, { intervals: [200] })
    .toBe(true);
  const tag1 = await tagAt();
  const tip1 = await tipAt();
  await page.waitForTimeout(300);
  expect(await tagAt()).toBe(tag1);
  expect(await tipAt()).toBe(tip1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).pieces).toBe(0);
});

test("Enter reaches the track tool after the toolbar was used, and Tab + Enter still works on the toolbar", async ({ page }) => {
  await openDiorama(page);
  const { q, r } = await findDryRun(page, 8, 0.3);
  await lookAtNode(page, q + 4, r, 6);
  // Keyboard: focus Track and press Enter, move the cursor with the arrows, then Enter starts and Enter commits.
  const trackButton = page.getByRole("button", { name: /^Track/ });
  await trackButton.focus();
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).tool).toBe("track");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  let s = await snapshot(page);
  expect(s.tool).toBe("track");
  expect(s.phase).toBe("anchored");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).pieces).toBe(4);
  // A button reached with Tab (focus moved, the cursor not used since) keeps its own Enter.
  await page.getByRole("button", { name: "Undo" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toContainText("Undone: removed 4 pieces");
  s = await snapshot(page);
  expect(s.pieces).toBe(0);
  expect(s.tool).toBe("track");
  // Pointer: clicking Track leaves focus where it was, so Enter starts a track at the node under the mouse.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).tool).toBe("select");
  await trackButton.click();
  expect((await snapshot(page)).tool).toBe("track");
  const at = await nodeScreen(page, q, r);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.keyboard.press("Enter");
  s = await snapshot(page);
  expect(s.tool).toBe("track");
  expect(s.phase).toBe("anchored");
});

test("builds a closed loop by dragging, then undoes back to an empty network", async ({ page }) => {
  // Needs the full planner (merged from codex/d3-planner): four chained legs, each a one-bend
  // curve turning left 90°, and a last drag that magnetism snaps into the start's port with a
  // two-bend fit, closing the loop into one closed section. Offsets are metres east and north
  // of the start; the planner snaps each click to the reachable node nearest the pointer.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDiorama(page);
  const { q, r } = await findDryRun(page, 40, 0.2);
  const centre = nodeAtOffset(q, r, 90, 120);
  await lookAtNode(page, centre[0], centre[1], 2.5);
  await page.keyboard.press("1");
  const [b, ...corners] = ([
    [180, 0],
    [300, 120],
    [180, 240],
    [-120, 120],
  ] as const).map(([dx, dy]) => nodeAtOffset(q, r, dx, dy));
  if (!b) throw new Error("no first corner");
  const start = await nodeScreen(page, q, r);
  await dragBetween(page, start, await nodeScreen(page, b[0], b[1]), 20);
  let s = await snapshot(page);
  expect(s.pieces).toBeGreaterThan(0);
  expect(s.phase).toBe("anchored");
  for (const [cq, cr] of corners) {
    const p = await nodeScreen(page, cq, cr);
    await page.mouse.move(p.x, p.y, { steps: 10 });
    await page.mouse.click(p.x, p.y);
    expect((await snapshot(page)).phase).toBe("anchored");
  }
  // Back to the start: the planner snaps into its port, and after joining the chain ends.
  await page.mouse.move(start.x, start.y, { steps: 10 });
  await page.mouse.click(start.x, start.y);
  s = await snapshot(page);
  expect(s.closedSections).toBe(1);
  expect(s.phase).toBe("idle");
  expect(s.pieces).toBeGreaterThan(40);
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).tool).toBe("select");
  const undos = await undoToEmpty(page);
  expect(undos).toBe(5);
  expect(errors).toEqual([]);
});

test("camera gestures still reach the camera first: wheel zoom, right-drag pan, Q/E, arrows in Select only", async ({ page }) => {
  await openDiorama(page);
  const view = () =>
    page.evaluate(() => {
      const c = (window.__diorama as unknown as { camera: { ppm: number; yawStep: number; target: { x: number; z: number } } }).camera;
      return { ppm: c.ppm, yawStep: c.yawStep, x: c.target.x, z: c.target.z };
    });
  const v0 = await view();
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await view()).ppm).toBeGreaterThan(v0.ppm);
  // Right drag pans in every tool, including Track.
  await page.keyboard.press("1");
  const v1 = await view();
  await page.mouse.move(640, 400);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(540, 350, { steps: 5 });
  await page.mouse.up({ button: "right" });
  const v2 = await view();
  expect(Math.hypot(v2.x - v1.x, v2.z - v1.z)).toBeGreaterThan(5);
  expect((await snapshot(page)).pieces).toBe(0);
  // In Track the arrows drive the lattice cursor, not the camera.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const v3 = await view();
  expect([v3.x, v3.z]).toEqual([v2.x, v2.z]);
  // Shift+wheel steps the height in Track instead of zooming.
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Shift");
  expect((await view()).ppm).toBe(v3.ppm);
  // Back in Select, Q rotates and the arrows pan.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).tool).toBe("select");
  await page.keyboard.press("q");
  await expect.poll(async () => (await view()).yawStep).toBe((v3.yawStep + 5) % 6);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  const v4 = await view();
  expect(Math.hypot(v4.x - v3.x, v4.z - v3.z)).toBeGreaterThan(5);
});
