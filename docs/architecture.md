# Architecture — rail-first prototype

Status 2026-09-26. This is the target architecture for **M4 — Living Diorama**
([roadmap](../ROADMAP.md), [prototype plan](prototype-plan.md)) and a record of what already
exists. It is a design document, not evidence that any slice works.

**Basis.**
- **Accepted:**
  - [ADR 0002](decisions/0002-separate-simulation-from-presentation.md): the simulation is
    authoritative; commands in, snapshots out.
  - [ADR 0009](decisions/0009-render-isometric-threejs.md), by the owner on 2026-09-26: the
    renderer, camera spec, coordinate convention, render-on-demand, and React outside the
    frame loop.
- **Proposed:** ADRs [0010](decisions/0010-triangular-lattice-track-geometry.md) (lattice),
  [0011](decisions/0011-signalling-and-reservation.md) (signalling),
  [0012](decisions/0012-tick-units-determinism.md) (tick and units),
  [0013](decisions/0013-rendering-and-art-pipeline.md) (art pipeline) and
  [0014](decisions/0014-autonomous-diorama-operator.md) (operator). The sections that rest on
  them describe the plan, not accepted decisions.

**Related docs.**
- [simulation-model.md](simulation-model.md): simulation semantics (validation order,
  signalling, movement, the operator).
- [art-direction.md](art-direction.md): the look.
- [Acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md): budgets and gates.
- [Glossary](glossary.md): the terms.

**Keys.** Slice keys S0–S12 (core) and R0–R7 (render), and tracking keys D1–D13, follow the
[backlog](backlog.md). D1–D13 are GitHub issues
[#65](https://github.com/Kminkjan/infrastructurio/issues/65)–[#77](https://github.com/Kminkjan/infrastructurio/issues/77).

## Principles

1. **The simulation is authoritative.** `src/core` owns all game state. Render and HUD hold
   only derived presentation state, which they can rebuild at any moment from `network()`
   and `frame()`, for example after WebGL context loss.
2. **The core is deterministic.**
   - Units are integers: mm, mm/s, mm/s² and mm node heights (terrain stays Int16 dm; a
     default since 2026-09-26, see the
     [ADR 0010 D2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d2-track-model)).
   - The tick is a fixed 100 ms.
   - The core uses no wall clock, randomness or host APIs, so a command log replays to
     identical checkpoint hashes.
3. **Commands are the player's entire write surface, and they cover infrastructure only.**
   - The `Command` union has no way to buy trains or to set lines, timetables or dispatch.
   - The operator runs inside the core. Players inspect it; they never drive it.
   - A command, API or UI that bypasses this is out of scope in every milestone, not merely
     deferred.
4. **Render on demand.** An idle, paused diorama draws zero frames.
5. **Main thread until measured.** No Web Worker until a predeclared trigger fires (see
   [Workers](#workers)).

## What exists and what is planned

This is an agent reading of the branch on 2026-09-26. **On main** means the file shipped with
the reset skeleton (PR 1, [#60](https://github.com/Kminkjan/infrastructurio/pull/60)).
**D1 branch** means it exists on `codex/d1-lattice-terrain`
([#65](https://github.com/Kminkjan/infrastructurio/issues/65)) and is not merged yet.
**D2 branch** means it exists on `codex/d2-track-model`
([#66](https://github.com/Kminkjan/infrastructurio/issues/66)) and is not merged yet. Each
records that the file is present, not that its tests pass on a given commit: run
`npm run check` for that. **D11a branch** means it exists on `codex/d11a-lookdev`
([#75](https://github.com/Kminkjan/infrastructurio/issues/75)), not merged yet. **D3 core
branch** means it exists on `codex/d3-planner`
([#67](https://github.com/Kminkjan/infrastructurio/issues/67), 2026-09-27), not merged yet.
**D3 render branch** means it exists on `codex/d3-construction-tool` (the render, tools and
UI half of #67, 2026-09-27, with the D3 core branch merged in), not merged yet. Everything
else is planned and lands slice by slice.

| Part | Path | Status | Slice |
|---|---|---|---|
| Boundary test with a negative self-check | [tests/architecture.test.ts](../tests/architecture.test.ts) | **On main** | S0 |
| Core compiler config | [tsconfig.core.json](../tsconfig.core.json) | **On main** | S0 |
| Triangular lattice and its tests | [src/core/lattice.ts](../src/core/lattice.ts) | **On main** | S1 (D1) |
| Sim ↔ world conversion and its tests | [src/render/coords.ts](../src/render/coords.ts) | **On main**; **D1 branch** adds a non-allocating `worldToSim` target and the winding oracle (in `camera/isoMath.test.ts`) | R0 (D1) |
| Palette | [src/render/art/palette.ts](../src/render/art/palette.ts) | **On main**: an 18-key subset of the art-direction palette. **D1 branch**: 24 keys (adds meadow, deep water, foam and three UI tokens) plus `cssColor`. **D11a branch**: the full table (70 tokens) plus `forestFloor`, tweak-panel overrides in memory, and a scan rule against hex literals elsewhere. **D3 render branch**: `signalAmber`, the tooltip's middle grade band | full set in D11a |
| Composition root | [src/app/](../src/app/) | **On main**: the skeleton smoke scene. **D1 branch**: replaced by seeded terrain, water and lighting under the iso camera, controller, scheduler, renderer host and perf monitor; G toggles the lattice overlay (debug, until D3). **D3 render branch**: `main.ts` creates the sim and wires construction; `InputRouter` (the single owner of canvas and window input), `keymap` (pure key and wheel rules), `construction` (tool state, effect interpreter, the single command gateway, undo/redo with toast and flash, timed previews and plans), `hudTheme`; the lattice overlay follows the track tool (G is gone); the dev-only `__diorama` hook gains the Playwright projection functions. No sim step loop yet | R0–R1 (D1), R4 (D3) |
| Core utilities, terrain | [src/core/util/](../src/core/util/), [src/core/terrain.ts](../src/core/terrain.ts) | **D1 branch**: `int`, `hash`, `prng`, `heap`; seeded integer terrain with a golden hash | rest of S0, S3 (D1) |
| Geometry, track model, planner | [src/core/geometry/](../src/core/geometry/), [src/core/track/](../src/core/track/) | **D2 branch**: `templates`, `piece`, `sample`, `clearance`; `authored`, `validate` (the 11 D2-owned codes), `history`. **D3 core branch**: `planner`, the full planner behind `sim.planTrack` (one-bend, shift and two-bend fits, magnetism, precision, elevation; [simulation model §8](simulation-model.md#8-planner)) | S2–S3 (D2); S4 (D3) |
| Network, pathfinding | [src/core/network/](../src/core/network/) | **D2 branch**: a partial `derive` (through and buffer nodes, sections split at buffers). Junctions, graph and pathfinding planned | S5–S6 (D2 partial) |
| Trains, reservation, deadlock | `src/core/trains/`, `src/core/signals/` | Planned | S7–S9 (D8, D9) |
| Operator and reasons | `src/core/services/` | Planned | S9–S10 (D9) |
| Sim façade, remap, views, save | [src/core/sim/](../src/core/sim/) | **D2 branch**: `world.ts` and the first slice of `api.ts` (`createSim`; `preview`, `execute` and `network()`; build, demolish, undo and redo), which also re-exports the lattice and terrain helpers. **D3 render branch**: additive re-exports of the scenario types, `resolvePiece` and `pieceFromKey` (the ghost draws unbuilt specs). `api.ts` grows from here; remap in S11a/b; views and save in S12 | S2–S3 (D2); (D10, D12) |
| Scenario | [src/core/scenarios/](../src/core/scenarios/) | **D11a branch**: `baltic-diorama.ts` builds the static scenery layout (towns with lots, church, windmill, farmsteads, strip fields, forest density and trees, dirt roads, telegraph poles, lamps, fences, haystacks) from the terrain and a seed, integer-only, with a golden hash; `placeNames.ts` is the Baltic name list. D1 terrain moved to generator version 2 in the same branch | D1, D11a |
| Renderer host, scheduler, camera, perf monitor | [src/render/core/](../src/render/core/), [src/render/camera/](../src/render/camera/) | **D1 branch**: `RendererHost`, `FrameScheduler`, `PerfMonitor` (F3); `isoMath`, `IsoCamera`, `CameraController`. Pure parts unit-tested. **D3 render branch**: `CameraController` attaches no listeners; `InputRouter` offers it each gesture first | R0 (D1) |
| Terrain, lighting, lattice shader | [src/render/terrain/](../src/render/terrain/), [src/render/art/](../src/render/art/) | **D1 branch**: chunked lattice-triangle terrain (LOD0/LOD1), depth-tinted water, `lighting` with a fitted shadow map (`shadowFit`), lattice overlay (`shaderChunks/lattice`, `terrain/latticeMaterial`). Look not judged | R1 (D1) |
| Track meshes | [src/render/track/](../src/render/track/) | **D3 render branch**: `trackGeometry` (ballast, sleepers and rails through `geometry/sample.ts`), `TrackBatch` (a `BatchedMesh` per layer, or 128 m chunk-merged meshes without multi-draw), `TrackView` (diffs by revision and piece key, 8 ms slices, far LOD), `ghostGeometry` and `GhostView` (the two-pass ghost, rejection highlight, undo/redo flash, drop lines and end-height tags), `SnapRing`. Turnout timbers, blades and earthworks planned | R2, R4 (D3) |
| Scenery kit, labels | [src/render/scenery/](../src/render/scenery/), [src/render/labels/](../src/render/labels/) | **D11a branch**: instanced trees (3 species, 2 LODs), the building grammar (9 kinds) merged per chunk, instanced props, the terrain splat/field/AO textures, and CSS2D place names with a greedy declutter. Look not judged | R3 (D11a) → Look Gate A |
| Art pipeline | [src/render/art/](../src/render/art/) | **D11a branch**: `AssetRegistry`, `materials` (six Lambert materials), shader chunks `grain`, `windSway`, `foliageTint`, `edgeFade` and `splat` composed with `lattice`, the CSS `vignette` and the dev `TweakPanel`; [camera/bookmarks.ts](../src/render/camera/bookmarks.ts) holds the Look Gate A views and the pitch A/B. **D3 render branch**: three track materials and the `trackStripe` chunk (the far-LOD ballast stripe) | R3 (D11a), R2 (D3) |
| Tools | [src/tools/](../src/tools/) | **D3 render branch**: `types` (events, effects, ctx), `trackTool` (the track tool reducer), `previewMemo` (LRU of 16 keyed by revision + command key), `picks`, `format` (tooltip text); reducer unit tests. Signal, Station, Depot, Bridge, Tunnel and Demolish planned | R4 (D3); R5 (D4–D7) |
| Picking | [src/render/picking/](../src/render/picking/) | Terrain node: **D1 branch**, as [heightfieldRay.ts](../src/render/terrain/heightfieldRay.ts). **D3 render branch**: `trackPicker` (existing nodes within 14 px, centrelines within 10 px, measured on screen at track height, then the terrain node). Handles and the proxy `pickScene` planned | D1 (terrain node), R4 (D3), R5 (handles, proxies) |
| Overlays | `src/render/overlays/` | Planned | R5 (D7) |
| Trains, steam, inspector | `src/render/trains/`, `src/ui/` | Planned | R6 (D8–D10) |
| HUD | [src/ui/](../src/ui/) | **D3 render branch**: `store` (the HUD store) and `Hud` (construction tooltip, toast, aria-live status line, bottom toolbar with Track and undo/redo), mounted at `#hud`. Time controls, counters, inspector, entity list, notifications and overlay toggles planned | R4 (D3); R5–R6, D10 |
| Quality presets, hardening, bench | `src/render/core/`, `bench/` | Planned | R7 (D11b, D12) → Look Gate B |
| Replay harness | `tests/replay/`, `tests/fixtures/` | Planned | D12 |
| Browser e2e | [tests/e2e/](../tests/e2e/), [playwright.config.ts](../playwright.config.ts) | **D3 render branch**: Playwright on its own Vite server (port 5232, system Chrome): drag-build and undo to empty, keyboard construction, a closed loop through ordinary drags; `*.capture.ts` screenshots for manual checks (`CAPTURE=1`). Agent evidence only | D3 |

## Module layout

```
index.html → src/app/main.ts   wiring, fixed-step host loop, input → commands
src/core/        deterministic, DOM-free simulation
  util/          int.ts (isqrt, divFloor), prng.ts (sfc32, scenarios only),
                 heap.ts, hash.ts (FNV-1a over canonical JSON)
  lattice.ts     ← on main
  terrain.ts
  geometry/      templates.ts (the only place π/atan are used), piece.ts,
                 sample.ts (render-side sampling, trig allowed), clearance.ts
  track/         authored.ts, planner.ts, validate.ts, history.ts
  network/       derive.ts, graph.ts, pathfind.ts
  signals/       reservation.ts, deadlock.ts
  trains/        consist.ts, kinematics.ts, movement.ts
  services/      operator.ts, reasons.ts
  sim/           world.ts, remap.ts, views.ts, invariants.ts, save.ts, api.ts
  scenarios/     baltic-diorama.ts
src/tools/       pure tool reducers (state, event, ctx) → [state, effects]
src/render/      imperative Three.js
  core/          RendererHost, FrameScheduler, QualityPreset, PerfMonitor
  coords.ts      ← on main
  camera/        isoMath, IsoCamera, CameraController
  terrain/ track/ scenery/ trains/ overlays/ picking/ labels/
  art/           palette.ts ← on main, lighting, materials, grain, shaderChunks,
                 AssetRegistry
src/ui/          React 19 HUD, fed through useSyncExternalStore
tests/           architecture.test.ts ← on main, replay/, fixtures/
```

| Layer | Owns | Never |
|---|---|---|
| `src/core` | All authoritative state: lattice, terrain, authored track, the derived network, signalling, trains, the operator, history and save. Exposes the `Sim` façade in `sim/api.ts` | Imports from outside `src/core`; uses wall time, randomness, the DOM, console or timers; knows about pixels or frames |
| `src/tools` | One interaction state machine per tool, as pure reducers that turn picks into commands, ghosts and tooltips | Imports three, render, ui or react; touches the DOM; executes commands itself |
| `src/render` | Scene, camera, frame scheduler, picking, overlays, labels, art and assets | Imports ui; owns game state; mutates views |
| `src/ui` | The React HUD: toolbar, time controls, counters, inspector, entity list, notifications, tooltip, and the HUD store | Runs inside the frame loop; calls the sim or three directly |
| `src/app` | The composition root: creates the sim, renderer and store; runs the host loop; owns `InputRouter` and the single command gateway; interprets tool effects | Holds game rules |
| `tests` | Cross-cutting checks: the boundary scan, replay and fixtures. Unit tests sit next to their source as `*.test.ts`; benches as `*.bench.ts` | — |

## Dependency rules and enforcement

The allowed import directions are:
- core → core;
- tools → core;
- render → core and three;
- ui → core types, react and its own store;
- app → everything;
- tests → everything.

| Rule | Enforced by | Status |
|---|---|---|
| Core imports only relative paths inside `src/core`. No packages at all, so no three and no react | boundary test | on main |
| Core never uses `Math.random`, `Date`, `performance.`, `console.`, `window`/`document`/`globalThis`, `setTimeout`/`setInterval`/`requestAnimationFrame`, `structuredClone` or `for…in` | boundary test. DOM globals also fail the core typecheck | on main |
| `Math.sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/pow/exp/expm1/log*/hypot/cbrt` appear only in `core/geometry/{sample,clearance,templates}.ts` | boundary test | on main |
| Tools never import three, render, ui or react, never touch `window`/`document`/`navigator` or DOM types, and read no clock or randomness and schedule nothing (reducers are pure) | boundary test | on main; clock, randomness, scheduling and DOM types added in D3 (2026-09-27) |
| Render never imports ui | boundary test | on main |
| Render, tools and ui import core only through `sim/api.ts` (snapshot types and the façade; it re-exports the lattice, terrain and scenario helpers the edges need) and the pure `geometry/sample.ts`, so curve maths has one source. `src/app`, the composition root, may import core directly; `main.ts` does | boundary test (test files exempt, like every scan) | since D3 (2026-09-27): the D1 and D11a exceptions were cleared when `render/terrain/`, `render/scenery/`, `render/labels/placeLabels.ts` and `render/camera/bookmarks.ts` moved to `sim/api.ts`, which now also re-exports the scenario types |
| Ui imports neither three nor render (it gets palette colours as CSS custom properties from `src/app`) | boundary test | since D3 (2026-09-27) |

**[tsconfig.core.json](../tsconfig.core.json)**
- Settings: `lib: ["ES2022"]`, `types: []`, `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`.
- Core code therefore has no DOM types and no ambient `@types` (no `vite/client`, no node), so
  `window`, `document`, `performance` and `requestAnimationFrame` fail to typecheck.
- It excludes `*.test.ts` and `*.bench.ts`: tests may use trig, ad-hoc PRNGs and Vitest.
- `npm run typecheck` runs the app config ([tsconfig.json](../tsconfig.json): all of `src`,
  `tests` and `vite.config.ts` with DOM types), then the core config.
- What it cannot catch:
  - an explicit package import;
  - ES2022 built-ins such as `Math.random` and `Date`.

  The boundary test covers both.

**[tests/architecture.test.ts](../tests/architecture.test.ts)**
- Loads every non-test `src/**/*.{ts,tsx}` as raw text through `import.meta.glob`.
- Strips comments.
- Extracts static, dynamic and side-effect import specifiers and resolves relative ones.
- Applies the rules above.
- The negative self-check proves each scanner fires:
  - a synthetic core file with seven violations yields exactly seven findings;
  - trig inside `geometry/sample.ts` passes;
  - a tool importing three and a render file importing ui are flagged;
  - render, tool and ui files importing a core module other than `sim/api.ts` or
    `geometry/sample.ts` are flagged, while render's own `render/core/` and `src/app` pass;
  - a comment mentioning `Math.random()` and a relative import inside core both pass.

There is no linter and no CI, so `npm test` (inside `npm run check`) is the guard, run before
every push.

**Known limits of the scan.**
- It is a regex tripwire, not a proof.
- String literals are not stripped. A core message containing a banned word (`Date`,
  `window`, `document`) fails, so reason texts avoid those words, or the scanner learns to skip
  strings.
- Aliasing (`const M = Math; M.random()`) evades it. Code review covers that case.

## Core API

*Basis: ADR 0002 (Accepted), ADR 0012 (Proposed). Status: first slice on the **D2 branch**
(2026-09-26); the rest planned, S4–S12. [`sim/api.ts`](../src/core/sim/api.ts) and
[`sim/world.ts`](../src/core/sim/world.ts) implement `createSim({ terrain })`, `tick`
(always 0 until the step lands), `preview`, `execute` and `network()` for `build-track`,
`demolish` (pieces only), `undo` and `redo`. The **D3 core branch** (2026-09-27) adds
`planTrack`. `loadSim`, `step`, `frame`, `inspect` and `save` arrive with their slices.*

The names and shapes below come from the design. `Highlight`, `EntityRef` and the ID types
are indicative; S5 and S12 pin them down. D2 pinned `PieceSpec`, `PieceKey`, `NodeRef`
(`{ q, r, zMm }`) and `Diff` (`{ added, removed }` of `{ key, structure }` records) in
`sim/api.ts`. D3 pinned `Drag`, `TrackPlan`, `PlanFit` and `PlanPointMm` in
[`track/planner.ts`](../src/core/track/planner.ts), exported through `sim/api.ts`. A
command's shape (its `type`, a build's `structure`, the `pieces` arrays) is a programmer
contract that throws a `TypeError`; its contents are player-reachable and are
rejected with a reason, never thrown.

```ts
// src/core/sim/api.ts: the only core entry point for app, tools, render and ui
createSim(scenario: Scenario): Sim
loadSim(save: WorldSave): Sim

interface Sim {
  readonly tick: number
  planTrack(drag: Drag): TrackPlan     // drag → resolved pieces; pure
  preview(cmd: Command): Result        // execute's code path: no mutation, no IDs consumed
  execute(cmd: Command): Result
  step(ticks?: number): void           // whole 100 ms ticks, default 1
  network(): NetworkView               // cached per network revision
  frame(): FrameView                   // produced every tick
  inspect(q: InspectQuery): Inspection // "why is this train waiting?"
  save(): WorldSave                    // canonical, hashable
}

type Command =
  | { type: "build-track"; pieces: PieceSpec[]; structure: "ground" | "bridge" | "tunnel" | "auto" }
  | { type: "demolish"; pieces?: PieceKey[]; signals?: SignalId[];
      platforms?: PlatformId[]; depots?: DepotId[] }
  | { type: "place-signal"; node: NodeRef; facing: Heading; kind: "stop" | "chain" }
  | { type: "place-platform"; pieces: PieceKey[] }
  | { type: "place-depot"; node: NodeRef; facing: Heading }
  | { type: "undo" }
  | { type: "redo" }

type Result =
  | { ok: true; networkRev: number; diff: Diff; counts: { new: number; reused: number } }
  | { ok: false; reason: { code: ReasonCode; message: string; refs: EntityRef[] };
      highlight: Highlight }
```

**Contracts:**
- **Resolved pieces, not drag input.** `planTrack` turns a drag into `PieceSpec[]`, and the
  command carries the result, so later planner tuning never breaks a recorded replay.
- **`preview` is `execute` minus the mutation.** It shares the code path and consumes no IDs.
  A property test asserts preview == execute without mutation.
- **One reason per rejection.** Validation runs in a fixed rule order and returns one reason
  code, a message that suggests a fix, and highlights. The codes and their order live in
  [simulation-model.md](simulation-model.md).
- **Rejections are values.** An exception thrown from the core is a bug, not a validation
  outcome (recommendation).
- **Command timing.** Commands apply between ticks, as the first stage of the tick order.
  Replays record them as `(tick, cmd)`.
- **No-op builds.** A `build-track` whose pieces all exist already is a no-op with no history
  entry. The "N new, M reused" counts are key lookups.
- **Undo and redo** are commands over construction diffs, with a stack depth of 100.
  - They are validated like any edit (`undo-blocked`).
  - Trains, time, the operator and the ID allocators are never in history.
- **Edits under traffic.** An edit that would strand a train's committed zone is refused with
  `track-in-use` ([simulation-model.md](simulation-model.md)).
- **No wall time.** `step` counts ticks only; speed is the host's concern.

### NetworkView and FrameView

`NetworkView` is cached per revision. It is the same object until the network changes, so
consumers compare its revision instead of diffing contents.

| NetworkView | Contents |
|---|---|
| pieces | key, kind, structure, `lengthMm`, `z0Mm`/`z1Mm`, `speedLimitMms`, render prims (lines and arcs) |
| sections | including `blockId` and `conflictGroup` |
| junctions, signals, platforms, stations, depots | derived entities with stable IDs |

`FrameView` is produced every tick.

| FrameView field | Meaning | Main consumer |
|---|---|---|
| `tick`, `simMs` | tick count and simulated time | HUD clock and date |
| `trains[]` | id, lineId, status, `prevHeadMm`, `headMm`, window of sections, cars, `speedMms` | trains layer, counters, inspector |
| `signalAspect: Uint8Array` | display aspect per signal | semaphores, block overlay |
| `sectionHolder: Int32Array` | trainId holding each section, −1 when free | reservation ants |
| `sectionOccupied` | occupancy per section | occupied overlay (red) |
| `switchLeg` | current leg per switch | blade animation |
| `events` | this tick's events (deadlock, spawn, withdrawal, …) | notifications, aria-live line |

- **Views are read-only.**
- **Frame lifetime** (recommendation): a consumer never keeps a `FrameView` past the next
  `step`, so the core can reuse its typed arrays without allocating.
- **Events.** The host drains `frame().events` after every `step()`, because one rendered
  frame can run several ticks.

### Interpolation contract

- **alpha = min(acc / 100, 1).**
  - The displayed moment is (tick − 1 + alpha) × 100 ms.
  - The view trails the sim by at most one tick and never runs ahead.
- **Train position.** The head is drawn at `lerp(prevHeadMm, headMm, alpha)`, measured along
  arc length through the train's section window (the window covers both positions).
  - Cars and bogies are placed behind the head along the same path, using
    `geometry/sample.ts`.
- **Never extrapolate.** When the step cap trips or the sim is paused, alpha stays ≤ 1, so a
  train is drawn at or behind `headMm`. The core keeps `headMm` ≤ the end of authority, so a
  train never visibly overshoots a red signal.
- **Discrete state is not interpolated.** Aspects, holders, occupancy and switch legs show
  the latest tick.
  - Presentation may ease toward the new value: the semaphore arm over 400 ms, blades from
    `switchLeg`.
- **Paused.** At speed 0, `acc` stops growing and the image freezes where it was.

### Host loop and time controls

The loop lives in `src/app` and runs once per rendered frame. It is planned: since D1
(2026-09-26) `main.ts` renders the terrain on demand but has no sim loop yet.

```ts
acc += dtWall * speed                            // wall ms × {0, 1, 2, 4, 10}
let n = 0
while (acc >= 100 && n++ < 40) { sim.step(); drain(sim.frame().events); acc -= 100 }
alpha = Math.min(acc / 100, 1)
```

- **Speeds.** 0 (pause), 1, 2, 4 and 10×.
  - Space pauses; `,` and `.` step the speed down and up.
  - The HUD's top-right control shows Pause/1/2/4/10×.
- **Frame rate cannot change outcomes.** The core never sees wall time, and the replay
  contract `step(1)×N == step(N) == step(10)×N/10` holds.
- **Step cap.** A frame runs at most 40 ticks, which is 4 simulated seconds. Recommendations:
  - When the cap trips, drop the whole-tick backlog (`acc %= 100`). A stall then slows sim
    time instead of spiralling. Count each trip in PerfMonitor.
  - Treat `dtWall` as 0 on the first frame after the page becomes visible, so hidden time is
    not replayed.
- **Scheduler link.** Speed > 0 sets the scheduler's `sim-running` reason; pause clears it.
- **Date.** The ui formats the HUD date from `simMs`, starting at "January 1, 1900, 08:00 AM".

## Renderer

*Basis: ADR 0009 (Accepted) for the camera, coordinates and render-on-demand; ADR 0013
(Proposed) for presets, materials and assets. Status: R0–R1 on the D1 branch (2026-09-26;
host, scheduler, camera, perf monitor, terrain, lighting, lattice overlay; see the table
above); R2 (track meshes) and the presentation half of R4 (ghost, snap ring, picking) on the
D3 render branch (2026-09-27); R3 on the D11a branch; R5–R7 planned.*

- **Renderer.** `THREE.WebGLRenderer` from three `0.185.1`, pinned exactly. WebGPU is out of
  M4.
- **Shaders.** Tweaks go through isolated `onBeforeCompile` modules in `art/shaderChunks`:
  grain, lattice, windSway, foliageTint, edgeFade.
- **Materials.** About 12 `MeshLambertMaterial`s with vertex and instance colours. Every
  colour comes from `art/palette.ts`.

### Frame scheduler (render on demand)

- `FrameScheduler.requestFrame(reason)` asks for one frame.
- `setContinuous(reason)` keeps frames coming while a named reason is active.

| Continuous reason | Active while | Rate |
|---|---|---|
| `sim-running` | speed > 0 | display rate |
| `camera-anim` | the Q/E rotation ease (300 ms), zoom or pan inertia, a Show pan | display rate |
| `ambient` | tree sway, water, windmill sails | 30 fps when it is the only reason. Off under reduced motion or the power-saver setting |
| `particles-alive` | any steam puff is still alive | display rate |

- **One-shot reasons:**
  - input;
  - a hover or snap change;
  - resize or a DPR change;
  - a new network revision;
  - an overlay or label toggle;
  - continuing a time-sliced rebuild;
  - context restore.
- **Idle.** No active reason means no `requestAnimationFrame` and zero frames. This is a D1
  acceptance item.
- **Hidden page.** The loop stops when the page is hidden and resumes when it is visible.

### Per-frame order

1. **Input → tools.** `InputRouter` gives camera gestures to the camera first and everything
   else to the active tool. Preview is memoized.
2. **Fixed-step sim**, using the host loop above.
3. **Static diffs by revision.** When `network()` has a newer revision than the renderer has
   applied, update the track batches, structures and overlays by piece key.
   - Work over 8 ms is time-sliced into later frames.
   - Recommendation: diff piece keys against the current `NetworkView` instead of replaying
     every `Result.diff`, so the renderer heals itself after undo, redo or context loss.
4. **Interpolate trains** with alpha.
5. **Particles.**
6. **Camera, then shadow fit**, so the shadow frustum follows this frame's final camera.
7. **Dirty overlays only:** blocks, reservations, occupancy, the ghost.
8. **Render.** CSS2D labels are laid out again only when something changed.
9. **Perf sample** for PerfMonitor and its F3 overlay.

**No allocations in the loop:**
- scratch vectors and matrices;
- preallocated typed arrays;
- pooled instances (the steam pool holds 2,000).

### Coordinates

- **Core.** ENU metres (x east, y north, z up).
  - Lattice nodes sit at x = a(q + r/2), y = a·r·√3/2, with a = 5 m
    ([lattice.ts](../src/core/lattice.ts)).
  - Heading 0 is +x (east).
  - Lengths and node heights are integer mm; terrain heights are Int16 dm. The renderer
    converts them to metres before converting axes.
- **Three.** Y-up metres (X east, Y up, Z south).
- **Conversion.** world = (x, z, −y), a −90° rotation about X with determinant +1.
  - It never mirrors the scene; the legacy harness's (x, z, y) swap did.
  - `SIM_TO_WORLD`, `simToWorld` and `worldToSim` in [coords.ts](../src/render/coords.ts) are
    the only conversion point.
- **Tests on main** ([coords.test.ts](../src/render/coords.test.ts)):
  - the determinant is +1;
  - the frame is right-handed: mapped east × mapped north = up, and sim up maps to world up;
  - the matrix and the function agree and round-trip.
- **D1 branch tests:**
  - the winding oracle: the projected (origin, east, north) triangle is counter-clockwise on
    screen for all 6 yaws ([isoMath.test.ts](../src/render/camera/isoMath.test.ts));
  - a generator test that checks every terrain and water triangle's winding against its
    normals, because materials use `FrontSide` only
    ([terrainGeometry.test.ts](../src/render/terrain/terrainGeometry.test.ts)).
- **Asset model space.** +Y up, origin at ground contact, forward +X. This applies to
  procedural assets now and glTF later.

### Camera

| Parameter | Value |
|---|---|
| Projection | `OrthographicCamera`; halfW = cssW/(2·ppm), halfH = cssH/(2·ppm) |
| Pitch | true isometric 35.264° (atan(1/√2)). One constant, so the look gate can A/B 30° |
| Yaw | k·60°, k = 0–5, matched to the lattice. At k = 0, heading-0 lines are horizontal on screen and the camera looks north. Q/E rotate with a 300 ms ease (while precision is held in the track tool, Q/E turn the plan's end heading instead) |
| Position | target + D·(sin(yaw)·cos(p), sin(p), cos(yaw)·cos(p)); D = 2000 m, near 10, far 4000 |
| Zoom | continuous 0.75–24 ppm. Named levels (+/−): Far 0.9 · Region 2.5 · Default 6 · Close 12 · Detail 22 |
| Wheel | factor 1.15 per notch; pinch arrives as ctrl-wheel. Zoom-to-cursor keeps the terrain point fixed, with drift < 0.5 px (D1 gate). With the track tool active, Shift+wheel steps the height and wheel with precision held picks the radius class; precision is read from the tracked key state, so a pinch (ctrl-wheel without a Control keydown) still zooms |
| Pan | right or middle drag; left drag on empty ground in Select; WASD or arrows at 700 CSS px/s (the arrows move the keyboard lattice cursor when it is active); small inertia, off under reduced motion |
| Target | stays on the Y = 0 datum, clamped to the map ± 100 m |
| LOD bands | ppm < 2 far, 2–5 mid, > 5 near. Track far LOD (< 4 ppm) hides sleepers |
| Resize and DPR | `ResizeObserver` with `devicePixelContentBoxSize`; DPR changes via `matchMedia` |
| Context loss | on restore, rebuild GPU resources from `NetworkView` and `FrameView` |

### Quality presets and shadows

| Preset | DPR | Shadows | Anti-aliasing and post |
|---|---|---|---|
| Low | 1 | none (baked AO only) | no post |
| Medium (default) | ≤ 1.5 | 2048 PCF map, radius 2 | default MSAA; CSS vignette |
| High | ≤ 2 | 4096 map | `EffectComposer`: MSAA target → half-res GTAO → grade pass → optional tilt-shift → `OutputPass`, all lazy-loaded |

- **Scaling.** Dynamic resolution scale runs 0.7–1. The auto-preset drops one level if p90 >
  20 ms over the first 3 s.
- **The base look must work without post-processing.** Tilt-shift is off while a construction
  tool is active.
- **Shadow fitting.** One directional shadow map, no cascades.
  - After the camera update, the view footprint (the orthographic frustum over the terrain's
    height range) is taken into light space.
  - The shadow camera's bounds are fitted to it.
  - The light-space origin is snapped to whole texels, so edges don't shimmer during a pan.
- **The sun is locked to camera yaw**, lighting the scene from the upper left of the screen,
  so the light's direction changes only on Q/E.
- **Shadow type.** `PCFShadowMap` with a radius and an intensity. `PCFSoftShadowMap` is
  deprecated in r185.
- **Light values.** Colours, intensities and bias live in [art-direction.md](art-direction.md).

### Scene layers

From bottom to top:

| Layer | Contents and technique |
|---|---|
| Terrain | Lattice-triangle mesh from sim heights, chunked, with LOD. Splat map (dirt, cobble, field, forest floor), grain, baked AO tint map. **Earthworks** (embankments, cuttings, ballast skirts) move render vertices only; the core's heights never change. **Lattice overlay shader**: three line families, `fwidth`-anti-aliased 1 px lines and 1.5 px node dots. Opacity is 0 in view mode; in build mode 0.15 globally and 0.55 within 48 m of the cursor. It fades where lines would be < 5 px apart; precision mode adds a finer sub-lattice |
| Water | opaque, depth-tinted |
| Track | three `BatchedMesh`es (ballast, sleepers, rails), built along analytic arcs with chord error ≤ 2 cm; turnout timbers; blades animated from `switchLeg`. If multi-draw is missing, a chunk-merged fallback sits behind a `TrackBatch` interface |
| Structures | stone arch viaduct (4–20 m over land); steel Warren truss (over water or spans > 30 m); plate-girder overpass; tunnel portals with a hill plug; piers avoid other tracks |
| Scenery | instanced trees at 2 LODs with sway; grammar-built buildings merged per chunk; props |
| Trains | an `InstancedMesh` per vehicle type; bogies evaluated along the path; pitch and cant |
| Steam | instanced puffs with an `alphaHash` dissolve |
| Overlays | block ribbons in 6 colours plus chevrons for one-way blocks; reservations as marching ants per train hue; occupied sections in red |
| Ghost | two passes: depth-tested at 0.7 and see-through at 0.2 |
| Handles | screen-constant billboards |
| Labels | CSS2D |

**Assets.** They are procedural first, behind `AssetRegistry.get(kind, variant, lod)`, which
returns:
- geometries per material slot;
- anchors (smoke, bogie_front/rear, coupler, door);
- a footprint and a budget.

Later glTF assets (`GLTFLoader` with meshopt, no Draco) register against the same keys, and
the procedural versions stay as the fallback (ADR 0013).

### Picking and occlusion aids

Picking lives in `src/render/picking/`. The app hands the result (layer, entity or piece key,
lattice node at terrain height, screen distance) to the active tool. Candidates are tried in
this order (D3, 2026-09-27: `trackPicker` implements steps 3 and 4 plus existing nodes within
14 px, measured on screen at their real height; handles and the proxy scene come with R5):

1. screen-space handles within 14 px (drawn at 6–8 px);
2. a proxy raycast in a never-rendered `pickScene` with layer bits TERRAIN, TRACK, DECK,
   TUNNEL, SIGNAL, STATION, DEPOT and TRAIN, masked by the active tool (for example, the
   Signal tool asks for TRACK);
3. track-centreline distance within 10 px;
4. an analytic heightfield ray march against the sim heights. Zoom-to-cursor also uses it.

**Occlusion aids:**
- H hides bridge decks;
- U shows an underground x-ray;
- C cycles through stacked hits;
- the EntityList gives keyboard targets.

This is the ADR 0004 lesson: depth alone did not solve occluded picking; a layer filter plus
a keyboard list did.

### Labels

- **Renderer.** Labels are CSS2D.
- **Station labels** are `<button>`s. They are focusable, and a click reaches the inspector
  through the app, never through a render → ui import.
- **Fonts.** Place names use self-hosted EB Garamond (OFL, a woff2 subset); UI numerals use
  system-ui or Inter.
- **Updates.** Labels are laid out again only when the camera or the label set changes. L
  toggles them.

## Tools

*Status: the track tool is implemented on the D3 render branch (2026-09-27, R4) in
[`src/tools/`](../src/tools/), wired by `src/app` (`InputRouter`, `construction.ts`); the
other tools are planned (R5).*

- **Shape.** `(state, event, ctx) → [state, effects]`, pure: the same inputs give the same
  outputs. No three, no DOM, no clock, randomness or timers (boundary test).
- **Events arrive already interpreted.**
  - `InputRouter` in `src/app` turns DOM input into tool events that carry the pick result and
    modifiers:
    - precision: Ctrl, or ⌥ on macOS;
    - height steps;
    - R to flip or rotate (planned with the Signal and Depot tools);
    - the keyboard lattice cursor, with Enter to start and commit.
  - Tools never raycast or read the DOM.
- **`ctx` is read-only:** the current `NetworkView`, `sim.planTrack`, the memoized preview, the
  terrain height at a node, and settings (height step, radius cap).
- **Effects are data**, interpreted by the app:
  - execute a command, through the single command gateway (tools never call `execute`);
  - set the ghost: new is white, reused cyan, invalid red and dashed; elevated ghosts get drop
    lines every 20 m and end-height tags;
  - the snap ring: filled on an endpoint, hollow on a free node, a turnout glyph on track;
  - tooltip lines;
  - highlights (the existing pieces a rejection names);
  - an aria-live announcement;
  - camera requests (keep the keyboard cursor in view);
  - exit (Esc from Idle returns to Select).
- **Preview memo.**
  - `sim.preview` runs only when the published view changes (the snapped command key, the
    revision or the shown values), and then through an LRU of 16 keyed by network revision +
    canonical command key, so a commit invalidates old entries.
  - `construction.ts` times every preview and plan; the dev hook reports their p95. If
    preview p95 exceeds 8 ms, file a sim-in-Worker ADR.
- **Track tool.** Idle → Pressed → Dragging (> 4 px) or Anchored (click-click) → Commit →
  chain (stays anchored at the new end, leaving with its heading). Esc steps back one level:
  Dragging → Anchored, Pressed or Anchored → Idle, Idle → Select.
  - A start on an existing buffer end keeps its height and lets the planner choose between
    continuing the track and running back over it. After a plan that magnetism joined to a
    port commits, the chain ends: leaving a joined port needs a turnout (D5).
  - **Height (tool defaults, open to the owner's feel check).** One step is 1 m. The end sits
    that many steps above the terrain at the end node (ground-following), so a drag across the
    land lays track on the ground; PgUp/PgDn, `]`/`[` and Shift+wheel move it. Anchoring on
    track starts at its height above ground, and chaining keeps the steps. A plan ending on an
    existing node within half a step of its height takes that height (not in precision).
  - **Precision** (held): magnetism off, the wheel steps the radius class (from 180 m) and Q/E
    the end heading; the tooltip adds the planner's live label.
- **Keys** (`src/app/keymap.ts`, tested): Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl+Y redo
  (case-insensitive, by `key`, in every tool); 1 Track; with Track active the arrows move the
  keyboard cursor (WASD still pans) and Enter starts and commits; Q/E rotate the camera unless
  precision is held. Ctrl+Q is a browser shortcut on some platforms (quit on Linux): macOS
  uses ⌥ for precision, and elsewhere Q/E with Ctrl may be taken by the browser.
- **Tool set.** Track, Signal, Station, Depot, Bridge, Tunnel and Demolish (keys 1–7).
  Select is the default no-tool state (Esc), not a toolbar button.
  - Bridge and Tunnel are the track tool with the structure forced; Track uses Auto.
  - Depot places a depot. No tool buys, assigns or dispatches trains.
- **Testing.** Reducer unit tests replay scripted event sequences without a browser.
  Playwright (`npx playwright test`, [tests/e2e/](../tests/e2e/)) covers drag-build → undo to
  empty, keyboard construction and a closed loop (D3); its runs are agent evidence.

## UI (HUD)

*Basis: ADR 0009 (Accepted). Status: the construction part is implemented on the D3 render
branch (2026-09-27): [`src/ui/store.ts`](../src/ui/store.ts) and
[`src/ui/Hud.tsx`](../src/ui/Hud.tsx), mounted at `#hud`: the construction tooltip (the three
lines, "Can't build: <reason>" and the fix, the grade in green/amber/red bands), the toast,
the aria-live status line and a bottom toolbar with Track and Undo/Redo only. Colours arrive as
CSS custom properties that `src/app/hudTheme.ts` sets from `palette.ts`. The rest below is
planned (R5–R6, D10).*

- **React 19, outside the frame loop.** React renders only when the store publishes. No
  per-tick or per-frame `setState`; no React-driven animation.
- **Store.**
  - The store module lives in `src/ui`, and `src/app` is its only writer.
  - It exposes `subscribe(listener)` and `getSnapshot()`. Components read it with
    `useSyncExternalStore(store.subscribe, store.getSnapshot)`, through per-panel selectors.
  - Snapshots are immutable, and `getSnapshot` returns the same reference until a value
    changes (React requires this).
  - Recommendation: the app publishes counters at a low fixed rate (4 Hz) and everything else
    on change.
- **Store contents:**
  - the active tool;
  - speed and date;
  - the counters "Trains · Moving · Waiting · Avg wait" (no passenger or cargo counters);
  - tooltip lines;
  - the selection and its `inspect()` result;
  - notifications;
  - undo/redo availability;
  - overlay toggles;
  - the aria-live status line.
- **Intents out.** The UI calls action functions that the app provides (set tool, set speed,
  undo, redo, Show, toggle overlay). The app turns them into tool state, gateway commands or
  camera moves.
- **Inspector.** It explains waits ("Waiting at signal S-12: block B-7 occupied by Train 3").
  **Show** pans the camera and draws a leader line through the render overlays.
- **Layout.**
  - top-left: the menu;
  - top-centre: the counters;
  - top-right: time controls, the date, Overlays, Help, Notifications and Settings;
  - bottom-centre: the toolbar with Undo and Redo, on parchment panels.
  - There is no buy, line, timetable or dispatch UI anywhere.
- **Accessibility:**
  - UI scale 90–150%;
  - reduced motion is honoured;
  - a colour-blind-safe overlay set;
  - keyboard construction.

## Persistence in M4

*Status: planned, D12.*

- **M4 has no player saves.** IndexedDB saves are an M4 exclusion; only replay fixtures and
  command logs are in scope.
- **`sim.save()` → `WorldSave`**, with `loadSim(save)`.
  - The save is canonical JSON, hashed with FNV-1a (`util/hash.ts`).
  - Terrain is stored as `{seed, generatorVersion}`.
  - Loading never re-validates.
  - It exists for the replay equalities and the determinism gate, not for players.
- **Fixtures and replays.**
  - `tests/fixtures/` holds golden scenarios built from commands only.
  - `tests/replay/` asserts:
    - `step(1)×N == step(N) == step(10)×N/10`;
    - save → load → continue == uninterrupted play;
    - a `(tick, cmd)` command log replays to identical checkpoint hashes.
- **Any future IndexedDB store** (M5 save/replay) must use a **new database name, never
  `infrastructurio`**. That database holds legacy road-era saves on the same dev origin
  ([archive](archive/README.md)). Save-format compatibility is an M5 decision and needs its
  own ADR.

## Performance budgets

- **Budgets live in one place:** the predeclared
  [acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md) and, for headless benches,
  `bench/budgets.json`, committed before the first run.
  - They are not restated here.
  - The owner approves them before any measurement, and they are never retuned after results.
- **Architectural choices that exist to meet them:**
  - render on demand;
  - no allocations in the loop;
  - `BatchedMesh` and `InstancedMesh` for the draw-call budget;
  - time-sliced static diffs;
  - labels only on change;
  - the lazy-loaded High post chain;
  - dynamic resolution and the auto-preset.
- **Measurement (D12):**
  - PerfMonitor (F3 overlay);
  - `vitest bench` headless;
  - a Playwright bench that writes JSON reports.

## Workers

- **Everything runs on the main thread** (sim, tools and render) until measurement says
  otherwise.
- **Triggers for a sim-in-Worker ADR:**
  - preview p95 > 8 ms;
  - sim tick batches missing their gate budgets.
- **Why a later move is cheap.** ADR 0002's command and snapshot boundary means the move
  changes transport, not ownership, and `FrameView`'s typed arrays are transferable.
- **Nothing is built speculatively:** no worker plumbing, no message protocol, no
  `SharedArrayBuffer`.

## Related decisions and guides

- [ADR 0001](decisions/0001-web-based-prototype.md): web, TypeScript, Vite and React
  (Accepted; its renderer scope was replaced by 0009).
- [ADR 0002](decisions/0002-separate-simulation-from-presentation.md) (Accepted) and
  [ADR 0008](decisions/0008-archive-road-era-and-restart.md): the archive and restart
  (Accepted).
- [ADR 0009](decisions/0009-render-isometric-threejs.md) (Accepted); ADRs
  [0010](decisions/0010-triangular-lattice-track-geometry.md)–[0014](decisions/0014-autonomous-diorama-operator.md)
  (Proposed).
- Agent rules per layer: [src/core/CLAUDE.md](../src/core/CLAUDE.md) and
  [src/render/CLAUDE.md](../src/render/CLAUDE.md), which [AGENTS.md](../AGENTS.md) routes
  other agents to.
