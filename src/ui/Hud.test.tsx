import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Hud, TooltipPanel } from "./Hud";
import { type HudTooltip, INITIAL_HUD_STATE, createHudStore } from "./store";

const tip: HudTooltip = {
  counts: "Pieces: 8 new, 2 reused",
  metrics: { length: "Length 214 m", grade: "Grade 1.2 %", gradeLevel: "green", minRadius: "Min radius 180 m", endHeight: "End height +6 m" },
  note: null,
  invalid: null,
  precision: null,
  hint: "Hold Ctrl (⌥ on Mac) for precision · [ ] change height",
};

describe("HUD store", () => {
  it("keeps the same snapshot until a value changes, and publishes only then", () => {
    const store = createHudStore();
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    const first = store.getSnapshot();
    expect(first).toBe(INITIAL_HUD_STATE);
    store.set({ tool: "select", canUndo: false });
    expect(store.getSnapshot()).toBe(first);
    expect(calls).toBe(0);
    store.set({ tool: "track" });
    expect(store.getSnapshot()).not.toBe(first);
    expect(store.getSnapshot().tool).toBe("track");
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    expect(calls).toBe(1);
    store.set({ tooltip: null });
    expect(calls).toBe(1);
    off();
    store.set({ canUndo: true });
    expect(calls).toBe(1);
  });
});

describe("HUD markup", () => {
  it("renders the tooltip's three lines with the grade coloured by band", () => {
    const html = renderToStaticMarkup(<TooltipPanel tip={tip} />);
    expect(html).toContain("Pieces: 8 new, 2 reused");
    expect(html).toContain('<span class="hud-grade" data-level="green">Grade 1.2 %</span>');
    expect(html.replace(/<[^>]+>/g, "")).toContain("Length 214 m · Grade 1.2 % · Min radius 180 m · End height +6 m");
    expect(html).toContain("Hold Ctrl (⌥ on Mac) for precision · [ ] change height");
  });

  it("adds \"Can't build\" with the fix for an invalid plan", () => {
    const html = renderToStaticMarkup(<TooltipPanel tip={{ ...tip, invalid: { reason: "Tracks come 2.10 m apart", fix: "Move the tracks apart." } }} />);
    expect(html).toContain("Can&#x27;t build: Tracks come 2.10 m apart");
    expect(html).toContain("Move the tracks apart.");
  });

  it("renders the toolbar with Track pressed, undo/redo availability and an aria-live status line", () => {
    const store = createHudStore({ ...INITIAL_HUD_STATE, tool: "track", canUndo: true, status: "Pieces: 4 new, 0 reused" });
    const html = renderToStaticMarkup(<Hud store={store} actions={{ selectTool: () => {}, undo: () => {}, redo: () => {} }} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/<button[^>]*title="Undo[^"]*"[^>]*>Undo<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Redo/);
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true" data-testid="status-line">Pieces: 4 new, 0 reused<');
    // No colour literal reaches the markup: the palette arrives as CSS custom properties.
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it("offers Track and Straight line with their keys, presses the active one, and names the occlusion aids in effect", () => {
    // Straight line (5) replaced Bridge (5) and Tunnel (6): owner decision 2026-09-28, "One 'Straight line' tool".
    const store = createHudStore({ ...INITIAL_HUD_STATE, tool: "straight", views: { decksHidden: true, xray: true } });
    const html = renderToStaticMarkup(<Hud store={store} actions={{ selectTool: () => {}, undo: () => {}, redo: () => {} }} />);
    const buttons = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*aria-keyshortcuts="(\d)"[^>]*>([A-Za-z]+)<kbd>/g)].map((m) => [m[3], m[2], m[1]]);
    expect(buttons).toEqual([
      ["Track", "1", "false"],
      ["Straight", "5", "true"],
    ]);
    expect(html).toContain('title="Straight line (5): one steady grade from start to end; bridges and tunnels as needed"');
    expect(html).toContain('data-testid="view-chip" aria-hidden="true">Decks hidden (H) · Underground x-ray (U)<');
    const plain = renderToStaticMarkup(<Hud store={createHudStore()} actions={{ selectTool: () => {}, undo: () => {}, redo: () => {} }} />);
    expect(plain).not.toContain("view-chip");
  });

  it("adds the structure line under the counts when the plan is not all ground", () => {
    const html = renderToStaticMarkup(<TooltipPanel tip={{ ...tip, structure: "Structure: bridge" }} />);
    expect(html).toContain('<div class="line counts">Pieces: 8 new, 2 reused</div><div class="line structure">Structure: bridge</div>');
    expect(renderToStaticMarkup(<TooltipPanel tip={tip} />)).not.toContain("line structure");
  });

  it("adds the held-end line under the metrics when the 3.5 % limit holds a Straight line's end", () => {
    const held = "End held 11.2 m below the ground by the 3.5 % limit";
    const html = renderToStaticMarkup(<TooltipPanel tip={{ ...tip, held }} />);
    expect(html).toMatch(new RegExp(`End height \\+6 m</div><div class="line held">${held}</div>`));
    expect(renderToStaticMarkup(<TooltipPanel tip={tip} />)).not.toContain("line held");
  });
});
