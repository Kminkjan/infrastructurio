# src/rendering — legacy M0–M2 PixiJS presentation

This is the legacy reuse base, unchanged since M2 (`85bd341`).
- M4 construction lives in `src/experimental/construction` (SVG, `/construction.html`, ADR 0007). Never extend `WorldRenderer` for curves, lanes or elevation.
- ADR 0004 keeps the Pixi plan view as a *research* reference only; the production renderer (#26) is open. No renderer migration or broad refactor without an ADR.

## Hash pins: do not edit `map-camera.ts` or bump Pixi
- `map-camera.ts`'s SHA-256 is pinned in `docs/research/m4/rendering/results-v2.json`. The v2 verifier hashes the **live** file, and `experiments/m4/rendering/pixi-view.mjs` imports `fitCamera` from it.
  - Any byte change, even formatting, fails `npm run test:m4`. Put new camera helpers in a new module.
- Upgrading `pixi.js`, or changing any dependency, rewrites the equally pinned `package-lock.json`.
- Both changes need the owner-approved archive-and-reroute route (`experiments/m4/CLAUDE.md`).
- **Camera math:** screen = world·scale + (x, y), Y down, world = map units (960×620). Minimum scale = fit with 32 px padding per side; maximum = 8× fit.

## Authority (ADR 0002)
- **I/O:** input is `SimulationSnapshot`. Outputs are drawing plus `onSelectionChange`, `onBuildRoad` and `onRemoveRoad`. The renderer emits only `build-road` (with snapped points) and `remove-road`.
- **Never:** mutate the frozen snapshot objects, own connectivity, or decide economics, routing or bottlenecks.
- **Presentation-only state:** camera, selection, tool, drag preview and truck animation. They never enter commands, simulation state or saves.
- **Snapping is load-bearing but not always connection-safe.** The simulation matches places by exact position (`samePoint`, 1e-7) after rounding build points to 0.001.
  - `getRoadSnapAnchors` must return exactly the simulation's terminal and opportunity points. Its fertile-land centroid duplicates `simulation/growth/millford-accessibility.ts` `polygonCenter`, so change both or neither.
  - Segment-projection and intersection-node snaps are *off* the 0.001 grid. After rounding, the new road often misses the target segment and stays disconnected (a 2026-09-26 probe found about half of projection snaps disconnected).
  - Add a connectivity test with any snapping change.

## Representative freight (ADR 0003)
- **What the icons are:** `ceil(shippedTonsPerDay / 20)` icons at a wall-clock 90 map units/s, with a new ID every trip. They decorate an aggregate daily flow; they are not vehicles.
- **Never** derive capacity, occupancy, queues, delay, completions or inspector values from icons, and never feed them back into the simulation.
- Future movement comes from simulation snapshots (stable IDs) with interpolation only.

## `world-renderer.ts` contracts
- **Lifecycle:** an async factory (`await application.init`).
  - Callers guard against unmount before it resolves (`WorldView`'s `disposed` flag; StrictMode double-mounts).
  - `destroy()` removes every listener, ticker callback, renderer event and timer you register. Keep `application.destroy({ removeView: true }, { children: true })`.
- **Redraw gating:** each layer redraws only when its sub-snapshot's reference changes (`renderedX === snapshot.X`).
  - Only `geography` reliably keeps identity.
  - `roadNetwork` is a new object after every 8-tick reassignment (changed flows or not) and after every build, upgrade, remove or reset. So every "Advance one day" rebuilds roads and their hit targets.
  - `development` and `bottlenecks` are new on every dispatch, so they always rebuild. `docs/performance-strategy.md` is stale on both points.
  - Key any new cached layer on a preserved reference or a content key (like the traffic plan's `key`).
- **Layer order**, bottom to top: geography, development, road, analysisOverlay, representativeVehicle, geographyHit (polygons), roadHit, priorityGeographyHit (points, rects), selection, constructionPreview.
  - Pick priority follows hit order: points and the 84×106 crossing rect > roads > fertile-land polygon.
  - So a tap inside the crossing rect selects the crossing in Inspect mode and never reaches a road's remove handler.
- **Non-interactive layers:** selection, constructionPreview, representativeVehicle and analysisOverlay set `eventMode = "none"`. `geographyLayer` is *not* visual-only: its background is the static tap target that clears the selection.
- **Two input systems:**
  - Raw canvas pointer and wheel listeners handle pan, zoom and build drag.
  - Pixi `pointertap` handles select and remove. Pixi's pointerup listens on window in capture phase, so taps fire before our canvas `pointerup`.
  - The two coordinate only via `suppressNextSelection` (a ≥4 px drag, or build pointerdown).
  - The remove branch ignores that flag, so a pan starting on a road probably deletes it. This is inferred from the code, not reproduced. Gate it if you touch input.
- **`snapRoadPoint`:** tolerance is 14 screen px / `camera.scale`, and the nearest candidate wins.
  - Anchors and nodes use `<=` and projections use `<`, so exact ties go to anchors and nodes.
  - A projection is never farther than a junction on the same segment, so the projection usually wins. To prefer junctions, add explicit priority; flipping the operators does nothing.
  - The function is untested inside its closure. Extract it to a pure module with tests before changing it.
- **Selection** is renderer-owned and one-way, with no setter.
  - The emitted `MapSelection` is a copy made at click time, and its name and description are never refreshed.
  - It clears when its ID disappears or when the empty background is tapped in Inspect mode.
- **Cursors:** Pixi writes `canvas.style.cursor` inline, overriding `.road-tool-*` and `.is-dragging` in `app/app.css` (inferred from Pixi's source). Set cursors on Pixi objects instead.
- **CSS contract:** canvas class names are shared with `app.css`, and the background `#15241f` mirrors its `:root`.

## Tests (`npx vitest run src/rendering`)
- **Where logic goes:** keep it in Pixi-free pure modules; there is no DOM test env. `world-renderer.ts` has no tests, so verify Pixi changes manually with `npm run dev`.
- **Header:** line 1 is `// @vitest-environment node`.
- **Fixtures:** `generateMillfordValley("selection-test")`, `createSimulation("millford-valley-foundation")` plus `dispatch`, or tiny hand-built `RoadNetwork`s.
- **Coupling:** expectations embed simulation IDs and labels (e.g. `125% of practical capacity`), so simulation tuning breaks them.
