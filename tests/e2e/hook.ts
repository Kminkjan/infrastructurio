import { type Page, expect } from "@playwright/test";

/**
 * The dev-and-test projection hook (`window.__diorama`, present only in Vite
 * dev builds; see src/app/main.ts). Specs drive the real pointer and keyboard
 * and use the hook only to find where lattice nodes are drawn and to read
 * back the network: never to inject state.
 */

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface HookSnapshot {
  readonly pieces: number;
  readonly rev: number;
  readonly closedSections: number;
  readonly tool: string;
  readonly phase: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly toast: string | null;
  readonly status: string;
}

interface DioramaHook {
  readonly ready: boolean;
  lookAtNode(q: number, r: number, ppm: number): void;
  nodeScreen(q: number, r: number, zMm?: number): ScreenPoint;
  network(): { readonly rev: number; readonly pieces: readonly unknown[]; readonly sections: readonly { readonly closed: boolean }[] };
  tool(): { readonly active: string; readonly phase: string };
  hud(): { readonly canUndo: boolean; readonly canRedo: boolean; readonly toast: { readonly text: string } | null; readonly status: string };
  previewStats(): { readonly calls: number; readonly p95Ms: number; readonly maxMs: number; readonly memoHits: number; readonly memoMisses: number };
  readonly terrain: { readonly columns: number; readonly rows: number; readonly water: Uint8Array };
}

declare global {
  interface Window {
    __diorama?: DioramaHook;
  }
}

export async function openDiorama(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__diorama?.ready === true, undefined, { timeout: 60_000 });
}

export async function snapshot(page: Page): Promise<HookSnapshot> {
  return page.evaluate(() => {
    const h = window.__diorama;
    if (!h) throw new Error("no __diorama hook (not a dev build?)");
    const n = h.network();
    const hud = h.hud();
    const tool = h.tool();
    return {
      pieces: n.pieces.length,
      rev: n.rev,
      closedSections: n.sections.filter((s) => s.closed).length,
      tool: tool.active,
      phase: tool.phase,
      canUndo: hud.canUndo,
      canRedo: hud.canRedo,
      toast: hud.toast?.text ?? null,
      status: hud.status,
    };
  });
}

/**
 * A dry run of `length` + 1 nodes along heading 0 (east), about a quarter of
 * the way up the map, away from the river (≈ 46 %) and the lake.
 */
export async function findDryRun(page: Page, length: number, rowFraction = 0.25): Promise<{ q: number; r: number }> {
  return page.evaluate(
    ({ length, rowFraction }) => {
      const t = window.__diorama?.terrain;
      if (!t) throw new Error("no terrain");
      for (let dr = 0; dr < t.rows / 4; dr++) {
        const r = Math.round(t.rows * rowFraction) + dr;
        let run = 0;
        for (let col = Math.round(t.columns * 0.3); col < t.columns * 0.8; col++) {
          run = t.water[r * t.columns + col] ? 0 : run + 1;
          if (run > length + 2) {
            const startCol = col - length - 1;
            return { q: startCol - Math.floor(r / 2), r };
          }
        }
      }
      throw new Error("no dry run found");
    },
    { length, rowFraction },
  );
}

/** The lattice node nearest (q0, r0) moved by (dx east, dy north) metres (a = 5 m, rows 4.33 m apart). */
export function nodeAtOffset(q0: number, r0: number, dx: number, dy: number): [number, number] {
  const rowM = 2.5 * 1.7320508075688772;
  const x = 5 * (q0 + r0 / 2) + dx;
  const y = rowM * r0 + dy;
  const r = Math.round(y / rowM);
  return [Math.round(x / 5 - r / 2), r];
}

export async function nodeScreen(page: Page, q: number, r: number, zMm?: number): Promise<ScreenPoint> {
  return page.evaluate(({ q, r, zMm }) => {
    const h = window.__diorama;
    if (!h) throw new Error("no hook");
    return h.nodeScreen(q, r, zMm ?? undefined);
  }, { q, r, zMm: zMm ?? null });
}

export async function lookAtNode(page: Page, q: number, r: number, ppm: number): Promise<void> {
  await page.evaluate(({ q, r, ppm }) => window.__diorama?.lookAtNode(q, r, ppm), { q, r, ppm });
  // Let the scheduler render the new view before reading screen positions.
  await page.waitForTimeout(150);
}

/** Drags the real pointer from one node to another in small steps. */
export async function dragBetween(page: Page, from: ScreenPoint, to: ScreenPoint, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Undo with the keyboard until the network is empty; returns how many undos it took. */
export async function undoToEmpty(page: Page, limit = 40): Promise<number> {
  let undos = 0;
  while ((await snapshot(page)).pieces > 0 && undos < limit) {
    await page.keyboard.press("Control+z");
    undos += 1;
  }
  expect((await snapshot(page)).pieces).toBe(0);
  return undos;
}
