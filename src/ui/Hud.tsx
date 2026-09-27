import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { HudActions, HudState, HudStore, HudTooltip } from "./store";

/**
 * The React HUD (architecture "UI (HUD)", ADR 0009): the construction
 * tooltip, the toast, the aria-live status line and a minimal bottom
 * toolbar (Track and undo/redo; later slices add the other tools). It
 * renders only when the store publishes, never per frame.
 *
 * Colours come from `palette.ts` as CSS custom properties the app sets on
 * the mount (`--hud-parchment`, `--hud-border`, `--hud-ink`, `--hud-brass`,
 * `--hud-green`, `--hud-amber`, `--hud-red`); this layer holds no colour
 * literal. The tooltip follows `--hud-pointer-x/y`, which the app sets on
 * the mount directly, so moving the pointer never re-renders React.
 */

function useHud<T>(store: HudStore, select: (s: HudState) => T): T {
  const read = (): T => select(store.getSnapshot());
  // The same reader serves server rendering (markup tests), so the HUD renders without a DOM too.
  return useSyncExternalStore(store.subscribe, read, read);
}

const CSS = /* css */ `
.hud-panel {
  background: var(--hud-parchment);
  color: var(--hud-ink);
  border: 1px solid var(--hud-border);
  border-radius: 6px;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--hud-ink) 22%, transparent);
  font: 13px/1.45 system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
}
.hud-tooltip {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 12;
  width: max-content;
  max-width: min(460px, calc(100vw - 16px));
  padding: 6px 10px;
  pointer-events: none;
  transform: translate(
    min(calc(var(--hud-pointer-x, 0px) + 18px), calc(100vw - 100% - 8px)),
    min(calc(var(--hud-pointer-y, 0px) + 20px), calc(100vh - 100% - 72px))
  );
}
.hud-tooltip .line { overflow-wrap: anywhere; }
.hud-tooltip .counts { font-weight: 600; }
.hud-tooltip .hint { opacity: 0.72; font-size: 12px; }
.hud-tooltip .precision { font-weight: 600; }
.hud-tooltip .invalid { font-weight: 600; margin-top: 2px; }
.hud-tooltip .invalid::before {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--hud-red);
  vertical-align: 0;
}
.hud-grade {
  padding: 0 4px;
  border-radius: 3px;
  border: 1px solid var(--grade);
  background: color-mix(in srgb, var(--grade) 24%, transparent);
  font-weight: 600;
}
.hud-grade[data-level="green"] { --grade: var(--hud-green); }
.hud-grade[data-level="amber"] { --grade: var(--hud-amber); }
.hud-grade[data-level="red"] { --grade: var(--hud-red); }
.hud-toolbar {
  position: fixed;
  left: 50%;
  bottom: 14px;
  z-index: 11;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 4px;
}
.hud-toolbar button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 5px 12px;
  cursor: pointer;
}
.hud-toolbar button:hover:not(:disabled) { border-color: var(--hud-border); }
.hud-toolbar button:focus-visible { outline: 2px solid var(--hud-brass); outline-offset: 1px; }
.hud-toolbar button[aria-pressed="true"] {
  border-color: var(--hud-brass);
  background: color-mix(in srgb, var(--hud-brass) 18%, transparent);
  font-weight: 600;
}
.hud-toolbar button:disabled { opacity: 0.45; cursor: default; }
.hud-toolbar .sep { width: 1px; margin: 4px 2px; background: var(--hud-border); }
.hud-toolbar kbd { font: inherit; font-size: 11px; opacity: 0.7; margin-left: 6px; }
.hud-toast {
  position: fixed;
  left: 50%;
  bottom: 70px;
  z-index: 13;
  transform: translateX(-50%);
  padding: 6px 14px;
  animation: hud-toast 2.6s ease-out forwards;
  pointer-events: none;
}
.hud-toast[data-tone="warn"] { border-color: var(--hud-red); }
@keyframes hud-toast {
  0% { opacity: 0; transform: translate(-50%, 6px); }
  8% { opacity: 1; transform: translate(-50%, 0); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .hud-toast { animation: none; }
}
.hud-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`;

export function Tooltip({ store }: { readonly store: HudStore }) {
  const tip = useHud(store, (s) => s.tooltip);
  if (!tip) return null;
  return <TooltipPanel tip={tip} />;
}

export function TooltipPanel({ tip }: { readonly tip: HudTooltip }) {
  const m = tip.metrics;
  return (
    <div className="hud-panel hud-tooltip" data-testid="construction-tooltip" aria-hidden="true">
      <div className="line counts">{tip.counts}</div>
      {m && (
        <div className="line metrics">
          {m.length} ·{" "}
          <span className="hud-grade" data-level={m.gradeLevel}>
            {m.grade}
          </span>{" "}
          · {m.minRadius} · {m.endHeight}
        </div>
      )}
      {tip.note && <div className="line note">{tip.note}</div>}
      {tip.invalid && <div className="line invalid">Can't build: {tip.invalid.reason}</div>}
      {tip.invalid?.fix && <div className="line fix">{tip.invalid.fix}</div>}
      {tip.precision && <div className="line precision">{tip.precision}</div>}
      <div className="line hint">{tip.hint}</div>
    </div>
  );
}

export function Toast({ store }: { readonly store: HudStore }) {
  const toast = useHud(store, (s) => s.toast);
  // The live region stays mounted so screen readers pick up each new toast.
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {toast && (
        <div key={toast.id} className="hud-panel hud-toast" data-tone={toast.tone} data-testid="toast">
          {toast.text}
        </div>
      )}
    </div>
  );
}

export function StatusLine({ store }: { readonly store: HudStore }) {
  const status = useHud(store, (s) => s.status);
  return (
    <div className="hud-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="status-line">
      {status}
    </div>
  );
}

export function Toolbar({ store, actions }: { readonly store: HudStore; readonly actions: HudActions }) {
  const tool = useHud(store, (s) => s.tool);
  const canUndo = useHud(store, (s) => s.canUndo);
  const canRedo = useHud(store, (s) => s.canRedo);
  const track = tool === "track";
  return (
    <div className="hud-panel hud-toolbar" role="toolbar" aria-label="Construction">
      <button
        type="button"
        aria-pressed={track}
        aria-keyshortcuts="1"
        title="Track (1); Esc returns to Select"
        onClick={() => actions.selectTool(track ? "select" : "track")}
      >
        Track<kbd>1</kbd>
      </button>
      <span className="sep" aria-hidden="true" />
      <button type="button" disabled={!canUndo} aria-keyshortcuts="Control+Z Meta+Z" title="Undo (Ctrl/Cmd+Z)" onClick={() => actions.undo()}>
        Undo
      </button>
      <button
        type="button"
        disabled={!canRedo}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
        onClick={() => actions.redo()}
      >
        Redo
      </button>
    </div>
  );
}

export function Hud({ store, actions }: { readonly store: HudStore; readonly actions: HudActions }) {
  return (
    <>
      <style>{CSS}</style>
      <Tooltip store={store} />
      <Toast store={store} />
      <StatusLine store={store} />
      <Toolbar store={store} actions={actions} />
    </>
  );
}

/** Mounts the HUD at `element` (`#hud`); returns the unmount. */
export function mountHud(element: HTMLElement, store: HudStore, actions: HudActions): () => void {
  const root = createRoot(element);
  root.render(<Hud store={store} actions={actions} />);
  return () => root.unmount();
}
