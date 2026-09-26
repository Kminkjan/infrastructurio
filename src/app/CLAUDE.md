# src/app — legacy M0–M2 React shell (Millford app)

This directory holds one component file (`App.tsx`) and one global stylesheet (`app.css`). It is legacy and unchanged since M2. The M4 construction UI lives in `src/experimental/construction`.

- **Dispatch pattern:** `App` holds a mutable `Simulation` in `useState` plus the latest frozen snapshot. Every action is `setSnapshot(simulation.dispatch(cmd))` inside an **event handler**.
  - Never dispatch during render or inside a `setState` updater. StrictMode double-invokes both, which would advance time or build roads twice.
- **Time:** it moves only through "Advance one day" (`advance`, 24 ticks; ticks are hours). There is no rAF, interval, pause or speed control. Never drive the simulation from the Pixi ticker. New code uses `TICKS_PER_DAY` from `../shared`; existing code hard-codes `24`.
- **Reset:** `reset` restores the current Simulation's initial state. After Load or Import, that is the loaded save.
  - To reset to tick 0 regardless, swap in `createSimulation(seed)` through the same path as `useLoadedSimulation`. Don't change the `reset` command in `src/simulation`.
  - The default seed is `SCENARIO_SEED = "millford-valley-foundation"`, but an imported save may carry another seed. Ask which world is meant.
- **WorldView:** the renderer is created once, in a `[]` effect guarded by a `disposed` flag.
  - Props and callbacks reach it through refs, so it always calls the latest closures (`buildRoadClass`, the simulation after a load).
  - Don't add effect deps or pass handlers into `createWorldRenderer` directly.
- **Inspectors:**
  - The freight, development and bottleneck panels re-derive from the live snapshot by `selection.id`, and only format values. Never recompute economics or routing in React.
  - The heading, kind and description come from the renderer's click-time `MapSelection` and go stale (a road still reads "arterial road" after Upgrade).
  - React's `setSelection(undefined)` doesn't clear the map highlight.
- **Saves:** "Save local" writes IndexedDB `infrastructurio`/`saved-games`/`m0-scenario`, which is shared with the unmerged M3 v9 build. Never point these buttons at another format (`src/persistence/CLAUDE.md`).
- **CSS:** one global `app.css`: kebab-case semantic classes, literal colours, no custom properties. State is styled via `[aria-pressed]`, `[hidden]` and the canvas classes `world-renderer.ts` toggles.
- **Tests:** there is no DOM test env, and `App.tsx` has no tests. Put testable logic in pure modules. Verify UI with `npm run dev` (open the exact URL it prints), and say what you exercised.
