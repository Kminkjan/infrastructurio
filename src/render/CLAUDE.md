# src/render — imperative Three.js presentation

Status 2026-09-26: `coords.ts`, `camera/`, `core/`, `terrain/` and `art/` (+ tests) exist
(D1: slices R0–R1); D11a adds `scenery/`, `labels/`, `camera/bookmarks.ts` and the
art pipeline (`AssetRegistry`, `materials`, shader chunks, vignette, tweak panel) for the
static diorama (R3; Look Gate A held 2026-09-26, partial: legibility pending). Status 2026-09-27, D3 branch
`codex/d3-construction-tool`: `track/` (track meshes behind `TrackBatch`, the ghost, rejection
highlight, undo flash, snap ring), `picking/trackPicker.ts`, three track materials and the
`trackStripe` chunk (R2, R4 presentation); `CameraController` attaches no listeners, since
`src/app/InputRouter.ts` owns input and offers gestures to the camera first. `src/app/main.ts`
wires them. ADR 0009 (**Accepted**, owner, 2026-09-26)
fixes the renderer, camera, coordinate convention, render-on-demand and React outside the
frame loop; ADR 0013 (art pipeline) is Proposed. `three` is pinned at 0.185.1 (r185).
Targets: [art direction](../../docs/art-direction.md), [architecture](../../docs/architecture.md).
The critical rules below stand alone; repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

## Authority

- **Read snapshots only; never mutate core.** Inputs are `NetworkView` (per `networkRev`) and
  `FrameView` (per tick) from `core/sim/api.ts`. Never write to their objects or typed arrays,
  and never decide connectivity, routes, aspects or occupancy.
- **Presentation state** (camera, hover, selection, ghost, overlay toggles, preset, particles)
  never enters commands, sim state or saves.
- **Picks leave render as sim identities** (piece key, node (q, r, z), signal, train ID),
  never Three object IDs. Tools turn picks into commands; `src/app` executes them.
- **Interpolate, never extrapolate:** `lerp(prevHeadMm, headMm, alpha)` along arc length,
  alpha = acc/100 clamped at 1, so a train never visibly overshoots a red signal.
- **Imports:** `three` (and `three/addons/…`), `core/sim/api.ts` types, and the pure
  `core/geometry/sample.ts`, the single source of curve maths (never re-derive arcs here).
  **Never `src/ui`**, and no other core module (both enforced by `tests/architecture.test.ts`,
  the core limit since D3): if you need another core helper, re-export it through `sim/api.ts`.
- **React stays outside the frame loop:** publish to UI stores on change, never per frame.

## Single sources

- **`coords.ts` holds only the sim ↔ world conversion:** sim ENU (x east, y north, z up) →
  three (x, z, −y), determinant +1 (tested). Never swap axes inline or use a negative scale;
  the legacy harness's (x, z, y) swap mirrored the scene.
- **`art/palette.ts` holds only colours and is the only colour source:** no colour literals
  elsewhere in `src/render`, `src/ui` or `src/app` (enforced by `tests/architecture.test.ts`
  since D11a). Add a colour there under its group, and update
  [art direction](../../docs/art-direction.md) in the same PR. `index.html`'s first-paint
  background `#dcdccb` duplicates `palette.haze`: keep them equal.
- **Camera constants** follow ADR 0009: one pitch constant (true isometric 35.264°, so the
  look gate can A/B 30°), yaw k·60°, zoom 0.75–24 ppm, frustum halfW = cssW/(2·ppm).

## Geometry, winding and materials

- **`FrontSide` only;** never `DoubleSide` to hide a winding bug. Every procedural generator
  gets a test that each triangle's winding agrees with its normal. Winding oracle: the
  projected (origin, east, north) triangle is counter-clockwise on screen for all 6 yaws.
- Asset model space: +Y up, metres, origin at ground contact, forward +X.
- Arcs are sampled through `geometry/sample.ts` at Δθ = min(2·acos(1 − 0.02/r), 5°).
- `MeshLambertMaterial` plus vertex and instance colours, about 12 shared materials; shader
  tweaks only as isolated `onBeforeCompile` modules in `art/`. Shadows use `PCFShadowMap`
  (`PCFSoftShadowMap` is deprecated in r185). **The base look must work without
  post-processing;** post passes are lazy-loaded High-preset extras.

## Frame loop

- **Render on demand:** `FrameScheduler.requestFrame(reason)` for one frame,
  `setContinuous(reason)` for `sim-running`, `camera-anim`, `ambient` (30 fps; off under
  reduced motion or power saver) and `particles-alive`. Every request names a reason; no
  other `requestAnimationFrame` loop. Stop when the page is hidden; idle means zero frames.
- **Order per frame:** input → tools (memoized preview) → fixed-step sim → static diffs by
  revision (time-sliced when > 8 ms) → interpolate trains → particles → camera, then shadow
  fit → dirty overlays → render (labels only on change) → perf sample.
- **No allocations in the loop:** preallocate scratch `Vector3`/`Matrix4`/`Color` at module
  scope; no `new`, closures, array or object literals, spreads or template strings per frame.

## GPU resources

- **Instance and batch:** `InstancedMesh` per vehicle or tree type; track as three
  `BatchedMesh`es (ballast, sleepers, rails) behind a `TrackBatch` interface, with a
  chunk-merged fallback when multi-draw is missing (`?trackBatch=chunked` forces it for checks).
  Track geometry is baked per piece in world space, keyed by canonical piece key.
- **Overlay geometry that changes** (ghost, highlight, flash, drop lines) gets a fresh
  `BufferGeometry` per change and the old one disposed: three frees GPU buffers on geometry
  disposal, not when an attribute is swapped.
- **After moving instances,** set `instanceMatrix.needsUpdate = true` and call
  `computeBoundingSphere()` (and `computeBoundingBox()` if used): stale bounds cull or
  mis-pick them.
- **Dispose everything you create:** geometries, materials, textures, render targets,
  composer passes, listeners, `ResizeObserver`s and `matchMedia` handlers.
  `renderer.info.memory` must return to baseline after edit/undo cycles. On context loss,
  rebuild from snapshots.
- **Budgets** (frame time, draw calls, rebuild, leaks, bundle size) are authoritative only
  in the [acceptance gates](../../docs/evidence/m4/2026-09-26-acceptance-gates.md). Watch
  `renderer.info.render` and the F3 `PerfMonitor` while developing, but never cite those
  numbers against the gates; only the D13 runs count.

## Picking

In order: (1) screen-space handles within 14 px (drawn at 6–8 px); (2) proxy raycast in a
never-rendered `pickScene` with layer bits TERRAIN, TRACK, DECK, TUNNEL, SIGNAL, STATION,
DEPOT, TRAIN, filtered by the active tool; (3) track centreline within 10 px; (4) analytic
heightfield ray march. Never raycast the visual meshes. D3 (`picking/trackPicker.ts`) does
existing nodes within 14 px, then (3) and (4), measuring on screen at track height so elevated
track picks where it is drawn; handles and the proxy scene arrive with R5.
- **Occlusion aids are required:** H hides decks, U gives an underground x-ray, C cycles
  stacked hits, and an EntityList offers keyboard targets. ADR 0004's lesson: depth alone
  didn't solve occluded picking; a layer filter plus a keyboard list did.

## Testing

- **WebGL can't run in Node** (Vitest has no DOM or WebGL env). Keep the maths in pure
  helpers (iso camera, coords, winding, arc sampling, LOD bands, picking, colouring) and
  unit-test them; `three` maths classes work in Node (`coords.test.ts`). Keep WebGL-touching
  classes thin.
- **Verify visuals manually** with `npm run dev`, naming zoom levels, yaws, preset and what you
  did, or say you didn't. Playwright e2e is **agent** evidence. Look Gates A and B are the
  owner's: never present your own visual judgement as meeting them.
- Before pushing: `npm test`, `npm run typecheck` and `npm run build`; the full definition of
  done is in the root CLAUDE.md.

## Originality

Mighty Tiny Railways is a mood reference only. Never copy its assets, names, UI layouts, icons
or screenshots, never commit captures of it, and never sample colours from it. Forms and
palette come from public-domain 1900 Baltic sources (Library of Congress Photochrom prints,
Levitan and Čiurlionis landscapes, period railway photographs). Originality is scored at
Look Gate A.
