import { expect, test } from "@playwright/test";
import { dragBetween, findDryRun, lookAtNode, nodeScreen, openDiorama, snapshot, undoToEmpty } from "./hook";

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

test.fixme("builds a closed loop by dragging, then undoes back to an empty network", async ({ page }) => {
  // enable after merging codex/d3-planner
  // The straight-only stub cannot bend, so it cannot close a loop. With the full planner, four
  // chained drags round a square lay one-bend fits, and the last drag ends on the start node's
  // port (a two-bend fit), closing the loop into a single closed section.
  await openDiorama(page);
  const { q, r } = await findDryRun(page, 40, 0.2);
  await lookAtNode(page, q + 20, r + 12, 2.5);
  await page.keyboard.press("1");
  const corners: [number, number][] = [
    [q + 40, r],
    [q + 20, r + 40],
    [q - 20, r + 40],
  ];
  const origin = await nodeScreen(page, q, r);
  const first = corners[0];
  if (!first) throw new Error("no corners");
  await dragBetween(page, origin, await nodeScreen(page, first[0], first[1]));
  for (const [cq, cr] of corners.slice(1)) {
    const p = await nodeScreen(page, cq, cr);
    await page.mouse.move(p.x, p.y, { steps: 10 });
    await page.mouse.click(p.x, p.y);
  }
  // Back into the start node's port: magnetism snaps within 3 nodes.
  await page.mouse.move(origin.x, origin.y, { steps: 10 });
  await page.mouse.click(origin.x, origin.y);
  const s = await snapshot(page);
  expect(s.pieces).toBeGreaterThan(8);
  expect(s.closedSections).toBe(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await undoToEmpty(page);
});
