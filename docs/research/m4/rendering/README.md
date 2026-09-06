# M4 paired presentation experiment — issue #26

Recorded 2026-09-06. This worktree started at `db4dc50dd87944b7ee98d70472de11864cf974f3`
(merged PR #46), after fetching stale main and verifying that it contains
`de77568257d22949684b9e4298947d755c11646e` (PR #45).

**Bounded conclusion:** retain Pixi and a plan camera as the research editing
reference. The minimal Three.js view also performs the scripted edits and adds
visible height, but this experiment does not establish a human usability advantage
or justify a production renderer migration. See [ADR 0004](../../../decisions/0004-m4-renderer-camera-reference.md).

## What was actually compared

The [current application screenshot](current-application.png) records the untouched
baseline renderer. `src/rendering/world-renderer.ts` uses Pixi Graphics/Containers,
WebGL, a plan camera and straight-road callbacks. It cannot perform the four requested
tasks unchanged. The comparison therefore adds a **research adapter using that
rendering stack and the actual existing `fitCamera` function**, not a claim that
the existing application already supports curved roads, lanes or bridges. The
production renderer and simulation are unchanged.

The alternative is Three.js WebGL2 with an orthographic camera looking from
(400, 720, 900) toward (400, 0, 250), plus a top-camera checkbox. It uses polygon
meshes, depth-aware ray picking, a 3 m thick deck, two supports and instanced vehicle
boxes. Pixi uses cached Graphics, explicit deck-over-vehicle layering and polygon
hit testing. Both use unlit flat colors, antialiasing and a 960 × 600 canvas at DPR 1.
The 2D fit scale and the 3D orthographic horizontal scale are both approximately
1.0714 px/m; the oblique view foreshortens the north–south direction. No orbit,
perspective, lighting, terrain mesh, touch gestures or arbitrary camera rotation
was implemented or evaluated.

Both adapters consume the same geometry and state mutations in
`experiments/m4/rendering/scene.mjs` and `study.mjs`. The fixture contains an authored
S-curve, a straight approach and a turn path, an elevated deck at 45 m and 12 queued
icons. Elevation is deliberately exaggerated for this legibility probe; it is not
a plausible validated bridge design. The deck has no approach ramps. The queue
cause is explicitly authored text, not output from the lane simulator. Ground-plane
crossings never create topology because this fixture has no topology builder.

The scripted tasks are identical in world coordinates:

1. Clear the S-curve and draw four control points: (90,370), (250,80), (540,520),
   (710,320). Drag handle 1 to (280,110).
2. Select the gold turn lane at (244,234).
3. Select the deck at (400,180,45); raise it by 5 m with the shared button.
4. Click queue head (400,250,1) under the deck. Hide the deck and repeat; inspect
   the textual queue explanation. Select it again using only keyboard input on
   the target list. Select a curve handle and move it 5 m with an arrow key.

Playwright computes screen coordinates from each adapter's projection, then sends
real DOM mouse/keyboard input. This is an automated coordinate/picking consistency
probe with foreknowledge of targets, **not a measured player error rate, task time,
independent precision test, discoverability test or performed human session**.
Screenshots were inspected by the coding agent. No participant was recruited.

## Interaction evidence

| Task | Pixi plan | Three.js oblique | Interpretation |
| --- | --- | --- | --- |
| Draw / reshape | Completed; see raw world-coordinate errors | Completed; see raw errors | Projection/inverse projection and pointer editing work at the chosen coordinates. |
| Turn lane | Correct target | Correct target | One gold lane and exact target coordinate; not crowded-junction validation. |
| Elevated edit | Deck selected; state becomes 50 m; text changes | Deck selected; state becomes 50 m; projected deck moves | 2D height needs explicit text/layer cues; 3D supplies a spatial cue. |
| Obscured queue, first click | Selects bridge | Selects bridge | One expected occlusion failure per adapter. Depth alone does not make the queue selectable. |
| Queue after filter | Correct queue and explanation | Correct queue and explanation | One layer action recovers access in both. |
| Keyboard target / nudge | Queue selected; handle moves (5,0) | Same | Shared DOM controls avoid dependence on canvas hit targets for these actions. |

Paired screenshots: [2D curve](2d-curve.png) / [3D curve](3d-curve.png),
[2D lane](2d-lane.png) / [3D lane](3d-lane.png),
[2D deck](2d-bridge.png) / [3D deck](3d-bridge.png),
[2D queue](2d-queue.png) / [3D queue](3d-queue.png),
[3D top camera](3d-top-camera.png).

The initial exploratory run exposed a reversed north–south convention in the 3D
adapter. This was fixed before the committed run. It is implementation debugging
evidence, not a player interaction error; the discarded run's timings are not used.

Accessibility remains incomplete: controls have native labels, focus rings, an
`aria-live` explanation and a keyboard target list. The first drawing operation
still requires a pointer; arrow nudges require canvas focus; the list is a fixed
fixture list, not a navigable production scene tree. Color distinguishes lane and
handles visually, with names available through the list. No screen-reader,
low-vision, color-vision, motor-accessibility or first-time-player test was performed.
3D adds a camera mode to understand; the fixed oblique camera constrains complexity.
The 2D camera checkbox is a no-op, retained to keep the common panel stable.

## Performance method and boundaries

[Raw results](results.json) contain exact hardware/browser/GPU identity, source and
lockfile hashes, all input observations, rebuild timings and every sampled interval.
The host is an Apple M5 Pro MacBook Pro, 48 GiB RAM, macOS 26.6.2. This is headed
Chrome, one visible page at a time, 1320 × 900 viewport, DPR 1. The experiment runs
through Vite's development server. The measurements are not a production build,
a low-end-device claim or a GPU microbenchmark.

Each mode measures two workloads, each after 1.5 s warm-up, with three consecutive
3.5 s samples. Order is fixed: Pixi first, Three.js second. A second, synthetic
stress scene contains **128 isolated lane strips and 2,144 icons**, in the same
positions in both adapters, translated sinusoidally on every frame. Icons overlap
at this deliberately dense spacing; they do not represent valid lane occupancy.
There is no connected network, simulation, routing, snapshots, growth or input
activity during these steady-state samples. The counts match the scale of #27's
separate headless study only; the two workloads are not integrated.

`requestAnimationFrame` timestamp differences measure browser frame intervals.
`performance.now()` around transform updates plus render submission measures CPU
work, **not completed GPU time or input-to-photon latency**. The separate
`editRebuildCpu` summary includes geometry rebuilding and status updates during
scripted input, including initial setup, but excludes the next render and GPU work.
No forced GPU synchronization is used. Refresh pacing limits frame intervals, so
similar intervals do not establish equal GPU cost. Three.js uses one instanced
vehicle mesh; Pixi uses one Graphics object per icon, matching the existing
object-based approach. This compares these implementations, not best achievable
engine performance. CPU allocation, batching and ordering may affect the result.

| View / workload | Per-repeat p95 frame interval | Per-repeat p95 update + submit CPU | Worst frame |
| --- | ---: | ---: | ---: |
| 2d / editing | 9.20–9.30 ms | 0.20–0.30 ms | 9.40 ms |
| 2d / stress | 9.20–9.30 ms | 1.30–1.40 ms | 9.40 ms |
| 3d / editing | 9.20–9.30 ms | 0.30–0.30 ms | 9.40 ms |
| 3d / stress | 9.20–9.30 ms | 0.80–1.00 ms | 9.40 ms |

Chrome 152.0.7977.82 used ANGLE Metal on Apple M5 Pro in both modes. Median frame intervals were 8.3 ms (approximately 120 Hz pacing); no recorded interval exceeded 20 ms. Across the 27 editing rebuild samples per view, p95 CPU was 0.30 ms in Pixi and 0.80 ms in Three.js; maxima were 0.70 and 3.00 ms respectively.

Maximum draw coordinate round-trip error was 0.0000162 m in Pixi and 0.0000246 m in Three.js; reshape errors were below 0.0000153 m. These tiny values reflect a shared projection oracle and floating-point consistency, not achievable human drawing precision.

A provisional **research-only** guardrail from these observations is p95 frame
interval <=20 ms and p95 transform-update/render-submit CPU <=4 ms at the measured
128-strip / 2,144-icon scene on this host, DPR 1. Editing rebuild CPU gets a
provisional p95 <=8 ms guardrail. These are post-measurement budgets for detecting
regression, not predeclared proof of a 60 FPS integrated region. Retest on connected
traffic, real UI and representative lower-end hardware before accepting an M5
scene/frame target. #27's movement-only budget remains separate.

## Implementation cost and scope

Both adapters were built during this bounded agent session. Cost is recorded as
reviewable source footprint and added mechanisms, not an invented human-hours
estimate. `pixi-view.mjs` reuses the installed Pixi package and current camera-fit
code; `three-view.mjs` adds a pinned Three.js 0.185.1 development dependency,
orthographic projection/inverse ray-plane mapping, depth picking, extrusion/support
meshes, GPU resource disposal and instanced transforms. The runner adds pinned
Playwright 1.63.0 as a development dependency. Neither is imported by the production
application. The shared fixture/controller and HTML are also new research code.

| Research source | Lines | Bytes |
| --- | ---: | ---: |
| `pixi-view.mjs` | 110 | 3,184 |
| `three-view.mjs` | 140 | 4,210 |
| `scene.mjs` | 121 | 3,419 |
| `study.mjs` | 188 | 5,402 |
| `index.html` | 117 | 3,187 |
| `run-study.mjs` | 218 | 7,261 |
| `verify-results.mjs` (original study revision) | 29 | 1,853 |


The adapters rebuild geometry on selection/drag, have no persistent authored-road
model or undo, and implement only a single bridge height. The 3D prototype does not
price a full renderer migration: feature parity, terrain, existing overlays,
selection semantics, asset pipeline, save/load, mobile/GPU compatibility and
accessibility remain uncosted. A visual height cue alone cannot settle that cost.

## Reproduce and review

Requires Node >=20.19 and installed Google Chrome on macOS (hardware collection uses
`sysctl` and `sw_vers`). From the repository root:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --strictPort
# In another terminal, keep the study's Chrome window visible:
npm run research:m4:rendering -- /tmp/m4-rendering-rerun
npm run verify:m4:rendering -- /tmp/m4-rendering-rerun/results.json
```

Open `/experiments/m4/rendering/index.html?mode=2d` or `?mode=3d` on that local server
for inspection. The production build intentionally does not ship the experiment.
The verifier checks the complete source manifest, unique paired task/workload
coverage, coordinate errors and timing summaries recomputed from raw samples.
Visibility is captured only at sample end; it cannot prove uninterrupted foreground
visibility. Edit-rebuild timings have only a summary, so their distribution cannot
be independently recomputed from the committed report. The verifier expects the
direct occlusion failure and does not call that a passing queue selection. Timing values vary; coordinate observations should reproduce.

## Verification performed

The final paired run reports no page errors. The result verifier passes all task
outcomes, source hashes and visible sample coverage. All 73 existing Vitest tests,
five headless M4 lane checks, TypeScript checking and the production Vite build
passed. `git diff --check` is clean. The original M3 binary diff SHA-256 before and
after is `42c4eec5ee1290dd8fbfd62cac7edccce0bf23b53579a12dff50c7877b993841`.

## Tracking and remaining gates

#26 now has an executable comparison, screenshots, automated observations and
browser measurements, plus a bounded renderer/camera reference decision. Keep it
open for evidence review and human comparison before making a production choice.
A focused human session should assess unprompted curve editing, lane identification,
deck height comprehension and discovering the hidden queue in both views, recording
errors and participants rather than substituting this script's known coordinates.
This is outstanding validation, not work claimed as performed.

#27 remains open for review; ADR 0003 keeps weight 1 and rejects the tested spatial
platoon factors 2/4. #28's inventory remains preliminary; final migration, production
cadence, save boundaries and accepted region budgets still require reviewed #26/#27
evidence. Epic #21 and milestone 5 remain open. No M5 road/growth or M6 rail
implementation is included. The original M3 checkout remains on `18dc5ee` with its
same ten modified files; its diff hash is checked before/after this experiment.

Independent source, screenshot and raw-sample review: [review findings](../evidence-review.md).
The runner uses port 5173; require the strict-port server to start successfully in
the intended checkout before running it. A different server on that port would
invalidate provenance even though the runner hashes local files.
