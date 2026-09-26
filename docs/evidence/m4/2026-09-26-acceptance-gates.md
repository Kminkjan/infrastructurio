# M4 acceptance gates (predeclared)

- **Status:** Approved 2026-09-26 by the owner, as written, by an explicit statement in
  conversation naming this file; recorded in PR [#79](https://github.com/Kminkjan/infrastructurio/pull/79)
  (the file was added in [#61](https://github.com/Kminkjan/infrastructurio/pull/61)). Bounds
  are never retuned after results.
- **Milestone:** M4 — Living Diorama
  ([milestone 8](https://github.com/Kminkjan/infrastructurio/milestone/8)); epic "M4 — Epic:
  Living Diorama" ([#62](https://github.com/Kminkjan/infrastructurio/issues/62)).
- **Run by:** D13 "M4 acceptance gate"
  ([#77](https://github.com/Kminkjan/infrastructurio/issues/77)), using the harness from D12
  "Replay and bench harness" ([#76](https://github.com/Kminkjan/infrastructurio/issues/76)).
  Look Gate A is held in D11a (part of
  [#75](https://github.com/Kminkjan/infrastructurio/issues/75)).
- **Contract:** [prototype plan](../../prototype-plan.md) (claim, scope, slices),
  [backlog](../../backlog.md) (D1–D13), [roadmap](../../../ROADMAP.md). Terms follow the
  [glossary](../../glossary.md); semantics follow the
  [simulation model](../../simulation-model.md), [architecture](../../architecture.md) and
  ADRs [0011](../../decisions/0011-signalling-and-reservation.md),
  [0012](../../decisions/0012-tick-units-determinism.md),
  [0013](../../decisions/0013-rendering-and-art-pipeline.md) and
  [0014](../../decisions/0014-autonomous-diorama-operator.md).
- **Label:** agent. This file is a proposal. It contains no measurements and claims nothing
  about the prototype.

## Purpose and rules

M4 claims that a player can build a railway layout on terrain, that autonomous trains run on
it safely and deterministically, stop at platforms and explain their waits, and that the
owner judges it looks and feels right. This file fixes, before anything is measured, which
evidence tests that claim and how each result is judged. Where a number elsewhere differs,
this file governs.

| Part of the claim | Gates |
|---|---|
| Build a layout: curves, grades, bridges, tunnels, turnouts, stations, depots, signals | A1, A2, A5, C |
| Trains run safely | A1, A3 |
| … and deterministically | A1, A4 |
| Stop at platforms and explain their waits | A1 (golden scenarios), C step 7 |
| At a usable cost on named hardware | B1–B11 |
| Looks and feels right (owner judgement) | LA, LB |

**Rules.**
1. **Declared before measuring.** The owner approves by an explicit statement, in the PR
   that adds this file, that names this file. Merging that PR is not by itself approval. The
   Status line then changes to "Approved <date> by the owner in PR #<n> (<link>)" in a commit
   that changes nothing else.
   No gate run, benchmark or look session before that counts, and none may be taken.
2. **Recorded as-is.** Each gate is recorded pass or fail from its unrounded value against
   its bound (16.71 ms fails ≤ 16.7 ms).
   - No re-running for a better number, no dropped outliers, repeats, seeds or fixtures, and
     no substitutes.
   - A run may be declared invalid only for a recorded cause: a harness crash, an unmet
     precondition, or the page going hidden mid-phase. The invalid run's output is committed
     beside the valid one.
3. **A missed target is a fail, taken to the owner.** Never "near pass", "within noise" or
   "provisionally met". The owner decides:
   - fix and re-run at a new SHA (the earlier record stays);
   - waive it for this disposition (the result stays "fail (waived by the owner, <date>)");
   - or not accept M4.

   A bound is never edited to fit a result.
4. **Change control.** Before approval, this file is edited freely in the PR that adds it.
   After approval and before the first gate run, it changes only through a new dated gates
   file that the owner approves the same way and that names what changed. After the first
   gate run it is frozen: a flaw found in a definition is reported in the disposition, never
   fixed retroactively.
5. **One build under test.** The automated and performance records for one disposition are
   taken at one commit, from a clean tree (`git status --porcelain` empty) after `npm ci`.
   Every record names this file's git blob SHA, so any later edit is detectable.
6. **Labels.** Every observation is labelled automated, agent, owner or participant.
   Automation is never human evidence. An owner session is not first-time-player
   validation.
7. **Development numbers are not evidence.** After approval, the F3 overlay and ad-hoc
   benches may be used freely inside slices. They are never cited against these gates; only
   the D13 runs defined here are.

**Made explicit here.** The plan left these open. They are approved together with the
bounds:
- the percentile each budget uses;
- draw calls judged by the per-frame maximum;
- worst-of-three repeat aggregation;
- the leak rule;
- the bench viewports;
- the three determinism fixtures;
- the soak's non-vacuity rule;
- the mid-laptop bounds;
- the look-gate pass rule.

## A. Automated gates

A runs at the build under test on any machine, with the environment recorded. Every
command, exit code and count goes into `YYYY-MM-DD-automated-gates.json`.

**A1 — Tests.** `npm test` exits 0 with 0 failed, 0 skipped and 0 todo. Test files, tests
and duration are recorded. The run must include all of the following. A missing item fails
A1 exactly as a failing one does.
- Unit tests: lattice, template closure, integer lengths, planner cases.
- Property tests, using the seeded `forAll` helper (seed list and case counts recorded):
  - `derive` is independent of insertion order;
  - `preview` equals `execute` and does not mutate;
  - undo/redo round-trips;
  - shuffling the movement order keeps the hash;
  - random networks run 10k ticks with the invariants checked every tick;
  - random edits during traffic keep the invariants.
- Replay equalities: step(1)×N == step(N) == step(10)×N/10, and save → load → continue ==
  uninterrupted play.
- The 11 golden scenarios, each built through commands only:

  | ID | Scenario | Must show |
  |---|---|---|
  | G1 | Single-track shuttle | capped at 1 train |
  | G2 | Passing loop | 2 trains, no deadlock over 2 simulated hours |
  | G3 | Blocked exit | stop signal lets the tail foul the junction; chain signal waits outside |
  | G4 | FIFO at a junction | service alternates; the wait stays bounded |
  | G5 | Diamond | both axes used; never simultaneously |
  | G6 | Grade and curve speed profile | balancing speed 10.5–11.5 m/s on 35‰ |
  | G7 | Edit while running | invariants hold; `track-in-use` where the committed zone is touched |
  | G8 | Loop line | trains circulate without reversing |
  | G9 | Unreachable station | the station reports its reason; no train is sent |
  | G10 | Two-platform station | a train takes the free platform |
  | G11 | Forced deadlock | detected ≤ 30 s, withdrawn at 120 s, then `capped-deadlock` |

**A2 — One negative fixture per reason code.** Core exports its validation reason codes as
a runtime list (D2). A coverage test runs every negative fixture and collects the code each
rejection returns.
- Pass: the collected set equals the exported list (none missing, none unknown), and each
  fixture returns exactly the code it names.
- The design names 34 codes as of 2026-09-26: structural 3, geometry 3, grade 1, terrain and
  structure 5, node topology 6, clearance 2, entities 10, operational 4. The gate uses the
  list at the build under test, and the record names every code added or removed since.

**A3 — Safety soak.** 50 seeded layouts × 10 simulated minutes (6,000 ticks at 10 Hz each;
300,000 ticks in total).
- **Layouts:** a seeded generator, committed before the first gate run, builds each layout
  through `execute` commands only. Seeds are 1–50; none is ever swapped or skipped. Each
  layout contains both signal kinds, ≥ 2 stations, ≥ 1 depot and ≥ 1 turnout, and the
  autonomous operator runs it.
- **Checks:** the full invariant set runs every tick. Each violation below is counted once
  per resource, or per train pair, per tick:
  - **double-held:** a section or conflict group held by more than one train;
  - **signal passed at danger:** a train's head beyond its
    [end of authority](../../glossary.md#end-of-authority-eoa), or any part of a train in a
    section it does not hold;
  - **overlap:** two trains' footprints (tail to head, every car) intersecting in arc length
    on any piece, or two trains occupying sections of one conflict group in the same tick.
- **Pass:** 0 double-held, 0 signals passed at danger and 0 overlaps, and no other invariant
  violation (each reported by name, with seed, tick and IDs of the first occurrence).
- **Non-vacuity:** every layout reaches ≥ 2 concurrently active trains and ≥ 1 km of train
  travel, and the soak as a whole records ≥ 1 denied reservation. Otherwise A3 fails.
- **Recorded per layout:** pieces, signals by kind, stations, depots, trains spawned and
  withdrawn, maximum concurrent trains, train-km, reservation grants and denials, deadlock
  events. Deadlocks are allowed and counted: they are detected and explained, not unsafe.

**A4 — Determinism.** Three fixtures × 1 simulated hour (36,000 ticks):

| ID | Fixture | Why this one |
|---|---|---|
| F1 | `bench-m4` (see B) | 24 trains and every element kind: the densest state |
| F2 | G7, edit while running | its command log changes the network under traffic |
| F3 | G11, forced deadlock | detection, withdrawal and `capped-deadlock` paths |

- **Checkpoint hash:** FNV-1a (`src/core/util/hash.ts`) of the canonical JSON (sorted keys,
  no whitespace) of `sim.save()`, at tick 0 and every 600 ticks: 61 checkpoints per run.
- **Runs:** four per fixture, each a new OS process (not a worker thread, not a second test
  in the same process), on one machine and one Node version:
  - R1: ticks 0–36,000 uninterrupted;
  - R2: the same as R1, in another fresh process;
  - R3 → R4: R3 runs ticks 0–18,000, writes the save to a file and exits; R4 loads it with
    `loadSim` and runs ticks 18,000–36,000.
- **Pass:** for all three fixtures, all 61 checkpoint hashes of R2 and of R3 + R4 equal R1's
  as exact hex strings. At ticks 18,000 and 36,000 the canonical save JSON is also
  byte-identical, which guards against hash collisions. No tolerance applies.
- **Recorded:** every hash list; on a mismatch, the first differing tick and the first
  differing JSON path.

**A5 — Undo round-trip.** Every construction command type, in 12 cases:
- `build-track` with structure ground, bridge, tunnel and auto;
- `demolish` of pieces, signals, platforms and depots;
- `place-signal` stop and chain;
- `place-platform`;
- `place-depot`.

From layout state S0: execute → S1, `undo` → must equal S0, `redo` → must equal S1.
Equality is exact on two hashes: the authored layout (geometric keys and entity
placements) and the derived network (its canonical form). Station IDs and names are
excluded, because their allocators never roll back by design; they are recorded instead.
No trains are present; undo under traffic is covered by A1's property tests and G7.
Pass: 12 of 12.

**A6 — Build hygiene.** Each command exits 0:
- `npm test`, which includes [the boundary test](../../../tests/architecture.test.ts) with
  its negative self-check (recorded separately by test name);
- `npm run typecheck`, both the app and the core configs;
- `npm run build`;
- `git diff --check 4b825dc642cb6eb9a060e54bf8d69288fbee4904 <sha>`. That hash is git's
  empty tree, so every tracked file is checked, whichever branch the SHA is on.

The files that predated the reset and had a blank line at EOF (three `.github/ISSUE_TEMPLATE`
files, ADRs 0001 and 0002, CONTRIBUTING.md) were fixed in `ac1e6a7` on 2026-09-26, so the
whole-tree check is clean from the reset onward.

## B. Performance

The numbers are the plan's provisional budgets. Approval makes them binding for M4.
`bench/budgets.json` is committed before the first run and must equal them.

### Reference machines

| ID | Machine | Browser settings | Gates |
|---|---|---|---|
| `m5-pro` | Apple M5 Pro (MacBook Pro). Model, cores, memory, macOS version and display recorded. AC power, Low Power Mode off | High preset, DPR 2, canvas 1440 × 900 CSS px (2880 × 1800 device px) | B1–B10 |
| `mid-laptop` | Intel Core i5-1235U or i5-1335U with Iris Xe, or AMD Ryzen 5 7530U with integrated Radeon; 1080p display. OS recorded. AC power | Medium preset, full screen at 1920 × 1080 device px (OS scaling recorded) | B11, or "deferred, not passed" |

On both machines:
- dynamic resolution is fixed at 1.0 and the auto-preset is off, since both would otherwise
  lower quality to meet the budget;
- reduced motion is off and no other applications are open;
- the display runs at its native refresh rate, which is recorded.

### Scene `bench-m4`

- Built through commands only.
- Committed before the first gate run as a command log plus a save captured at the first
  tick with 24 active trains. The headless and browser runs both load that save.
- Camera bookmarks for the zoom stations, the tour path and the edit sites are committed
  with it.
- Its blob SHA is recorded, and it never changes after a measurement.

| Element | Target | Accepted range | Notes |
|---|---|---|---|
| Track pieces | ~900 | 855–945 | straights, curves across radius classes, shifts |
| Turnouts | 24 | 24 | derived |
| Signals | 120 | 120 | stop and chain both present |
| Stations | 6 | 6 | ≥ 1 with two platforms |
| Depots | 2 | 2 | |
| Bridges | 3 | 3 | one stone viaduct, one truss over water, one girder overpass |
| Tunnels | 2 | 2 | |
| Trees | 15,000 | 14,250–15,750 | instances, all species |
| Buildings | 150 | 143–157 | procedural kinds, including the church, stations and engine sheds |
| Trains | 24 active | 24 in every measured phase | tank engine + 2–4 coaches |

The bounds were declared for this composition. Measured counts outside a range, or fewer
than 24 active trains in a phase, make the affected gates "not passed (protocol deviation)".

### Headless simulation (`m5-pro`)

| Gate | Operation timed | Samples per repeat | Bound |
|---|---|---|---|
| B1 | one `step(1)` | 6,000 consecutive ticks | p95 ≤ 0.5 ms |
| B2 | one `step(10)` | 600 consecutive batches | p95 ≤ 3 ms |
| B3 | one `preview(cmd)` | 200 commands from a committed list: all command types, ≥ 25% rejected, all eight validation stages among the rejections | p95 ≤ 4 ms |
| B4 | one `execute(cmd)` | the 100 committed ten-piece `build-track` edits, each followed by `undo`; both timed (200 samples) | p95 ≤ 25 ms |

Method:
1. Hosted by `vitest bench` (D12), with one fresh Node process per repeat and 3 repeats. The
   Node version is recorded.
2. Load the `bench-m4` save with invariants off (the production setting), then run 600
   warm-up ticks, which are discarded.
3. Run B1 → B2 → B3 → B4 in that order, with trains running. Each sample is
   `performance.now()` around the single call.
4. Each B4 edit must report 10 new pieces; if one does not, the repeat is invalid.
5. The harness writes raw samples and computes percentiles with the formula below, never
   from the bench tool's own summary.

### Browser (`m5-pro`)

| Gate | Metric | Tour | Far (0.9 px/m) | Default (6 px/m) | Close (12 px/m) |
|---|---|---|---|---|---|
| B5 | frame interval p95 / p99 | ≤ 16.7 / ≤ 25 ms | ≤ 16.7 / ≤ 25 ms | ≤ 16.7 / ≤ 25 ms | ≤ 16.7 / ≤ 25 ms |
| B6 | CPU per frame, p95 | ≤ 3 ms | ≤ 3 ms | ≤ 3 ms | ≤ 3 ms |
| B7 | draw calls, per-frame maximum | recorded | ≤ 250 | ≤ 150 | recorded |
| — | GPU time and triangles per frame | recorded | recorded | recorded | recorded |

| Gate | Metric | Phase | Bound |
|---|---|---|---|
| B8 | rebuild after a 10-piece edit | `edit`: 50 edits + 50 undos per repeat | p95 ≤ 3 ms |
| B9 | leaks over 200 edit/undo cycles | `leak` | leak rule below |
| B10 | initial JS | one measurement of the build | ≤ 350 KB gzip (350,000 bytes) |

**Definitions.**
- **Frame interval:** the difference between consecutive `requestAnimationFrame`
  timestamps while the scheduler renders continuously. It is what the player sees, and it
  is capped by vsync.
- **CPU per frame:** main-thread time from frame-callback entry to the return of the
  frame's last render call. It includes sim steps, diff application, interpolation,
  particles, camera, overlays, render submission and label updates. It excludes GPU
  execution and compositing.
- **Draw calls:** `renderer.info.render.calls` summed over every render call of one frame
  (shadow, main and post passes), with `info.autoReset = false` and a reset at frame start.
- **Rebuild:** render-side main-thread time from receiving a new `NetworkView` revision to
  the static layers (track batches, structures, overlays, pick proxies) matching it, summed
  over time slices if the update is sliced. The sim's `execute` is excluded (that is B4).
- **GPU time:** `EXT_disjoint_timer_query_webgl2` per frame when exposed. Otherwise the
  field is "n/a" for the whole run. It is never gated.
- **Leak rule (B9):** with the sim paused, record at cycle 0 (after the edit phase) and
  every 50 cycles to 200:
  - `renderer.info.memory.geometries` and `.textures`;
  - `renderer.info.programs.length`;
  - the render-side scene-object count;
  - JS heap used after a forced GC (Chrome DevTools Protocol `HeapProfiler.collectGarbage`,
    then `Runtime.getHeapUsage`).

  Pass: every count at cycle 200 equals cycle 0 exactly, and heap growth from cycle 0 to 200
  is ≤ 1 MiB (1,048,576 bytes).
- **Initial JS (B10):** gzip (level 9) byte sizes summed over the entry chunk that
  `dist/index.html` loads and all its static imports, taken from the Vite build manifest.
  Dynamically imported chunks, such as the lazy High-preset post stack, are listed
  separately and not counted. CSS and fonts are not JS.

**Method** (browser; each repeat runs steps 2–8):
1. **Preconditions:** approval recorded; clean build under test after `npm ci`;
   `bench/budgets.json` matches this file. Then `npm run build` and
   `npm run preview -- --port 4173 --strictPort`: the production build, never the dev
   server.
2. **Browser:** system Google Chrome stable, launched by Playwright with `channel: "chrome"`
   and `headless: false`. Bundled Chromium and headless mode are excluded because both
   change GPU use and frame pacing.
   - Each repeat gets a fresh browser process and profile, with no extensions and no extra
     flags.
   - The page stays visible and focused. A `visibilitychange` to hidden invalidates the
     repeat.
   - `crossOriginIsolated` is recorded: timer resolution is 5 µs when true and 100 µs when
     false, and both suffice for these bounds.
3. **Load:** the D12 bench entry with scene `bench-m4`, and the preset and DPR of the
   machine. Wait until the scene reports ready: static layers built, shaders compiled.
4. **Warm-up:** 10 s at Default zoom with the sim at 1×. Samples are discarded.
5. **Camera tour** (phase `tour`; scripted and identical in every repeat; sim at 1×):
   - at Default, six 60° rotations (300 ms ease, 1 s hold each);
   - zoom Far → Region → Default → Close → Detail → Default, holding 2 s at each;
   - a fixed four-waypoint pan at Default.
6. **Sim windows** (phases `sim-far`, `sim-default`, `sim-close`): at each zoom station,
   centred on its bookmark at yaw 0, a 2 s settle (discarded), then 30 s with the camera
   still and the sim at 4×.
7. **Edit phase** (phase `edit`; Default zoom; sim at 1×): 50 scripted edit → undo pairs
   through the projection hook.
   - Playwright drags the real pointer between lattice nodes whose screen positions the
     hook reports, at the committed edit sites where no train holds track.
   - Each edit produces exactly 10 new pieces; then Ctrl/Cmd+Z undoes it. Steps are 1 s
     apart.
   - Labelled automated: synthetic input says nothing about construction feel.
8. **Leak phase** (phase `leak`): 200 further edit → undo cycles through the same hook, with
   the sim paused and one rendered frame between steps.
9. **Repeats:** steps 2–8 run three times.
   - Each percentile gate is evaluated per repeat. The recorded value is the worst repeat,
     and a gate passes only if all three repeats pass.
   - Pooled values are reported for information only.
10. **Uncapped-headroom proxy** (after the gated repeats; never gated): one extra run of
    steps 2–6, with Chrome launched with `--disable-gpu-vsync --disable-frame-rate-limit`.
    - It reports frame-interval p50/p95/p99 per phase.
    - It is labelled "proxy" in the JSON and in every sentence that cites it.
    - It is never presented as the frame rate a player sees.

**Statistics** (all B gates, both machines):
- Sort the non-null samples ascending, then take p50 = s[floor(0.50·n)], p95 =
  s[floor(0.95·n)] and p99 = s[floor(0.99·n)], zero-based, with no interpolation. n = 0
  gives null.
- A missing sample is recorded as null: never 0, never interpolated. Nulls are counted in
  `nulls`.
  - A gated metric whose samples are all null is "not measured" and does not pass.
  - A gated metric with more than 1% nulls is recorded "not passed (incomplete)".
- Values are compared unrounded and reported to 0.01 ms.

### Mid laptop (B11)

- **Method:** the same scene and browser steps 1–9, at the Medium preset.
- **Gated, with the same bounds as the `m5-pro` tables:** B5 frame interval p95 ≤ 16.7 ms
  and p99 ≤ 25 ms in every phase; B7 draw calls ≤ 250 at Far and ≤ 150 at Default; B9 by
  the leak rule.
- **Recorded, not gated:** B6, B8, GPU time and the headless simulation.
- **If no qualifying machine is available by D13,** the record says "deferred, not passed",
  with the reason. That is never a pass, and the disposition lists it.

### Report schema

The Playwright bench and `vitest bench` together write one JSON report per machine and run
date, `YYYY-MM-DD-performance-<machine>.json`.

| Field | Content |
|---|---|
| `schema` | `"infrastructurio/bench-m4@1"` |
| `label` | `"automated"`; the `proxy` block carries its own `"label": "proxy"` |
| `commit`, `treeClean` | 40-character SHA of the build under test; `treeClean` must be `true` |
| `gatesBlob`, `budgetsBlob`, `sceneBlob` | git blob SHAs of this file, `bench/budgets.json` and the `bench-m4` fixture at `commit` |
| `startedAt`, `finishedAt` | ISO 8601 with UTC offset |
| `machine` | `id` (`m5-pro` or `mid-laptop`), model, CPU, GPU, memory, OS and version, power source, low-power mode, display pixels and refresh rate |
| `runtime` | Node version; Chrome version and channel; `headless: false`; launch flags; `crossOriginIsolated`; WebGL unmasked renderer string (or null); three.js revision |
| `settings` | preset, DPR, canvas CSS and device pixels, dynamic-resolution scale, auto-preset, reduced motion |
| `scene` | measured count for every composition row; active trains min and max per phase |
| `sim[]` | per repeat: B1–B4 metric summaries |
| `repeats[]` | per repeat: `phases` keyed `tour`, `sim-far`, `sim-default`, `sim-close`, `edit`, `leak`, each with sim speed, zoom (px/m), yaw, duration and metric summaries |
| metric summary | `{ n, nulls, p50, p95, p99, max, samples[] }`; `gpuMs` is the string `"n/a"` when the extension is absent |
| `leak[]` | per repeat, at cycles 0, 50, 100, 150 and 200: geometries, textures, programs, scene objects, heap bytes after GC |
| `initialJs` | gzip bytes per file, the total, and lazy chunks listed apart |
| `gates[]` | `{ id, metric, phase, bound, unit, worstValue, worstRepeat, pooledValue, pass }` |
| `proxy` | `label: "proxy"`, launch flags, frame-interval p50/p95/p99 per phase |
| `deviations[]` | each departure from this protocol, or empty |
| `nonClaims[]` | the record's non-claims |

## C. Owner walkthrough (Look Gate B)

**Human only.** Agents never perform, simulate or narrate it:
- no agent plays the script in a browser and presents that as a walkthrough;
- no automated run of these steps is cited as C;
- no agent writes the owner's observations, scores or verdict, or paraphrases them into a
  pass.

Agents may prepare the build at the SHA, the start command and a blank record with the
fields below. Preparation is not acceptance.

**Setup (recorded):**
- the date, and the SHA: normally the build under test of A and B; if it differs, the
  disposition lists the commits between them;
- `npm run build && npm run preview`;
- machine, browser and version, preset (Medium unless the owner changes it), and session
  length;
- start: the M4 scenario's terrain with no track;
- no time limit and no agent in the loop; in-game help is allowed.

**Script:**

| Step | The owner | Attend to |
|---|---|---|
| 1 | Orients: pans, zooms through Region, Default and Close, rotates once with Q/E | terrain, lattice reveal, labels |
| 2 | Builds an oval with a passing loop and two stations | snapping, curves, new/reused counter, rejection reasons, precision mode, undo |
| 3 | Adds a branch that climbs over the main line on a bridge | grade feedback, height keys, structure choice, hiding decks (H) |
| 4 | Adds a tunnel | tunnel rules, portals, underground view (U) |
| 5 | Adds signals (stop and chain) and a depot | block overlay, signal facing, trains leaving the depot |
| 6 | Watches at 1× and 4× | running, platform stops, steam, calm |
| 7 | Inspects a waiting train | the reason text and Show |
| 8 | Tries demolishing occupied track | the rejection and its explanation |

**Recorded, in the owner's words:**
- per step: completed, partly or not completed, with a note;
- the Look Gate B scores and overall verdict (rubric below);
- a **friction log**, kept separate from the scores: each moment the owner was stuck,
  surprised or had to retry, with the step, what happened, severity (blocker, slowed down,
  nit) and any workaround;
- a **help log**, kept separate again: each time the owner needed something outside the
  game (docs, code, a person or an agent), with the step and what was needed;
- defects seen, filed afterwards as issues (numbers TBD).

Friction and help entries are never averaged into scores, and a good score never cancels
an entry.

**Gate C passes** when all eight steps were completed. A step the owner could not complete
fails C and is recorded with its friction entry.

**Bound.** The owner designed the game and knows its controls. The session says nothing
about discoverability or learnability for new players. First-time-player validation is an
M5 gate ([roadmap](../../../ROADMAP.md)).

## Look gates A and B

The criteria and their questions are defined in
[art direction](../../art-direction.md#look-gates-a-and-b): palette, tiny-diorama charm,
legibility, cohesion and originality. This file adds the scale, the procedures, the pass
rule and the records. Only the owner scores; the record holds the owner's own words,
labelled owner.

**Scale.** Each item gets 1–5 and a one-line reason:

| Score | Meaning |
|---|---|
| 1 | Wrong: works against the direction |
| 2 | Weak: needs rework |
| 3 | Acceptable with named fixes |
| 4 | Good: polish only |
| 5 | Right as it is |

**Pass rule** (both gates): the overall verdict is "pass" and every item scores ≥ 3. Any
originality concern the owner names is filed as an issue whatever the verdict.

### Look Gate A (LA): after D11a, before D11b

- **Subject:** the static diorama: terrain, light, the scenery kit, buildings, labels and
  static track from a scenario snapshot. No trains are required.
- **Views:** four camera bookmarks, committed by D11a before the session:
  - Default over a station throat with turnouts and signals;
  - Region over the river and a viaduct;
  - Close on a village with the church;
  - Far over the whole map.

  Each is shown at the Medium preset (the base look must work without post-processing),
  then at High as a secondary view. Each sits beside the mood board in art direction:
  public-domain 1900 Baltic sources plus a link to the store page of the mood reference
  (Mighty Tiny Railways, mood only). No capture of the reference game enters the repo.
- **Pitch A/B:** each view at the true isometric 35.264° and at 30°. The owner's choice is
  recorded. A change from 35.264° needs an owner-approved update of
  [ADR 0009](../../decisions/0009-render-isometric-threejs.md).
- **If semaphores are not yet renderable,** static models stand at fixed aspects, or the
  record states that only track legibility was scored.
- **Items:** palette, charm, legibility, cohesion, originality.
- **Outcome:** a fail sends palette, lighting and kit back for iteration inside the D11a
  time-box before D11b. The gate may be held again on a new build, each session in its own
  dated record.
- **Scope:** LA does not decide M4. It is an early checkpoint whose record D13 lists.

### Look Gate B (LB): inside the walkthrough (C), on the D11b build under test

- **Items:**
  - palette, charm, cohesion and originality, re-scored on the living diorama so drift since
    LA is visible;
  - mood: calm and alive as a diorama;
  - readability at Region, Default and Close, three separate scores: track, signals,
    trains, overlays and labels at that zoom;
  - construction feel: the tools do what the owner meant (drag, snapping, curves,
    precision, height, undo).
- **Pass:** the pass rule above, with the verdict worded "looks and feels right".

## D. Records and disposition

All records are files in `docs/evidence/m4/`, dated by the run's start date.

| Record | Label | Written by | When |
|---|---|---|---|
| `YYYY-MM-DD-look-gate-a.md` | owner | the owner | after D11a |
| `YYYY-MM-DD-automated-gates.md` + `.json` | automated | an agent running A1–A6 | D13 |
| `YYYY-MM-DD-performance-m5-pro.md` + `.json` | automated; the proxy block labelled proxy | an agent running B1–B10 | D13 |
| `YYYY-MM-DD-performance-mid-laptop.md` + `.json` | automated, or a "deferred, not passed" note | whoever has the machine | D13 |
| `YYYY-MM-DD-owner-walkthrough.md` | owner | the owner | D13, after the automated and performance records |
| `YYYY-MM-DD-m4-disposition.md` | agent | an agent | last |

**Every record states:**
- date and label;
- the build under test: a 40-character SHA and a clean tree;
- this file's blob SHA;
- environment: machine, OS, Node, browser and version, preset, DPR, viewport;
- the exact commands;
- counts: tests, fixtures, codes, seeds, ticks, checkpoints, samples, nulls, repeats;
- raw data: the committed JSON for automated records, or the owner's own notes verbatim for
  owner records;
- a gate table (ID, bound, value, pass or fail), or for owner records the scores and
  verdict;
- deviations from this protocol: "none", or each deviation with the affected gates, which
  are recorded "not passed (protocol deviation)" and taken to the owner;
- non-claims.

Owner records add the view or step table, the pitch choice (LA), and the friction and help
logs (C).

**Disposition rule.**
1. An agent publishes the disposition only after every record above exists, or is recorded
   as deferred.
2. It tabulates every gate (A1–A6, B1–B11, C, LA, LB) as pass, fail, deferred or not
   measured, citing the record for each.
3. It recommends exactly one of:
   - **accept**, only if every gate passed;
   - **accept with named waivers**, listing each fail or deferral the owner would have to
     waive (so a deferred mid laptop rules out a plain "accept");
   - **do not accept yet**, naming what must change.
4. It never states or implies that M4 is accepted, and it closes nothing.
5. **Only the owner accepts M4.** Their decision is given explicitly on GitHub, on the M4
   epic ([#62](https://github.com/Kminkjan/infrastructurio/issues/62)) and D13
   ([#77](https://github.com/Kminkjan/infrastructurio/issues/77)). It is then cited in a
   dated History note in the disposition, with every waiver recorded as "fail (waived by the
   owner, <date>)".

## Non-claims

Passing every gate would still not establish:
- that new players can discover and learn the game (M5's first-time-player session);
- performance on other machines, on other browsers (Safari, Firefox) or with touch input,
  and a deferred mid laptop is not a pass;
- determinism on JavaScript engines other than the V8 in the recorded Node version, since A4
  runs in Node;
- the frame rate a player sees, from the headroom proxy;
- construction feel, from scripted edits; only LB speaks to feel, and only for the owner;
- anything about towns, demand, economy, roads, IndexedDB saves, sound, day/night or
  weather, all of which M4 excludes ([prototype plan](../../prototype-plan.md));
- an independent review: the look and feel verdict is the owner's own judgement.

## History

- 2026-09-26: Proposed in the PR that adds this file ([#61](https://github.com/Kminkjan/infrastructurio/pull/61); label:
  agent). No measurements exist.
