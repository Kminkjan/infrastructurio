# 0009 — Render as 2.5D isometric with Three.js

- Status: Accepted
- Date: 2026-09-26
- Scope: Prototype. The renderer, camera, sim → world coordinate convention, frame loop and
  HUD boundary (`src/render`, the host loop in `src/app`, `src/ui`)
- Tracking: M4 epic "M4 — Epic: Living Diorama"
  ([#62](https://github.com/Kminkjan/infrastructurio/issues/62)); D1 Lattice, terrain and
  isometric camera ([#65](https://github.com/Kminkjan/infrastructurio/issues/65)); D11 Art
  direction ([#75](https://github.com/Kminkjan/infrastructurio/issues/75))
- Evidence: owner direction in conversation, 2026-09-26;
  [`src/render/coords.ts`](../../src/render/coords.ts) and its test (automated); the skeleton
  smoke scene [`src/app/main.ts`](../../src/app/main.ts)
- Decision authority: Owner decision given explicitly in conversation on 2026-09-26
  (rendering: web + TypeScript + Three.js 2.5D) and "Mark ADR 0008/0009 Accepted"
- Supersedes: [ADR 0001](0001-web-based-prototype.md)'s renderer scope (PixiJS for a 2D
  world); its browser, TypeScript, Vite and React direction stands.
  [ADR 0004](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/docs/decisions/0004-m4-renderer-camera-reference.md)
  in full (archived at tag `legacy-m0-m4`)
- Superseded by: None

## Context

ADR 0001 chose PixiJS for a 2D world. On 2026-09-26 the owner re-imagined M4 as a
rail-first "living diorama" ([ADR 0008](0008-archive-road-era-and-restart.md)): the player
builds track on terrain, with grades, bridges over other lines, tunnels, turnouts and
stations, and autonomous trains run on it. The target mood is a calm isometric 2.5D diorama
with procedural low-poly art ([art direction](../art-direction.md)).

The view has to:
- show elevation honestly: a branch climbing over the main line, a tunnel under a hill,
  stacked structures;
- line up with the 60° symmetry of the triangular track lattice
  ([ADR 0010](0010-triangular-lattice-track-geometry.md));
- let the player pick the right object when a deck or a hill hides it;
- cost nothing when idle, because a diorama is watched more than it is edited;
- leave the simulation authoritative and DOM-free
  ([ADR 0002](0002-separate-simulation-from-presentation.md)).

Road-era ADR 0004 kept a Pixi plan view as the bounded editing reference for a road plan
editor, after the paired Pixi/Three.js study
([#26](https://github.com/Kminkjan/infrastructurio/issues/26)). That answered a different
question, and its evidence is history, not evidence for this prototype. One lesson carries
over: depth alone did not solve occluded picking; a layer filter plus a keyboard entity list
did.

## Decision

Render the world in real 3D with Three.js, through a fixed isometric orthographic camera,
with procedural low-poly art (the pipeline is [ADR 0013](0013-rendering-and-art-pipeline.md)).

1. **Renderer.** `THREE.WebGLRenderer`, with `three` pinned at exactly `0.185.1`; upgrades
   go in dedicated PRs. No WebGPU in M4. Shader tweaks live in isolated `onBeforeCompile`
   modules, so a later renderer change touches a bounded set of files.
2. **Camera.** One `OrthographicCamera`:

   | Parameter | Value |
   |---|---|
   | Pitch | True isometric 35.264° (atan(1/√2)); one constant, so a look gate can A/B 30° |
   | Yaw | k·60°, k = 0–5, matched to the lattice. k = 0 shows heading-0 lines horizontal, looking north. Q/E rotate with a 300 ms ease |
   | Position | target + D·(sin(yaw)cos(p), sin(p), cos(yaw)cos(p)); D = 2,000 m, near 10 m, far 4,000 m |
   | Frustum | From CSS size and pixels per metre (ppm): halfW = cssW/(2·ppm), halfH likewise |
   | Zoom | Continuous 0.75–24 ppm. Named levels Far 0.9 · Region 2.5 · Default 6 · Close 12 · Detail 22. Wheel factor 1.15, pinch via ctrl-wheel. Zoom-to-cursor keeps the terrain point fixed (drift < 0.5 px) |
   | Pan | Right/middle drag, left drag on empty ground in Select, WASD/arrows at 700 CSS px/s; small inertia, off under reduced motion |
   | Target | On the Y = 0 datum, clamped to the map ± 100 m |
   | LOD bands | By ppm: < 2 far, 2–5 mid, > 5 near |

   Resizes come from `ResizeObserver` (`devicePixelContentBoxSize`) and DPR changes from
   `matchMedia`. A lost WebGL context is rebuilt from sim snapshots. The pitch is the
   true-isometric angle, but the yaw set follows the lattice, not the classic 45°
   square-grid yaw.
3. **Coordinates.** Sim space is right-handed ENU metres (x east, y north, z up). The
   Three.js world is (x, z, −y): a −90° rotation about X with determinant +1, so it never
   mirrors the scene. [`src/render/coords.ts`](../../src/render/coords.ts) is the only
   conversion point.
   - Materials use `FrontSide` only; a generator test checks winding against normals.
   - Winding oracle: the projected (origin, east, north) triangle is counter-clockwise on
     screen for all six yaws.
   - Asset model space: +Y up, origin at ground contact, forward +X.
4. **Render on demand.** `FrameScheduler.requestFrame(reason)` draws one frame, and
   `setContinuous(reason)` keeps the loop running for named reasons: `sim-running`,
   `camera-anim`, `ambient` (30 fps; off under reduced motion or power saver) and
   `particles-alive`. With no reason active, no frames are drawn. The loop also stops while
   the page is hidden.
   - Frame order: input → tools (memoized preview) → fixed-step sim with the accumulator →
     static diffs applied by network revision (time-sliced above 8 ms) → train
     interpolation → particles → camera, then shadow fit → dirty overlays → render (labels
     only on change) → perf sample. No allocations in the loop.
   - Trains are drawn at lerp(prevHeadMm, headMm, alpha) along arc length, with alpha
     clamped at 1. The renderer never extrapolates, so a train never visibly overshoots a
     red signal. Tick cadence and units are [ADR 0012](0012-tick-units-determinism.md)'s.
5. **HUD outside the frame loop.** The React 19 HUD reads a snapshot store through
   `useSyncExternalStore` and never runs per frame. `src/render` never imports `src/ui`, and
   tools are pure reducers with no three and no DOM. The renderer reads `NetworkView` and
   `FrameView` and never mutates sim state.
6. **Picking under a fixed camera,** in order: screen-space handles within 14 px → a
   layer-filtered proxy raycast in a never-rendered pick scene → track centreline distance
   within 10 px → an analytic heightfield ray march. Occlusion aids: H hides decks, U shows
   an underground x-ray, C cycles stacked hits, and an entity list gives keyboard targets.

Everything runs on the main thread until measurement says otherwise. Open: the final pitch
(Look Gate A may A/B 30°); quality presets, shadows and post-processing belong to ADR 0013.

## Alternatives considered

- **PixiJS with 2D isometric sprites** (ADR 0001's renderer). Mature and light, but every
  object would need pre-drawn sprites for each of the six yaws (about 720 oriented track
  templates alone), or rotation would have to go. Bridges over track, tunnels and stacked
  structures would need hand-written depth sorting, and light and shadow would be painted
  per sprite. Procedural 3D gets rotation, depth, lighting and ray picking from the same
  geometry. This is design-pass inference, not a measured comparison.
- **A game engine with a web export** (for example Godot or Unity). It brings an editor and
  lighting tools but splits the stack: the TypeScript core under ADR 0002 would need a
  bridge, ADR 0001's DOM/React HUD would be lost or embedded awkwardly, and an engine
  runtime sits poorly with the ≤ 350 KB gzip initial-JS budget proposed for performance
  gate B. Inference; no engine was prototyped.
- **WebGPU now** (`WebGPURenderer`). It may lower per-draw CPU cost later, but its node
  materials do not take the `onBeforeCompile` chunks the art plan uses, its coverage on the
  mid-laptop target is unverified, and no measurement shows a need. WebGL stays until a gate
  says otherwise.

## Consequences

- **Benefits.** Elevation, bridges and tunnels read as geometry. Six rotations, lighting,
  shadows and depth come from the same meshes. Art can be generated in code (ADR 0013),
  which suits an agent-built prototype. One language, TypeScript, spans core, render and
  HUD.
- **Costs.** 3D brings shadow fitting, draw-call and triangle budgets, context-loss recovery
  and a heavier bundle than 2D. An orthographic view has no perspective depth cue, so depth
  must come from light, shadow and ambient occlusion. Occluded picking needs the aids above,
  not depth alone. Touch is not supported in M4 (a known gap).
- **Compatibility.** ADR 0002 is unchanged: presentation reads snapshots and never becomes
  authoritative. ADR 0001's web, TypeScript, Vite and React direction stands. The boundary
  rules are enforced by [`tests/architecture.test.ts`](../../tests/architecture.test.ts).
- **Follow-up.** D1 builds the render foundation (renderer host, frame scheduler, iso
  camera, perf monitor) with the winding-oracle, zoom-drift and idle-frame checks. D11 and
  ADR 0013 own the look. If `sim.preview` p95 exceeds 8 ms, file a sim-in-Worker ADR
  rather than bending the frame loop.

## Validation and acceptance boundaries

Evidence on 2026-09-26:
- Automated: [`src/render/coords.test.ts`](../../src/render/coords.test.ts) checks that the
  mapping has determinant +1, keeps mapped east × mapped north = up, matches the matrix and
  round-trips. This ADR did not re-run it.
- [`src/app/main.ts`](../../src/app/main.ts) is a skeleton smoke scene that wires the
  renderer, an isometric orthographic camera at Default zoom, the palette and `coords.ts`.
  No look or performance observation is recorded for it.

Not yet established, and not claimed:
- **The look:** Look Gate A (D11a; owner rubric of palette, charm, legibility, cohesion and
  originality) and Look Gate B (the owner walkthrough in D13, including readability at three
  zoom levels).
- **Performance:** gate B on the `bench-m4` scene. Provisional numbers: frame p95 ≤ 16.7 ms
  (p99 ≤ 25 ms), CPU ≤ 3 ms per frame and ≤ 150 draw calls at Default zoom (≤ 250 at Far),
  on an Apple M5 Pro at the High preset and DPR 2. The mid laptop is measured or recorded
  "deferred, not passed".
- **D1 checks:** the winding oracle for six yaws, zoom-to-cursor drift < 0.5 px, zero frames
  when idle, and picking that returns the node at terrain height.

The gates are predeclared in [the acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)
and approved by the owner before any measurement. Accepting this ADR sets the direction; it
is not evidence that any gate passes.

## Revisit when

- Look Gate A or B finds the fixed isometric view unreadable or off-mood after the 30° pitch
  A/B has been tried.
- Performance gate B fails on the reference hardware for renderer-bound reasons that quality
  presets and dynamic resolution do not fix; then weigh WebGPU in a new ADR.
- A `three` upgrade removes or breaks the `onBeforeCompile` path the shader modules use.
- Touch devices, free camera rotation or a perspective view become product requirements.

## History

- 2026-09-26: Accepted by explicit owner decision in conversation (rendering: web +
  TypeScript + Three.js 2.5D; "Mark ADR 0008/0009 Accepted"), in the same decision batch as
  ADR 0008. Written up in the rail-first reset PR that adds ADRs 0009–0014 ([#61](https://github.com/Kminkjan/infrastructurio/pull/61)).
