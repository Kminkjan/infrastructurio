import { expect, test } from "@playwright/test";
import { dragBetween, findDryRun, lookAtNode, nodeAtOffset, nodeScreen, openDiorama, snapshot, undoToEmpty } from "./hook";

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
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await undoToEmpty(page);
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
